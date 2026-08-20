import { Controller, Get, Query } from '@nestjs/common';
import { MessageLogsService } from './message-logs.service';

@Controller('message-logs')
export class MessageLogsController {
  constructor(private readonly messageLogsService: MessageLogsService) {}

  @Get()
  list(
    @Query('instanceId') instanceId?: string,
    @Query('status') status?: string,
    @Query('campaignId') campaignId?: string,
    @Query('contactId') contactId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.messageLogsService.list({
      instanceId,
      status,
      campaignId,
      contactId,
      from,
      to,
      page: Number(page) || 1,
      pageSize: Number(pageSize) || 50,
    });
  }
}
