import { Controller, Get, Query, Req } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';

const HOUR_MS = 3_600_000;
const MAX_LOOKBACK_MS = 90 * 24 * HOUR_MS;

// Início do período consultado. O painel manda "since" (instante ISO) porque
// "hoje" depende do fuso de quem está olhando, não do servidor; "hours" fica
// como alternativa pra quem só quer "as últimas N horas". Data inválida, no
// futuro ou além de 90 dias cai no padrão de 24h.
function resolveSince(since?: string, hours?: string): Date {
  const now = Date.now();
  const parsed = since ? new Date(since).getTime() : NaN;
  if (Number.isFinite(parsed) && parsed < now && now - parsed <= MAX_LOOKBACK_MS) {
    return new Date(parsed);
  }
  return new Date(now - (Number(hours) || 24) * HOUR_MS);
}

@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('summary')
  summary(@Req() req: any, @Query('since') since?: string, @Query('hours') hours?: string) {
    return this.analyticsService.getSummary(req.user.sub, resolveSince(since, hours));
  }

  @Get('traffic')
  traffic(
    @Req() req: any,
    @Query('instanceId') instanceId?: string,
    @Query('since') since?: string,
    @Query('hours') hours?: string,
  ) {
    return this.analyticsService.getTraffic(req.user.sub, instanceId, resolveSince(since, hours));
  }

  @Get('queue-depth')
  queueDepth() {
    return this.analyticsService.getQueueDepth();
  }

  @Get('wait-time')
  waitTime(
    @Req() req: any,
    @Query('instanceId') instanceId?: string,
    @Query('since') since?: string,
    @Query('hours') hours?: string,
  ) {
    return this.analyticsService.getWaitTime(req.user.sub, instanceId, resolveSince(since, hours));
  }

  @Get('warmup-overview')
  warmupOverview(@Req() req: any) {
    return this.analyticsService.getWarmupOverview({ id: req.user.sub, role: req.user.role });
  }
}
