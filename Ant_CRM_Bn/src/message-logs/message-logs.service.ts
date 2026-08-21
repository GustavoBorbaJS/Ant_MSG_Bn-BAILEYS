import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MessageLog } from '../database/entities/message-log.entity';

export interface MessageLogFilters {
  instanceId?: string;
  status?: string;
  campaignId?: string;
  contactId?: string;
  dispatchedBy?: string;
  from?: string;
  to?: string;
  page: number;
  pageSize: number;
}

@Injectable()
export class MessageLogsService {
  constructor(
    @InjectRepository(MessageLog)
    private readonly messageLogRepo: Repository<MessageLog>,
  ) {}

  async list(filters: MessageLogFilters) {
    const qb = this.messageLogRepo
      .createQueryBuilder('m')
      .leftJoinAndSelect('m.campaign', 'campaign')
      .leftJoinAndSelect('m.contact', 'contact');

    if (filters.instanceId) qb.andWhere('m.instanceId = :instanceId', { instanceId: filters.instanceId });
    if (filters.status) qb.andWhere('m.status = :status', { status: filters.status });
    if (filters.campaignId) qb.andWhere('m.campaignId = :campaignId', { campaignId: filters.campaignId });
    if (filters.contactId) qb.andWhere('m.contactId = :contactId', { contactId: filters.contactId });
    if (filters.dispatchedBy) qb.andWhere('m.dispatchedBy = :dispatchedBy', { dispatchedBy: filters.dispatchedBy });
    if (filters.from) qb.andWhere('m.createdAt >= :from', { from: filters.from });
    if (filters.to) qb.andWhere('m.createdAt <= :to', { to: filters.to });

    qb.orderBy('m.createdAt', 'DESC')
      .skip((filters.page - 1) * filters.pageSize)
      .take(filters.pageSize);

    const [items, total] = await qb.getManyAndCount();
    return { items, total, page: filters.page, pageSize: filters.pageSize };
  }

  // Igual list(), mas junta o username de quem disparou - usado só pela aba
  // admin de atividade (message-logs/activity), onde dispatchedBy não é
  // forçado pro próprio usuário.
  async listWithDispatcher(filters: MessageLogFilters) {
    const qb = this.messageLogRepo
      .createQueryBuilder('m')
      .leftJoinAndSelect('m.campaign', 'campaign')
      .leftJoinAndSelect('m.contact', 'contact')
      .leftJoin('m.dispatcher', 'dispatcher')
      .addSelect(['dispatcher.id', 'dispatcher.name', 'dispatcher.username']);

    if (filters.instanceId) qb.andWhere('m.instanceId = :instanceId', { instanceId: filters.instanceId });
    if (filters.status) qb.andWhere('m.status = :status', { status: filters.status });
    if (filters.campaignId) qb.andWhere('m.campaignId = :campaignId', { campaignId: filters.campaignId });
    if (filters.contactId) qb.andWhere('m.contactId = :contactId', { contactId: filters.contactId });
    if (filters.dispatchedBy) qb.andWhere('m.dispatchedBy = :dispatchedBy', { dispatchedBy: filters.dispatchedBy });
    if (filters.from) qb.andWhere('m.createdAt >= :from', { from: filters.from });
    if (filters.to) qb.andWhere('m.createdAt <= :to', { to: filters.to });

    qb.orderBy('m.createdAt', 'DESC')
      .skip((filters.page - 1) * filters.pageSize)
      .take(filters.pageSize);

    const [items, total] = await qb.getManyAndCount();
    return { items, total, page: filters.page, pageSize: filters.pageSize };
  }
}
