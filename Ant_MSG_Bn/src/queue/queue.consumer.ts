import { HttpException, HttpStatus, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { DelayedError, Job, UnrecoverableError } from 'bullmq';
import { EngineService } from '../engine/engine.service';
import { MessageLogService } from '../database/message-log.service';
import { AntiBanService } from '../anti-ban/anti-ban.service';

interface MessageJobData {
  messageLogId: string;
  instanceId: string;
  to: string;
  text: string;
  // true = job originado de um disparo em modo direto no CRM (usuario
  // confirmou ciencia do risco) - pula o espaçamento e os limites do anti-ban
  // de proposito (ver waitForSendSlot).
  skipRateLimit?: boolean;
  // URL da imagem/PDF da campanha (servida pelo proprio crm-api) - o engine
  // baixa sozinho, o worker so repassa a URL adiante
  imageUrl?: string;
  // presença = tratar imageUrl como documento (PDF) em vez de imagem - ver
  // Ant_CRM_Bn/src/campaigns/campaigns.service.ts (dispatch)
  documentFileName?: string;
  // timestamp (Date.now()) de quando o job encontrou a instancia desconectada
  // pela PRIMEIRA vez - usado pra limitar por quanto tempo total ficamos
  // reagendando em vez de desistir. Preenchido pelo proprio worker.
  instanceWaitStartedAt?: number;
  // quantas vezes ESTE job ja foi reagendado por rate limit do provedor (429
  // do engine). Preenchido pelo proprio worker - ver deferForProviderRateLimit.
  rateLimitDeferrals?: number;
}

type ErrorKind = 'permanent' | 'transient' | 'rate_limited';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Ordem de processamento de cada mensagem (ver process):
//   1. waitForInstance  - instância conectada? senão reagenda sem gastar nada
//   2. waitForSendSlot  - é a vez dela no espaçamento/limites? senão reagenda
//   3. send             - chama o engine
//   4. handleSendFailure - classifica o erro: desiste, retenta ou pausa a instância
//
// "Reagendar" aqui é sempre job.moveToDelayed + DelayedError: o job volta pra
// fila como 'delayed' SEM consumir os "attempts" do BullMQ - attempts ficam
// reservados pra falha de envio de verdade.
@Injectable()
@Processor('messages') // Nome da fila
export class MessageConsumer extends WorkerHost implements OnApplicationBootstrap {
  private readonly logger = new Logger(MessageConsumer.name);
  private processingQueue: Set<string> = new Set();
  // Throttle de /reconnect por instancia (em memoria - vale enquanto so existe
  // 1 replica do msg-worker, que e o caso hoje no docker-compose). Evita que
  // um lote de centenas de mensagens pra mesma instancia caida disparem
  // reconexoes concorrentes, cada uma derrubando o socket que a anterior
  // acabou de recriar.
  private readonly reconnectNotBefore: Map<string, number> = new Map();
  // Serializa a chamada ao engine por instância (mutex por instanceId via
  // encadeamento de promises) - o espaçamento em si é decidido no Redis
  // (AntiBanService.acquireSendSlot); isto aqui só garante que dois /send da
  // MESMA instância nunca ficam em voo ao mesmo tempo, inclusive no modo
  // direto, que não passa pelo espaçamento.
  private readonly instanceLocks: Map<string, Promise<unknown>> = new Map();

  constructor(
    private engineService: EngineService,
    private messageLogService: MessageLogService,
    private configService: ConfigService,
    private antiBanService: AntiBanService,
  ) {
    super();
  }

  // onApplicationBootstrap (e não onModuleInit): o Worker do BullMQ só existe
  // depois que o @nestjs/bullmq registra os processors. Sem aplicar aqui, o
  // worker rodava com a concorrência default do BullMQ (1), ignorando
  // WORKER_CONCURRENCY.
  onApplicationBootstrap() {
    const concurrency = this.configService.get<number>('worker.concurrency');
    this.worker.concurrency = concurrency;
    this.logger.log(`Worker initialized with concurrency: ${concurrency}`);
  }

  async process(job: Job<MessageJobData>, token?: string): Promise<void> {
    const { messageLogId } = job.data;

    this.logger.debug(`Processing job ${job.id} for message ${messageLogId}`);

    // Previne processamento duplicado (safety net)
    if (this.processingQueue.has(messageLogId)) {
      this.logger.warn(`Message ${messageLogId} already being processed`);
      return;
    }

    // Instância ANTES do espaçamento: uma queda de conexão não deveria
    // consumir cota de envio nem ocupar lugar na fila de espera à toa.
    await this.waitForInstance(job, token);
    await this.waitForSendSlot(job, token);

    this.processingQueue.add(messageLogId);
    try {
      const result = await this.send(job.data);
      await this.messageLogService.updateStatus(messageLogId, 'sent', { messageId: result?.messageId });
      this.logger.log(`✅ Message ${messageLogId} sent successfully`);
    } catch (error) {
      await this.handleSendFailure(job, token, error);
    } finally {
      this.processingQueue.delete(messageLogId);
    }
  }

  // Garante que a instância está 'connected' antes de gastar cota/tempo
  // tentando enviar. Se não estiver: dispara reconexão (throttlada) e reagenda
  // o job pra reavaliar em breve, SEM contar como retry/falha - queda de
  // conexão e reconexão pós-QR (515, ver Ant_Engine_Bn/whatsapp.service.ts)
  // são recuperação esperada, não erro de envio. Só desiste (e marca 'failed'
  // de vez) se a instância ficar fora por mais que instanceWaitTimeoutMs.
  private async waitForInstance(job: Job<MessageJobData>, token: string | undefined): Promise<void> {
    const { instanceId, messageLogId } = job.data;
    const status = await this.engineService.getInstanceStatus(instanceId);
    if (status === 'connected') {
      return;
    }

    const waitTimeoutMs = this.configService.get<number>('worker.instanceWaitTimeoutMs');
    const startedAt = job.data.instanceWaitStartedAt ?? Date.now();
    if (job.data.instanceWaitStartedAt === undefined) {
      await job.updateData({ ...job.data, instanceWaitStartedAt: startedAt });
    }
    const waitedMs = Date.now() - startedAt;

    if (waitedMs >= waitTimeoutMs) {
      const minutes = Math.round(waitTimeoutMs / 60_000);
      this.logger.error(
        `Instância ${instanceId} indisponível (status=${status}) há mais de ${minutes}min - desistindo da mensagem ${messageLogId}`,
      );
      await this.messageLogService.updateStatus(messageLogId, 'failed', {
        error: `Instância ${instanceId} ficou indisponível (status=${status}) por mais de ${minutes} minutos`,
      });
      throw new UnrecoverableError(`Instância ${instanceId} indisponível há mais de ${minutes}min`);
    }

    // 'unknown' (engine inalcançável) e 'connecting'/'qr_code' (ja em
    // andamento - auto-heal do engine ou aguardando o usuario escanear) nao
    // pedem reconexao nova, so 'disconnected' de verdade pede um empurrao.
    if (status === 'disconnected') {
      this.triggerReconnect(instanceId);
    }

    const recheckDelayMs = this.configService.get<number>('worker.instanceRecheckDelayMs');
    this.logger.warn(
      `Instância ${instanceId} não conectada (status=${status}) - mensagem ${messageLogId} reagendada em ${recheckDelayMs}ms (aguardando há ${Math.round(waitedMs / 1000)}s)`,
    );
    await this.reschedule(job, token, Date.now() + recheckDelayMs);
  }

  // Espaçamento + limites por instância (ver AntiBanService.acquireSendSlot).
  // Sai daqui só quando for a hora de enviar; se a vez ainda está longe, o job
  // volta pra fila com o horário dele em vez de dormir aqui segurando um slot
  // de concorrência que outra instância poderia estar usando.
  //
  // skipRateLimit (modo direto, risco assumido pelo usuario - ver
  // CampaignsService.dispatch) pula espaçamento e limites. A única coisa que
  // ele ainda respeita é a pausa por rate limit do PROVEDOR: insistir durante
  // um 429 da Meta/WhatsApp só gera mais falha e piora a reputação do número.
  private async waitForSendSlot(job: Job<MessageJobData>, token: string | undefined): Promise<void> {
    const { instanceId, messageLogId, skipRateLimit } = job.data;

    if (skipRateLimit) {
      const cooldownMs = await this.antiBanService.getCooldownRemainingMs(instanceId);
      if (cooldownMs > 0) {
        this.logger.warn(`Job ${job.id} (${messageLogId}) em modo direto aguardando pausa do provedor (${cooldownMs}ms)`);
        await this.reschedule(job, token, Date.now() + cooldownMs);
      }
      this.logger.warn(`Job ${job.id} (${messageLogId}) pulando o anti-ban - disparo em modo direto`);
      return;
    }

    const slot = await this.antiBanService.acquireSendSlot(instanceId);
    if (slot.granted === false) {
      this.logger.debug(`Job ${job.id} adiado até ${new Date(slot.retryAt).toISOString()}: ${slot.detail}`);
      await this.reschedule(job, token, slot.retryAt);
      return;
    }

    const inlineWaitMs = slot.sendAt - Date.now();
    if (inlineWaitMs > 0) {
      await sleep(inlineWaitMs);
    }
  }

  // messageLogId vai como chave de idempotencia (protege contra duplicar o
  // envio se o axios do sendRaw der timeout enquanto o engine ainda esta
  // processando a chamada anterior).
  private send(data: MessageJobData): Promise<any> {
    const { instanceId, to, text, imageUrl, messageLogId, documentFileName } = data;
    return this.runExclusive(instanceId, () => {
      this.logger.debug(`Calling engine sendRaw for ${messageLogId}`);
      return this.engineService.sendRaw(instanceId, to, text, imageUrl, messageLogId, documentFileName);
    });
  }

  // Sempre termina lançando: o tipo do erro lançado é o que diz ao BullMQ o
  // que fazer (UnrecoverableError = desiste, DelayedError = reagendado, erro
  // comum = retry com backoff enquanto houver attempts).
  private async handleSendFailure(job: Job<MessageJobData>, token: string | undefined, error: any): Promise<never> {
    const { messageLogId } = job.data;
    this.logger.error(`❌ Failed to process message ${messageLogId}: ${error.message}`);

    const kind = this.classifyError(error);

    if (kind === 'rate_limited') {
      return this.deferForProviderRateLimit(job, token, error);
    }

    if (kind === 'permanent') {
      this.logger.warn(`Permanent error for ${messageLogId}, marking as failed`);
      await this.messageLogService.updateStatus(messageLogId, 'failed', { error: error.message });
      // UnrecoverableError avisa o BullMQ pra NAO tentar de novo, mesmo com
      // "attempts" ainda disponivel - um Error comum aqui era retentado do
      // mesmo jeito (bug: numero invalido/banido gastava os 3 attempts a toa).
      throw new UnrecoverableError(error.message);
    }

    this.logger.warn(`Transient error for ${messageLogId}, will retry`);
    await this.messageLogService.updateStatus(messageLogId, 'failed', {
      error: `Attempt ${job.attemptsMade + 1} failed: ${error.message}`,
    });
    throw error;
  }

  // Rate limit do provedor não é falha DESTA mensagem - é sinal de que a
  // instância inteira precisa desacelerar. Pausa a instância (todos os outros
  // jobs dela passam a ser adiados pelo acquireSendSlot) e reagenda este pra
  // depois da pausa, sem gastar attempt. Só desiste se a mesma mensagem bater
  // em rate limit maxRateLimitDeferrals vezes seguidas.
  private async deferForProviderRateLimit(
    job: Job<MessageJobData>,
    token: string | undefined,
    error: any,
  ): Promise<never> {
    const { instanceId, messageLogId } = job.data;
    const providerRetryAfterMs = Number((error.getResponse?.() as any)?.retryAfterMs) || 0;
    const { until } = await this.antiBanService.startCooldown(instanceId, providerRetryAfterMs);

    const deferrals = (job.data.rateLimitDeferrals ?? 0) + 1;
    const maxDeferrals = this.configService.get<number>('worker.maxRateLimitDeferrals');
    if (deferrals > maxDeferrals) {
      const message = `Provedor manteve rate limit na instância ${instanceId} por ${maxDeferrals} tentativas: ${error.message}`;
      await this.messageLogService.updateStatus(messageLogId, 'failed', { error: message });
      throw new UnrecoverableError(message);
    }

    await job.updateData({ ...job.data, rateLimitDeferrals: deferrals });
    this.logger.warn(
      `Mensagem ${messageLogId} reagendada por rate limit do provedor (${deferrals}/${maxDeferrals}): ${error.message}`,
    );
    return this.reschedule(job, token, until);
  }

  private async reschedule(job: Job<MessageJobData>, token: string | undefined, at: number): Promise<never> {
    await job.moveToDelayed(at, token);
    throw new DelayedError();
  }

  // Pede reconexão ao engine no máximo 1x por instância a cada
  // instanceReconnectCooldownMs - sem isso, um lote de centenas de mensagens
  // pra mesma instância caída disparariam /reconnect concorrentes, cada uma
  // derrubando o socket que a chamada anterior acabou de recriar.
  private triggerReconnect(instanceId: string): void {
    const cooldownMs = this.configService.get<number>('worker.instanceReconnectCooldownMs');
    const now = Date.now();
    const notBefore = this.reconnectNotBefore.get(instanceId) ?? 0;
    if (now < notBefore) {
      return;
    }
    this.reconnectNotBefore.set(instanceId, now + cooldownMs);

    this.engineService
      .reconnectInstance(instanceId)
      .catch((err) => this.logger.error(`Falha ao pedir reconexão de ${instanceId}: ${err.message}`));
  }

  // Encadeia execuções por instanceId via promise chaining - cada chamada só
  // roda depois que a anterior (mesma instância) terminou, independente de
  // sucesso ou falha. Instâncias diferentes têm cadeias independentes.
  private runExclusive<T>(instanceId: string, fn: () => Promise<T>): Promise<T> {
    const prior = this.instanceLocks.get(instanceId) ?? Promise.resolve();
    const run = prior.catch(() => undefined).then(fn);
    this.instanceLocks.set(instanceId, run.catch(() => undefined));
    return run;
  }

  // Ant_Engine_Bn/src/whatsapp/whatsapp.controller.ts responde com status
  // HTTP distintos por causa (ver comentário lá) - preferível a adivinhar
  // por texto de mensagem de erro, que é frágil.
  private classifyError(error: any): ErrorKind {
    if (error instanceof HttpException) {
      const status = error.getStatus();
      if (status === HttpStatus.TOO_MANY_REQUESTS) return 'rate_limited';
      if (status === HttpStatus.BAD_REQUEST) return 'permanent';
      if (status === HttpStatus.CONFLICT || status === HttpStatus.SERVICE_UNAVAILABLE) return 'transient';
    }

    const message = error.message?.toLowerCase() || '';

    if (
      message.includes('instance not found') ||
      message.includes('invalid number') ||
      message.includes('invalid phone') ||
      message.includes('blocked') ||
      message.includes('banned') ||
      message.includes('permanent')
    ) {
      return 'permanent';
    }

    // Erros transitórios (rede, timeout, etc)
    return 'transient';
  }
}
