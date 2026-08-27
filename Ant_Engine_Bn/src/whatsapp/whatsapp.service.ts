import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as path from 'path';
import { rm } from 'fs/promises';
import * as QRCode from 'qrcode';
import { pino } from 'pino';
import { Boom } from '@hapi/boom';
import makeWASocket, { DisconnectReason, fetchLatestBaileysVersion, WASocket } from '@whiskeysockets/baileys';
import { useEncryptedMultiFileAuthState } from './encrypted-auth-state';
import { InstanceNotConnectedError, InvalidRecipientError } from './errors';

export type InstanceStatus = 'connecting' | 'qr_code' | 'pairing_code' | 'connected' | 'disconnected';

interface InstanceRecord {
  sock: WASocket;
  status: InstanceStatus;
  qr?: string;
  pairingCode?: string;
}

@Injectable()
export class WhatsappService implements OnModuleDestroy {
  private readonly logger = new Logger(WhatsappService.name);
  private readonly instances = new Map<string, InstanceRecord>();
  // evita duas conexoes concorrentes para a mesma instancia (ex: dois /connect quase simultaneos)
  private readonly connecting = new Map<string, Promise<{ status: InstanceStatus; qr?: string; pairingCode?: string }>>();
  // Chave de idempotencia (messageLogId) -> envio em andamento/recente. Sem
  // isso, um timeout do axios do worker (30s) enquanto o sock.sendMessage
  // ainda esta em voo faz o worker RETENTAR o mesmo /send - se a 1a chamada
  // acabar indo com sucesso segundos depois, a mensagem seria enviada 2x.
  private readonly recentSends = new Map<string, Promise<{ messageId: string }>>();
  private static readonly SEND_DEDUP_TTL_MS = 2 * 60_000;
  // Contador de tentativas de reconexao automatica ENQUANTO o pareamento
  // ainda nao completou (ver openConnection) - permite um numero limitado de
  // retries pra sobreviver a uma queda cedo/transitoria do handshake (comum
  // na 1a tentativa contra os servidores do WhatsApp), sem reintroduzir o
  // loop infinito que motivou parar de reconectar sozinho nesse caso.
  private readonly pairingRetries = new Map<string, { count: number; windowStart: number }>();
  private static readonly MAX_PAIRING_RETRIES = 3;
  private static readonly PAIRING_RETRY_WINDOW_MS = 45_000;

  constructor(private configService: ConfigService) {}

  onModuleDestroy() {
    for (const { sock } of this.instances.values()) {
      sock.end(undefined);
    }
  }

  // phoneNumber presente = pedir codigo de pareamento (Baileys
  // requestPairingCode) em vez de esperar o QR - ver openConnection.
  async connectInstance(instanceId: string, phoneNumber?: string): Promise<{ status: InstanceStatus; qr?: string; pairingCode?: string }> {
    const existing = this.instances.get(instanceId);
    if (existing && (existing.status === 'connected' || existing.status === 'connecting')) {
      return { status: existing.status, qr: existing.qr, pairingCode: existing.pairingCode };
    }

    const inFlight = this.connecting.get(instanceId);
    if (inFlight) {
      return inFlight;
    }

    const promise = this.openConnection(instanceId, phoneNumber);
    this.connecting.set(instanceId, promise);
    try {
      return await promise;
    } finally {
      this.connecting.delete(instanceId);
    }
  }

