import { Controller, Get, Query } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';

@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('traffic')
  traffic(@Query('instanceId') instanceId?: string, @Query('hours') hours?: string) {
    return this.analyticsService.getTraffic(instanceId, Number(hours) || 24);
  }

  @Get('queue-depth')
  queueDepth() {
    return this.analyticsService.getQueueDepth();
  }

  @Get('wait-time')
  waitTime(@Query('instanceId') instanceId?: string, @Query('hours') hours?: string) {
    return this.analyticsService.getWaitTime(instanceId, Number(hours) || 24);
  }

  @Get('warmup-overview')
  warmupOverview() {
    return this.analyticsService.getWarmupOverview();
  }
}
