import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InstancesController } from './instances.controller';
import { EngineClientService } from './engine-client.service';
import { InstanceHealthService } from './instance-health.service';
import { InstanceHealthAdvisorService } from './instance-health-advisor.service';
import { MessageLog } from '../database/entities/message-log.entity';
import { AntibanReadonlyModule } from '../antiban-readonly/antiban-readonly.module';
import { InstanceOwnersModule } from '../instance-owners/instance-owners.module';

@Module({
  imports: [TypeOrmModule.forFeature([MessageLog]), AntibanReadonlyModule, InstanceOwnersModule],
  controllers: [InstancesController],
  providers: [EngineClientService, InstanceHealthService, InstanceHealthAdvisorService],
  exports: [EngineClientService, InstanceOwnersModule],
})
export class InstancesModule {}
