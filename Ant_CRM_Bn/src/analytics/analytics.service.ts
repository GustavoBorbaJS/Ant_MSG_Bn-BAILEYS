import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MessageLog } from '../database/entities/message-log.entity';
import { QueueProducerService } from '../queue/queue-producer.service';
import { EngineClientService } from '../instances/engine-client.service';
import { AntibanReadonlyService } from '../antiban-readonly/antiban-readonly.service';
import { InstanceOwnersService, RequesterInfo } from '../instance-owners/instance-owners.service';

const WAIT_BUCKETS = [
  { label: '<5s', max: 5 },
  { label: '5-15s', max: 15 },
  { label: '15-30s', max: 30 },
  { label: '30-60s', max: 60 },
  { label: '1-5min', max: 300 },
  { label: '5min+', max: Infinity },
];

type StatusCounts = { sent: number; failed: number; pending: number };

@Injectable()
export class AnalyticsService {
  constructor(
    @InjectRepository(MessageLog)
    private readonly messageLogRepo: Repository<MessageLog>,
    private readonly queueProducer: QueueProducerService,
    private readonly engineClient: EngineClientService,
    private readonly antibanReadonly: AntibanReadonlyService,
    private readonly instanceOwners: InstanceOwnersService,
  ) {}

  // Totais por status do período pedido e do período imediatamente anterior
  // de MESMA duração - é contra ele que o painel calcula as variações ("+12%
  // vs período anterior"). Contado por createdAt, como o gráfico de tráfego,
  // pra os números do topo baterem com a soma das barras.
  async getSummary(ownerId: string, since: Date) {
    const until = new Date();
    const previousSince = new Date(since.getTime() - (until.getTime() - since.getTime()));

    const [current, previous] = await Promise.all([
      this.countByStatus(ownerId, since, until),
      this.countByStatus(ownerId, previousSince, since),
    ]);

    return { since: since.toISOString(), until: until.toISOString(), current, previous };
  }

  private async countByStatus(ownerId: string, from: Date, to: Date): Promise<StatusCounts> {
    const rows = await this.messageLogRepo
      .createQueryBuilder('m')
      .select('m.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .where('m.dispatchedBy = :ownerId', { ownerId })
      .andWhere('m.createdAt >= :from AND m.createdAt < :to', { from, to })
      .groupBy('m.status')
      .getRawMany<{ status: keyof StatusCounts; count: string }>();

    const counts: StatusCounts = { sent: 0, failed: 0, pending: 0 };
    for (const row of rows) {
      counts[row.status] = Number(row.count);
    }
    return counts;
  }

  async getTraffic(ownerId: string, instanceId: string | undefined, since: Date) {

    const qb = this.messageLogRepo
      .createQueryBuilder('m')
      .select("date_trunc('hour', m.createdAt)", 'hour')
      .addSelect('m.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .where('m.createdAt >= :since', { since })
      .andWhere('m.dispatchedBy = :ownerId', { ownerId })
      .groupBy('hour')
      .addGroupBy('m.status')
      .orderBy('hour', 'ASC');

    if (instanceId) qb.andWhere('m.instanceId = :instanceId', { instanceId });

    const rows = await qb.getRawMany<{ hour: Date; status: string; count: string }>();

    const buckets = new Map<string, { hour: string; sent: number; failed: number; pending: number }>();
    for (const row of rows) {
      const key = row.hour.toISOString();
      if (!buckets.has(key)) buckets.set(key, { hour: key, sent: 0, failed: 0, pending: 0 });
      const bucket = buckets.get(key)!;
      bucket[row.status as 'sent' | 'failed' | 'pending'] = Number(row.count);
    }

    return Array.from(buckets.values()).sort((a, b) => a.hour.localeCompare(b.hour));
  }

  async getQueueDepth() {
    return this.queueProducer.getJobCounts();
  }

  async getWaitTime(ownerId: string, instanceId: string | undefined, since: Date) {

    const qb = this.messageLogRepo
      .createQueryBuilder('m')
      .select('EXTRACT(EPOCH FROM (m.sentAt - m.createdAt))', 'waitSeconds')
      .where('m.status = :status', { status: 'sent' })
      .andWhere('m.sentAt IS NOT NULL')
      .andWhere('m.createdAt >= :since', { since })
      .andWhere('m.dispatchedBy = :ownerId', { ownerId });

    if (instanceId) qb.andWhere('m.instanceId = :instanceId', { instanceId });

    const rows = await qb.getRawMany<{ waitSeconds: string }>();

    const histogram = WAIT_BUCKETS.map((b) => ({ label: b.label, count: 0 }));
    for (const row of rows) {
      const seconds = Number(row.waitSeconds);
      const index = WAIT_BUCKETS.findIndex((b) => seconds < b.max);
      histogram[index === -1 ? histogram.length - 1 : index].count += 1;
    }

    return histogram;
  }

  async getWarmupOverview(requester: RequesterInfo) {
    const instances = await this.engineClient.listInstances();
    const ownedIds = new Set(
      await this.instanceOwners.listOwnedInstanceIds(
        requester,
        instances.map((i) => i.instanceId),
      ),
    );

    return Promise.all(
      instances
        .filter((instance) => ownedIds.has(instance.instanceId))
        .map(async (instance) => {
          const usage = await this.antibanReadonly.getUsage(instance.instanceId);
          return { instanceId: instance.instanceId, status: instance.status, ...usage };
        }),
    );
  }
}
