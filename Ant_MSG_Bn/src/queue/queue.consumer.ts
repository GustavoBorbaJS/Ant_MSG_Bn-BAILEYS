import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { DelayedError, Job, Queue, UnrecoverableError } from 'bullmq';
import { EngineService } from '../engine/engine.service';
import { MessageLogService } from '../database/message-log.service';
import { AntiBanService } from '../anti-ban/anti-ban.service';

interface MessageJobData {
  messageLogId: string;
  instanceId: string;
  to: string;
  text: string;
  // true = job originado de um disparo em modo direto no CRM (usuario
  // confirmou ciencia do risco) - pula o checkRateLimit abaixo de proposito.
  skipRateLimit?: boolean;
  // URL da imagem da campanha (servida pelo proprio crm-api) - o engine baixa
  // sozinho, o worker so repassa a URL adiante
  imageUrl?: string;
  // timestamp (Date.now()) de quando o job encontrou a instancia desconectada
  // pela PRIMEIRA vez - usado pra limitar por quanto tempo total ficamos
  // reagendando em vez de desistir. Preenchido pelo proprio worker.
  instanceWaitStartedAt?: number;
}

// Resultado do "sinal de espera" - a mensagem esta ok pra seguir, ou ja foi
// reagendada/desistida e o caller so precisa lancar o erro certo pro BullMQ.
type ReadinessCheck = { ready: true } | { ready: false; error: Error };

@Injectable()
@Processor('messages') // Nome da fila
export class MessageConsumer extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(MessageConsumer.name);
  private processingQueue: Set<string> = new Set();
  // Throttle de /reconnect por instancia (em memoria - vale enquanto so existe
  // 1 replica do msg-worker, que e o caso hoje no docker-compose). Evita que
  // um lote de centenas de mensagens pra mesma instancia caida disparem
  // reconexoes concorrentes, cada uma derrubando o socket que a anterior
  // acabou de recriar.
  private readonly reconnectNotBefore: Map<string, number> = new Map();

  constructor(
    @InjectQueue('messages') private messageQueue: Queue,
    private engineService: EngineService,
    private messageLogService: MessageLogService,
    private configService: ConfigService,
    private antiBanService: AntiBanService,
  ) {
    super();
  }

  async onModuleInit() {
    // Configura o worker com as opções de concorrência
    const concurrency = this.configService.get('worker.concurrency', 5);
    
    // Aplica a configuração - isso será usado pelo BullMQ
    this.logger.log(`Worker initialized with concurrency: ${concurrency}`);
  }

  async process(job: Job<MessageJobData>, token?: string): Promise<any> {
    const { messageLogId, instanceId, to, text, skipRateLimit, imageUrl } = job.data;

    this.logger.debug(`Processing job ${job.id} for message ${messageLogId}`);

    // Previne processamento duplicado (safety net)
    if (this.processingQueue.has(messageLogId)) {
      this.logger.warn(`Message ${messageLogId} already being processed`);
      return;
    }

    // Confere a instância ANTES de checar rate limit/aplicar delay humano -
    // uma queda de conexão não deveria consumir cota de envio nem tempo de
    // espera à toa. Isso reagenda o job (sem gastar attempt) enquanto a
    // instância nao volta, até um teto configurável.
    const readiness = await this.ensureInstanceReady(job, token);
    if (readiness.ready === false) {
      throw readiness.error;
    }

    // Rate limit por instância (minuto/hora/dia, conforme aquecimento).
    // Se estourou, reagenda o job para quando a janela liberar, sem gastar tentativa/retry.
    // skipRateLimit vem de um disparo em modo direto (CRM) - usuario confirmou
    // ciencia do risco de bloqueio e decidiu pular essa proteção de proposito.
    if (skipRateLimit) {
      this.logger.warn(`Job ${job.id} (${messageLogId}) pulando checkRateLimit - disparo em modo direto`);
    } else {
      const rateLimit = await this.antiBanService.checkRateLimit(instanceId);
      if (!rateLimit.allowed) {
        this.logger.warn(`Job ${job.id} adiado: ${rateLimit.reason}`);
        await job.moveToDelayed(Date.now() + rateLimit.retryAfterMs, token);
        throw new DelayedError();
      }
    }

    this.processingQueue.add(messageLogId);

    try {
      // Delay humano antes de enviar, para não ter um padrão robótico de timing
      await this.antiBanService.applyHumanDelay();

      // CHAMA A ENGINE
      this.logger.debug(`Calling engine sendRaw for ${messageLogId}`);
      const result = await this.engineService.sendRaw(instanceId, to, text, imageUrl);

      // ATUALIZA COMO SUCESSO
      await this.messageLogService.updateStatus(messageLogId, 'sent', {
        messageId: result?.messageId,
      });

      this.logger.log(`✅ Message ${messageLogId} sent successfully`);

    } catch (error) {
      this.logger.error(`❌ Failed to process message ${messageLogId}: ${error.message}`);

      // TRATA FALHAS E RETRIES
      // BullMQ já gerencia retries automaticamente via attempts e backoff
      // Mas aqui decidimos se vale a pena tentar novamente

      const errorType = this.classifyError(error);

      if (errorType === 'permanent') {
        // Erros permanentes: não tentar novamente
        this.logger.warn(`Permanent error for ${messageLogId}, marking as failed`);

        await this.messageLogService.updateStatus(messageLogId, 'failed', {
          error: error.message,
        });

        // UnrecoverableError avisa o BullMQ pra NAO tentar de novo, mesmo com
        // "attempts" ainda disponivel - um Error comum aqui era retentado do
        // mesmo jeito (bug: numero invalido/banido gastava os 3 attempts a toa).
        throw new UnrecoverableError(error.message);
      } else {
        // Erros transitórios: deixar o BullMQ tentar novamente
        this.logger.warn(`Transient error for ${messageLogId}, will retry`);

        // Registra a tentativa falha no banco (opcional)
        await this.messageLogService.updateStatus(messageLogId, 'failed', {
          error: `Attempt ${job.attemptsMade + 1} failed: ${error.message}`,
        });

        // Relança o erro para o BullMQ lidar com o retry
        throw error;
      }

    } finally {
      this.processingQueue.delete(messageLogId);
    }
  }

  // Garante que a instância está 'connected' antes de gastar rate limit/tempo
  // tentando enviar. Se não estiver: dispara reconexão (throttlada) e reagenda
  // o job pra reavaliar em breve, SEM contar como retry/falha - queda de
  // conexão e reconexão pós-QR (515, ver Ant_Engine_Bn/whatsapp.service.ts)
  // são recuperação esperada, não erro de envio. Só desiste (e marca 'failed'
  // de vez) se a instância ficar fora por mais que instanceWaitTimeoutMs.
  private async ensureInstanceReady(job: Job<MessageJobData>, token: string | undefined): Promise<ReadinessCheck> {
    const { instanceId, messageLogId } = job.data;
    const status = await this.engineService.getInstanceStatus(instanceId);
    if (status === 'connected') {
      return { ready: true };
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
      return { ready: false, error: new UnrecoverableError(`Instância ${instanceId} indisponível há mais de ${minutes}min`) };
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
    await job.moveToDelayed(Date.now() + recheckDelayMs, token);
    return { ready: false, error: new DelayedError() };
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

  /**
   * Classifica o erro para decidir se é permanente ou transitório
   */
  private classifyError(error: any): 'permanent' | 'transient' {
    const message = error.message?.toLowerCase() || '';
    
    // Erros permanentes
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