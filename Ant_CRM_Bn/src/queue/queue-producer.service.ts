import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';

interface MessageJobData {
  messageLogId: string;
  instanceId: string;
  to: string;
  text: string;
  // true = disparo em modo direto, pula o checkRateLimit no worker
  // (Ant_MSG_Bn/src/queue/queue.consumer.ts) - ver CampaignsService.dispatch
  skipRateLimit?: boolean;
  // URL da imagem da campanha (servida por essa própria API) - ver
  // CampaignsService.dispatch/getImagePath
  imageUrl?: string;
}

// Produtor pra fila 'messages' que o worker (Ant_MSG_Bn/src/queue/queue.consumer.ts)
// consome. Replica EXATAMENTE o defaultJobOptions de
// Ant_MSG_Bn/src/queue/queue.module.ts - sem isso, jobs originados pelo CRM teriam
// retry/limpeza diferentes dos jobs originados pelo worker/scripts.
@Injectable()
export class QueueProducerService implements OnModuleDestroy {
  private readonly queue: Queue<MessageJobData>;

  constructor(private configService: ConfigService) {
    this.queue = new Queue('messages', {
      connection: {
        host: this.configService.get('redis.host'),
        port: this.configService.get('redis.port'),
        password: this.configService.get('redis.password') || undefined,
      },
      defaultJobOptions: {
        attempts: this.configService.get('worker.retryAttempts'),
        backoff: {
          type: 'exponential',
          delay: this.configService.get('worker.retryDelay'),
        },
        removeOnComplete: 100,
        removeOnFail: 200,
      },
    });
  }

  async onModuleDestroy() {
    await this.queue.close();
  }

  enqueue(data: MessageJobData, opts?: { delay?: number }) {
    return this.queue.add('send-message', data, opts?.delay ? { delay: opts.delay } : undefined);
  }

  getJobCounts() {
    return this.queue.getJobCounts();
  }
}
