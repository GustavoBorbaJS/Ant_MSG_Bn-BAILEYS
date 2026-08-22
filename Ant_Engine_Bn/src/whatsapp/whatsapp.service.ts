import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as path from 'path';
import { rm } from 'fs/promises';
import * as QRCode from 'qrcode';
import { pino } from 'pino';
import { Boom } from '@hapi/boom';
import makeWASocket, { DisconnectReason, fetchLatestBaileysVersion, WASocket } from '@whiskeysockets/baileys';
import { useEncryptedMultiFileAuthState } from './encrypted-auth-state';

export type InstanceStatus = 'connecting' | 'qr_code' | 'connected' | 'disconnected';

interface InstanceRecord {
  sock: WASocket;
  status: InstanceStatus;
  qr?: string;
}

@Injectable()
export class WhatsappService implements OnModuleDestroy {
  private readonly logger = new Logger(WhatsappService.name);
  private readonly instances = new Map<string, InstanceRecord>();
  // evita duas conexoes concorrentes para a mesma instancia (ex: dois /connect quase simultaneos)
  private readonly connecting = new Map<string, Promise<{ status: InstanceStatus; qr?: string }>>();

  constructor(private configService: ConfigService) {}

  onModuleDestroy() {
    for (const { sock } of this.instances.values()) {
      sock.end(undefined);
    }
  }

  async connectInstance(instanceId: string): Promise<{ status: InstanceStatus; qr?: string }> {
    const existing = this.instances.get(instanceId);
    if (existing && (existing.status === 'connected' || existing.status === 'connecting')) {
      return { status: existing.status, qr: existing.qr };
    }

    const inFlight = this.connecting.get(instanceId);
    if (inFlight) {
      return inFlight;
    }

    const promise = this.openConnection(instanceId);
    this.connecting.set(instanceId, promise);
    try {
      return await promise;
    } finally {
      this.connecting.delete(instanceId);
    }
  }

  private async openConnection(instanceId: string): Promise<{ status: InstanceStatus; qr?: string }> {
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

      if (qr) {
        record.qr = await QRCode.toDataURL(qr);
        record.status = 'qr_code';
        this.logger.log(`Instância ${instanceId}: QR code gerado, aguardando pareamento`);
      }

      if (connection === 'open') {
        record.status = 'connected';
        record.qr = undefined;
        this.logger.log(`Instância ${instanceId}: conectada`);
      }

      if (connection === 'close') {
        const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
        const loggedOut = statusCode === DisconnectReason.loggedOut;
        // captura ANTES de sobrescrever pra 'disconnected' - decide se vale a
        // pena reconectar sozinho ou nao
        const wasConnected = record.status === 'connected';

        record.status = 'disconnected';
        this.logger.warn(
          `Instância ${instanceId}: desconectada (statusCode=${statusCode}, loggedOut=${loggedOut})`,
        );

        if (loggedOut) {
          this.instances.delete(instanceId);
          // WhatsApp invalidou a sessão do lado deles (401) - sem isso, a
          // proxima tentativa de conectar carregava a MESMA sessão morta do
          // disco e falhava de novo, em loop, sem nunca gerar QR novo pra
          // repareamento. Apaga a sessao inteira: so credenciais mortas ficam
          // pra tras mesmo, nao tem o que reaproveitar depois de um loggedOut.
          rm(authDir, { recursive: true, force: true }).catch((err) =>
            this.logger.error(`Falha ao limpar sessão de ${instanceId} após logout: ${err.message}`),
          );
        } else if (wasConnected) {
          // so reconecta sozinho se JA estava de verdade conectada (queda de
          // rede, etc) - isso e uma recuperacao legitima
          this.connectInstance(instanceId).catch((err) =>
            this.logger.error(`Falha ao reconectar ${instanceId}: ${err.message}`),
          );
        } else {
          // fechou sem nunca ter conectado de verdade (QR gerado mas ninguem
          // escaneou a tempo, handshake falhou, etc) - NAO fica tentando de
          // novo sozinho pra sempre (gerava um loop infinito de QR novo a
          // cada ~9s, visto em producao). So marca desconectado e espera o
          // usuario clicar em "Parear"/"Ver QR" de novo quando estiver pronto.
          this.instances.delete(instanceId);
          this.logger.warn(`Instância ${instanceId}: pareamento não concluído, aguardando nova tentativa manual`);
        }
      }
    });

    // aguarda o primeiro evento relevante (qr pronto, conectado, ou fechado) antes de responder
    return new Promise((resolve) => {
      const check = () => {
        const current = this.instances.get(instanceId);
        if (!current) {
          resolve({ status: 'disconnected' });
          return;
        }
        if (current.status !== 'connecting') {
          resolve({ status: current.status, qr: current.qr });
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

  async getStatus(instanceId: string): Promise<{ status: InstanceStatus; qr?: string }> {
    const instance = this.instances.get(instanceId);
    if (!instance) {
      return { status: 'disconnected' };
    }
    return { status: instance.status, qr: instance.qr };
  }

  async reconnect(instanceId: string): Promise<{ status: InstanceStatus; qr?: string }> {
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

  async sendMessage(instanceId: string, to: string, text: string, imageUrl?: string): Promise<{ messageId: string }> {
    const instance = this.instances.get(instanceId);
    if (!instance || instance.status !== 'connected') {
      throw new Error(`Instance ${instanceId} is not connected`);
    }

    const jid = await this.resolveJid(instance, to);
    // Baileys baixa a URL sozinho (não precisamos buscar os bytes aqui) - texto
    // da campanha vira legenda quando tem imagem
    const content = imageUrl ? { image: { url: imageUrl }, caption: text } : { text };
    const result = await instance.sock.sendMessage(jid, content);

    return { messageId: result?.key?.id };
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
      throw new Error(`Número ${to} não está registrado no WhatsApp (verificado via onWhatsApp)`);
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
