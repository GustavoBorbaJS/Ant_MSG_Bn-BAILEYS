import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MessageLog } from '../database/entities/message-log.entity';
import { AntibanReadonlyService } from '../antiban-readonly/antiban-readonly.service';
import { EngineClientService } from './engine-client.service';
import { HealthAiDiagnosis, InstanceHealthAdvisorService } from './instance-health-advisor.service';
import { assessInstanceHealth, HealthAssessment, HealthSignals } from './instance-health.rules';

export interface InstanceHealth extends HealthAssessment {
  instanceId: string;
  checkedAt: string;
  provider: 'baileys' | 'meta_cloud' | 'unknown';
  status: string;
  phoneNumber?: string;
  displayName?: string;
  signals: HealthSignals;
  // null = quem pediu a checagem não tem IA configurada (menu "IA"), ou a IA
  // falhou nesta checagem - aiEnabled diz qual dos dois
  ai: HealthAiDiagnosis | null;
  aiEnabled: boolean;
}

const DAY_MS = 86_400_000;

// Checagem de saúde de uma instância, em três passos:
//   1. coleta os sinais (engine, anti-ban no Redis, entregas no banco)
//   2. aplica as regras fixas -> nota, veredito e checagens (instance-health.rules.ts)
//   3. opcionalmente pede um diagnóstico em texto pra IA de quem pediu a
//      checagem (instance-health-advisor.service.ts)
// Tudo somente leitura: checar a saúde nunca envia mensagem nem mexe em
// contador/aquecimento.
@Injectable()
export class InstanceHealthService {
  private readonly logger = new Logger(InstanceHealthService.name);

  constructor(
    @InjectRepository(MessageLog) private readonly messageLogRepo: Repository<MessageLog>,
    private readonly engineClient: EngineClientService,
    private readonly antibanReadonly: AntibanReadonlyService,
    private readonly advisor: InstanceHealthAdvisorService,
  ) {}

  async check(instanceId: string, requesterId: string): Promise<InstanceHealth> {
    const signals = await this.collectSignals(instanceId);
    const assessment = assessInstanceHealth(signals);
    const ai = await this.advisor.diagnose(requesterId, signals, assessment);

    return {
      instanceId,
      checkedAt: new Date().toISOString(),
      provider: signals.engine?.provider ?? 'unknown',
      status: signals.engine?.status ?? 'unknown',
      phoneNumber: signals.engine?.phoneNumber,
      displayName: signals.engine?.displayName,
      ...assessment,
      signals,
      ai,
      aiEnabled: await this.advisor.isEnabledFor(requesterId),
    };
  }

  private async collectSignals(instanceId: string): Promise<HealthSignals> {
    const [engineResult, warmup, pacing, delivery24h] = await Promise.all([
      this.fetchEngineHealth(instanceId),
      this.antibanReadonly.getUsage(instanceId),
      this.antibanReadonly.getPacingState(instanceId),
      this.countDeliveries(instanceId, new Date(Date.now() - DAY_MS)),
    ]);

    return {
      ...engineResult,
      warmup: { level: warmup.warmupLevel, ageDays: warmup.ageDays, limits: warmup.limits, used: warmup.used },
      pacing,
      delivery24h,
    };
  }

  // Engine fora do ar é um resultado da checagem (vira a checagem 'connection'
  // em 'fail'), não um erro 500 da tela.
  private async fetchEngineHealth(instanceId: string): Promise<Pick<HealthSignals, 'engine' | 'engineError'>> {
    try {
      return { engine: await this.engineClient.getHealth(instanceId) };
    } catch (err) {
      this.logger.warn(`Engine não respondeu à checagem de saúde de ${instanceId}: ${err.message}`);
      return { engine: null, engineError: err.message };
    }
  }

  private async countDeliveries(instanceId: string, since: Date): Promise<HealthSignals['delivery24h']> {
    const rows = await this.messageLogRepo
      .createQueryBuilder('m')
      .select('m.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .where('m.instanceId = :instanceId', { instanceId })
      .andWhere('m.createdAt >= :since', { since })
      .groupBy('m.status')
      .getRawMany<{ status: 'sent' | 'failed' | 'pending'; count: string }>();

    const delivery = { sent: 0, failed: 0, pending: 0 };
    for (const row of rows) {
      delivery[row.status] = Number(row.count);
    }
    return delivery;
  }
}
