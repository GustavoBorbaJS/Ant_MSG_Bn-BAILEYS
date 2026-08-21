import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Campaign } from '../database/entities/campaign.entity';
import { Contact } from '../database/entities/contact.entity';
import { MessageLog } from '../database/entities/message-log.entity';
import { CampaignsController } from './campaigns.controller';
import { CampaignsService } from './campaigns.service';
import { QueueModule } from '../queue/queue.module';
import { InstanceOwnersModule } from '../instance-owners/instance-owners.module';

@Module({
  imports: [TypeOrmModule.forFeature([Campaign, Contact, MessageLog]), QueueModule, InstanceOwnersModule],
  controllers: [CampaignsController],
  providers: [CampaignsService],
})
export class CampaignsModule {}
