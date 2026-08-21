import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { DelayedError, Job, Queue } from 'bullmq';
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
}

@Injectable()
@Processor('messages') // Nome da fila
export class MessageConsumer extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(MessageConsumer.name);
  private processingQueue: Set<string> = new Set();

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

      // Verifica se a instância está conectada
      const status = await this.engineService.getInstanceStatus(instanceId);
      if (status !== 'connected') {
        this.logger.warn(`Instance ${instanceId} is not connected. Attempting reconnection...`);
        
        try {
          await this.engineService.reconnectInstance(instanceId);
          
          // Aguarda reconexão (ajuste conforme necessidade)
          await new Promise(resolve => setTimeout(resolve, 5000));
          
          // Verifica novamente
          const newStatus = await this.engineService.getInstanceStatus(instanceId);
          if (newStatus !== 'connected') {
            throw new Error(`Instance ${instanceId} could not be reconnected. Status: ${newStatus}`);
          }
        } catch (reconnectError) {
          this.logger.error(`Reconnection failed for ${instanceId}: ${reconnectError.message}`);
          
          // Marca como falha permanente
          await this.messageLogService.updateStatus(messageLogId, 'failed', {
            error: `Instance disconnected and reconnection failed: ${reconnectError.message}`,
          });
          
          throw new Error(`Instance ${instanceId} is not connected`);
        }
      }

      // 2. CHAMA A ENGINE
      this.logger.debug(`Calling engine sendRaw for ${messageLogId}`);
      const result = await this.engineService.sendRaw(instanceId, to, text, imageUrl);

      // 3. ATUALIZA COMO SUCESSO
      await this.messageLogService.updateStatus(messageLogId, 'sent', {
        messageId: result?.messageId,
      });

      this.logger.log(`✅ Message ${messageLogId} sent successfully`);

    } catch (error) {
      this.logger.error(`❌ Failed to process message ${messageLogId}: ${error.message}`);

      // 4. TRATA FALHAS E RETRIES
      // BullMQ já gerencia retries automaticamente via attempts e backoff
      // Mas aqui decidimos se vale a pena tentar novamente
      
      const errorType = this.classifyError(error);
      
      if (errorType === 'permanent') {
        // Erros permanentes: não tentar novamente
        this.logger.warn(`Permanent error for ${messageLogId}, marking as failed`);
        
        await this.messageLogService.updateStatus(messageLogId, 'failed', {
          error: error.message,
        });
        
        // Faz o job ser movido para "failed" sem retry
        throw new Error(`Permanent failure: ${error.message}`);
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