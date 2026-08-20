import { Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MessageLog } from './entities/message-log.entity';

@Injectable()
export class MessageLogService {
  constructor(
    @Optional()
    @InjectRepository(MessageLog)
    private readonly messageLogRepo?: Repository<MessageLog>,
  ) {}

  async updateStatus(messageLogId: string, status: 'sent' | 'failed', metadata?: any) {
    if (!this.messageLogRepo) {
      return;
    }

    try {
      const updateData: any = {
        status,
        updatedAt: new Date(),
      };

      if (status === 'sent') {
        updateData.sentAt = new Date();
      }

      if (status === 'failed' && metadata?.error) {
        updateData.errorMessage = metadata.error;
        updateData.failedAt = new Date();
      }

      await this.messageLogRepo.update(messageLogId, updateData);
    } catch (error) {
      console.error('Failed to update message log:', error);
    }
  }

  async getMessageLog(messageLogId: string) {
    if (!this.messageLogRepo) {
      return undefined;
    }

    return this.messageLogRepo.findOne({ where: { id: messageLogId } });
  }
}