  private async openConnection(instanceId: string, phoneNumber?: string): Promise<{ status: InstanceStatus; qr?: string; pairingCode?: string }> {
    const sessionsDir = this.configService.get<string>('sessionsDir');
    const authDir = path.join(sessionsDir, instanceId);
    const { state, saveCreds } = await useEncryptedMultiFileAuthState(authDir);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      auth: state,
      logger: pino({ level: this.configService.get<string>('logLevel') }) as any,
      printQRInTerminal: false,
      browser: ['Anti-Ban', 'Chrome', '1.0.0'],
    });

    const record: InstanceRecord = { sock, status: 'connecting' };
    this.instances.set(instanceId, record);

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      // So trata o QR se ninguem pediu codigo de pareamento pra essa conexao -
      // o Baileys ainda emite 'qr' mesmo depois do requestPairingCode, e sem
      // essa guarda o status voltava de 'pairing_code' pra 'qr_code' sozinho.
      if (qr && !record.pairingCode) {
        record.qr = await QRCode.toDataURL(qr);
        record.status = 'qr_code';
        this.logger.log(`Instância ${instanceId}: QR code gerado, aguardando pareamento`);
      }

      if (connection === 'open') {
        record.status = 'connected';
        record.qr = undefined;
        record.pairingCode = undefined;
        this.pairingRetries.delete(instanceId);
        this.logger.log(`Instância ${instanceId}: conectada`);
      }

      if (connection === 'close') {
        const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
        const loggedOut = statusCode === DisconnectReason.loggedOut;
        // captura ANTES de sobrescrever pra 'disconnected' - decide se vale a
        // pena reconectar sozinho ou nao
        const wasConnected = record.status === 'connected';
        // 515 (restartRequired) e o handshake normal do Baileys logo apos o QR
        // ser escaneado com sucesso - o WhatsApp fecha a conexao de proposito e
        // espera o cliente reconectar pra concluir o login. Sem esse caso, um
        // pareamento bem-sucedido caia no else abaixo (tratado como QR expirado
        // sem ninguem escanear) e a instancia era apagada antes de logar de fato.
        const restartRequired = statusCode === DisconnectReason.restartRequired;

        record.status = 'disconnected';
        this.logger.warn(
          `Instância ${instanceId}: desconectada (statusCode=${statusCode}, loggedOut=${loggedOut})`,
        );

        if (loggedOut) {
          this.instances.delete(instanceId);
          this.pairingRetries.delete(instanceId);
          // WhatsApp invalidou a sessão do lado deles (401) - sem isso, a
          // proxima tentativa de conectar carregava a MESMA sessão morta do
          // disco e falhava de novo, em loop, sem nunca gerar QR novo pra
          // repareamento. Apaga a sessao inteira: so credenciais mortas ficam
          // pra tras mesmo, nao tem o que reaproveitar depois de um loggedOut.
          rm(authDir, { recursive: true, force: true }).catch((err) =>
            this.logger.error(`Falha ao limpar sessão de ${instanceId} após logout: ${err.message}`),
          );
        } else if (wasConnected || restartRequired) {
          // reconecta sozinho se JA estava de verdade conectada (queda de rede,
          // etc) OU se o WhatsApp pediu restart apos pareamento bem-sucedido
          // (515) - em ambos os casos e uma recuperacao legitima, nao abandono
          this.connectInstance(instanceId).catch((err) =>
            this.logger.error(`Falha ao reconectar ${instanceId}: ${err.message}`),
          );
        } else {
          // fechou sem nunca ter conectado de verdade (QR/codigo gerado mas
          // ninguem pareou a tempo, OU o handshake caiu cedo/transitoriamente
          // antes disso - o 2o caso e comum na 1a tentativa contra os
          // servidores do WhatsApp e merece um retry curto). Da ate
          // MAX_PAIRING_RETRIES tentativas automaticas dentro de uma janela
          // curta antes de desistir - sem esse limite, volta o loop infinito
          // de QR novo a cada ~9s que motivou parar de reconectar sozinho
          // aqui (ver commit anterior).
          const now = Date.now();
          const tracker = this.pairingRetries.get(instanceId);
          const withinWindow = !!tracker && now - tracker.windowStart < WhatsappService.PAIRING_RETRY_WINDOW_MS;
          const attempt = withinWindow ? tracker!.count + 1 : 1;
          this.pairingRetries.set(instanceId, { count: attempt, windowStart: withinWindow ? tracker!.windowStart : now });

          if (attempt <= WhatsappService.MAX_PAIRING_RETRIES) {
            this.logger.warn(
              `Instância ${instanceId}: conexão fechada antes do pareamento concluir (tentativa ${attempt}/${WhatsappService.MAX_PAIRING_RETRIES}), tentando de novo automaticamente`,
            );
            this.instances.delete(instanceId);
            this.connectInstance(instanceId, phoneNumber).catch((err) =>
              this.logger.error(`Falha ao retentar pareamento de ${instanceId}: ${err.message}`),
            );
          } else {
            this.instances.delete(instanceId);
            this.pairingRetries.delete(instanceId);
            this.logger.warn(
              `Instância ${instanceId}: pareamento não concluído após ${attempt} tentativas, aguardando nova tentativa manual`,
            );
          }
        }
      }
    });

    // Pareamento por codigo (alternativa ao QR - ver README do Baileys): pedido
    // DEPOIS dos listeners acima registrados (senao um connection.update que
    // dispare durante o await abaixo passaria batido). So faz sentido pra uma
    // sessao ainda nao registrada (credenciais novas) - uma sessao ja pareada
    // reconecta sozinha via creds salvas, sem QR nem codigo.
    if (phoneNumber && !sock.authState.creds.registered) {
      try {
        const code = await sock.requestPairingCode(phoneNumber);
        record.pairingCode = code;
        record.status = 'pairing_code';
        this.logger.log(`Instância ${instanceId}: código de pareamento gerado, aguardando pareamento`);
      } catch (err) {
        this.logger.error(`Falha ao gerar código de pareamento pra ${instanceId}: ${err.message}`);
        // Sem isso, se nenhum QR chegar como fallback, o status ficava preso
        // em 'connecting' pra sempre - o check() abaixo nunca resolvia sozinho
        // e o caller (HTTP /connect) só descobria via timeout do axios (30s).
        // Marca como desconectado e encerra o socket pra falhar rápido e claro.
        sock.end(undefined);
        this.instances.delete(instanceId);
      }
    }

    // aguarda o primeiro evento relevante (qr/codigo pronto, conectado, ou fechado) antes de responder
    return new Promise((resolve) => {
      const check = () => {
        const current = this.instances.get(instanceId);
        if (!current) {
          resolve({ status: 'disconnected' });
          return;
        }
        if (current.status !== 'connecting') {
          resolve({ status: current.status, qr: current.qr, pairingCode: current.pairingCode });
          return;
        }
        setTimeout(check, 200);
      };
      setTimeout(check, 200);
    });
  }

  // Apaga a sessão de propósito (não é só reconnect) - pra quando a instância
  // fica presa numa sessão morta/invalida por qualquer motivo (401 do
  // WhatsApp, chave de criptografia trocada, etc) e o usuário precisa
  // reparear do zero sem depender de alguém entrar no servidor pra apagar
  // arquivo a mão.
  async resetInstance(instanceId: string): Promise<void> {
    const existing = this.instances.get(instanceId);
    if (existing) {
      existing.sock.end(undefined);
      this.instances.delete(instanceId);
    }

    const sessionsDir = this.configService.get<string>('sessionsDir');
    const authDir = path.join(sessionsDir, instanceId);
    await rm(authDir, { recursive: true, force: true });
  }

  async getStatus(instanceId: string): Promise<{ status: InstanceStatus; qr?: string; pairingCode?: string }> {
    const instance = this.instances.get(instanceId);
    if (!instance) {
      return { status: 'disconnected' };
    }
    return { status: instance.status, qr: instance.qr, pairingCode: instance.pairingCode };
  }

  async reconnect(instanceId: string): Promise<{ status: InstanceStatus; qr?: string; pairingCode?: string }> {
    // Se ja tem uma conexao em andamento (ex: outro job do worker, processando
    // em paralelo pra essa mesma instancia, pediu reconnect ao mesmo tempo),
    // so espera ela em vez de matar o socket no meio do handshake - sem essa
    // checagem, N chamadas concorrentes ficavam derrubando e recriando a
    // conexao umas das outras em loop (visto em producao: disparo em rajada
    // derrubando a instancia por alguns segundos logo apos o pareamento).
    const inFlight = this.connecting.get(instanceId);
    if (inFlight) {
      return inFlight;
    }

    const existing = this.instances.get(instanceId);
    if (existing) {
      existing.sock.end(undefined);
      this.instances.delete(instanceId);
    }
    return this.connectInstance(instanceId);
  }

  async sendMessage(
    instanceId: string,
    to: string,
    text: string,
    imageUrl?: string,
    idempotencyKey?: string,
    documentFileName?: string,
  ): Promise<{ messageId: string }> {
    if (idempotencyKey) {
      const existing = this.recentSends.get(idempotencyKey);
      if (existing) {
        this.logger.warn(`Envio duplicado detectado (messageId=${idempotencyKey}) - reaproveitando chamada em andamento/recente`);
        return existing;
      }
    }

    const instance = this.instances.get(instanceId);
    if (!instance || instance.status !== 'connected') {
      throw new InstanceNotConnectedError(`Instance ${instanceId} is not connected`);
    }

    const jid = await this.resolveJid(instance, to);
    // Baileys baixa a URL sozinho (não precisamos buscar os bytes aqui) - texto
    // da campanha vira legenda quando tem imagem/documento. documentFileName
    // presente = PDF (manda como "document"), senão imageUrl presente = imagem.
    const content = documentFileName
      ? { document: { url: imageUrl }, mimetype: 'application/pdf', fileName: documentFileName, caption: text }
      : imageUrl
        ? { image: { url: imageUrl }, caption: text }
        : { text };
    const sendPromise = instance.sock.sendMessage(jid, content).then((result) => ({ messageId: result?.key?.id }));

    if (idempotencyKey) {
      this.recentSends.set(idempotencyKey, sendPromise);
      sendPromise.catch(() => undefined).finally(() => {
        setTimeout(() => this.recentSends.delete(idempotencyKey), WhatsappService.SEND_DEDUP_TTL_MS).unref();
      });
    }

    return sendPromise;
  }

  // Modo AGRESSIVO do disparo de teste (Ant_CRM_Bn/src/test-dispatch) - abre
  // uma SEGUNDA conexao Baileys concorrente na MESMA sessao (mesmas
  // credenciais/authDir) enquanto a principal segue viva, de proposito. O
  // WhatsApp trata isso como "mesmo dispositivo logando em outro lugar" e
  // derruba a principal com um conflito - ela reconecta sozinha (ver
  // connection.update -> wasConnected). Evidencia de producao (log real, ver
  // conversa) mostra que e a PRINCIPAL, alguns segundos DEPOIS desse
  // reconnect, que loga "Closing session" (libsignal derrubando o estado
  // Signal/ratchet da sessao com o contato) - nao a shadow. Por isso essa
  // funcao so FORCA o conflito e devolve o controle assim que a principal
  // volta a 'connected': quem manda a rajada de teste e o caller
  // (TestDispatchService), pela PRINCIPAL, com delayAfterReconnectMs
  // configuravel pra varrer a janela em que esse "Closing session" acontece -
  // mandar pela shadow (versao anterior desse metodo) nao alcancava essa
  // janela real de dano.
  //
  // DESTRUTIVO: pode deixar a instância piscando desconectada/reconectando
  // por um tempo, ou exigir reparear. Só deve ser chamado com a instância já
  // conectada (senão não existe conflito nenhum pra forçar) e com o usuário
  // ciente do risco (ver TestDispatchService.dispatch, que exige
  // acknowledgeAggressiveRisk).
  async forceReconnect(instanceId: string): Promise<{ status: InstanceStatus }> {
    const primary = this.instances.get(instanceId);
    if (!primary || primary.status !== 'connected') {
      throw new InstanceNotConnectedError(`Instance ${instanceId} is not connected`);
    }

    const sessionsDir = this.configService.get<string>('sessionsDir');
    const authDir = path.join(sessionsDir, instanceId);
    const { state: shadowState, saveCreds: shadowSaveCreds } = await useEncryptedMultiFileAuthState(authDir);
    const { version } = await fetchLatestBaileysVersion();

    const shadowSock = makeWASocket({
      version,
      auth: shadowState,
      logger: pino({ level: this.configService.get<string>('logLevel') }) as any,
      printQRInTerminal: false,
      browser: ['Anti-Ban-Shadow', 'Chrome', '1.0.0'],
    });
    shadowSock.ev.on('creds.update', shadowSaveCreds);

    this.logger.warn(
      `[TESTE AGRESSIVO] Instância ${instanceId}: abrindo 2ª conexão concorrente na mesma sessão de propósito ` +
        `(vai forçar a principal a cair e reconectar sozinha).`,
    );

    // Fecha a shadow assim que ELA sinalizar que o conflito ja aconteceu
    // (abriu ou fechou), em vez de esperar um tempo fixo - um teto fixo
    // (ex: 1.5s) segura a shadow viva bem mais tempo do que o necessario,
    // porque a principal reconecta em bem menos que isso (<300ms observado em
    // producao). Nesse meio tempo a shadow ainda de pe gera um SEGUNDO
    // conflito assim que a principal termina de reconectar - visto em
    // producao: dois conflitos encadeados deixaram a conexao num estado
    // degradado (upload de pre-key falhando em loop, erro interno do Baileys
    // ao rodar as queries de init), bem pior que o "um conflito limpo" que
    // esse teste quer isolar.
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      shadowSock.ev.on('connection.update', (update) => {
        if (update.connection === 'open' || update.connection === 'close') finish();
      });
      setTimeout(finish, 4000);
    });
    shadowSock.end(undefined);

    const deadline = Date.now() + 6000;
    while (Date.now() < deadline) {
      const current = this.instances.get(instanceId);
      if (current?.status === 'connected') {
        return { status: 'connected' };
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
    }

    throw new InstanceNotConnectedError(
      `Instância ${instanceId} não voltou a conectar a tempo depois do conflito forçado`,
    );
  }

  async checkNumber(instanceId: string, to: string): Promise<{ exists: boolean; jid?: string }> {
    const instance = this.instances.get(instanceId);
    if (!instance || instance.status !== 'connected') {
      throw new Error(`Instance ${instanceId} is not connected`);
    }

    const digits = to.replace(/\D/g, '');
    const [result] = (await instance.sock.onWhatsApp(digits)) || [];
    return { exists: !!result?.exists, jid: result?.jid };
  }

  // O Baileys nao valida se o numero existe antes de "enviar" - sock.sendMessage()
  // resolve normalmente mesmo pra um JID que nao corresponde a nenhuma conta real
  // (a mensagem so nunca chega). Por isso confirmamos via onWhatsApp antes de mandar,
  // em vez de so montar "digits@s.whatsapp.net" e confiar.
  private async resolveJid(instance: InstanceRecord, to: string): Promise<string> {
    if (to.includes('@')) return to;

    const digits = to.replace(/\D/g, '');
    const [result] = (await instance.sock.onWhatsApp(digits)) || [];

    if (!result?.exists) {
      throw new InvalidRecipientError(`Número ${to} não está registrado no WhatsApp (verificado via onWhatsApp)`);
    }

    return result.jid;
  }

  listInstances(): { instanceId: string; status: InstanceStatus }[] {
    return Array.from(this.instances.entries()).map(([instanceId, { status }]) => ({
      instanceId,
      status,
    }));
  }
}
