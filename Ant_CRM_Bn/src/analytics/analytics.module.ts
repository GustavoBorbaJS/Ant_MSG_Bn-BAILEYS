import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { MessageLog } from '../database/entities/message-log.entity';
import { QueueModule } from '../queue/queue.module';
import { InstancesModule } from '../instances/instances.module';
import { AntibanReadonlyModule } from '../antiban-readonly/antiban-readonly.module';
import { InstanceOwnersModule } from '../instance-owners/instance-owners.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([MessageLog]),
    QueueModule,
    InstancesModule,
    AntibanReadonlyModule,
    InstanceOwnersModule,
  ],
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
})
export class AnalyticsModule {}
