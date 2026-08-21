import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { MessageLogsService } from './message-logs.service';
import { Roles } from '../common/roles.decorator';
import { RolesGuard } from '../common/roles.guard';

@Controller('message-logs')
export class MessageLogsController {
  constructor(private readonly messageLogsService: MessageLogsService) {}

  @Get()
  list(
    @Req() req: any,
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
      // sempre forçado pro próprio usuário - histórico pessoal, não cross-user
      dispatchedBy: req.user.sub,
      from,
      to,
      page: Number(page) || 1,
      pageSize: Number(pageSize) || 50,
    });
  }

  // Aba "Atividade dos usuários" - só admin, mostra envios de todo mundo
  // (opcionalmente filtrados por um usuário específico), sem duplicar
  // contatos/campanhas de cada um.
  @Get('activity')
  @UseGuards(RolesGuard)
  @Roles('admin')
  activity(
    @Query('dispatchedBy') dispatchedBy?: string,
    @Query('instanceId') instanceId?: string,
    @Query('status') status?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.messageLogsService.listWithDispatcher({
      instanceId,
      status,
      dispatchedBy,
      from,
      to,
      page: Number(page) || 1,
      pageSize: Number(pageSize) || 50,
    });
  }
}
