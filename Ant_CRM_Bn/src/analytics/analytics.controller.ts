import { Controller, Get, Query, Req } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';

@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('traffic')
  traffic(@Req() req: any, @Query('instanceId') instanceId?: string, @Query('hours') hours?: string) {
    return this.analyticsService.getTraffic(req.user.sub, instanceId, Number(hours) || 24);
  }

  @Get('queue-depth')
  queueDepth() {
    return this.analyticsService.getQueueDepth();
  }

  @Get('wait-time')
  waitTime(@Req() req: any, @Query('instanceId') instanceId?: string, @Query('hours') hours?: string) {
    return this.analyticsService.getWaitTime(req.user.sub, instanceId, Number(hours) || 24);
  }

  @Get('warmup-overview')
  warmupOverview(@Req() req: any) {
    return this.analyticsService.getWarmupOverview({ id: req.user.sub, role: req.user.role });
  }
}
