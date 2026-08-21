import { Module } from '@nestjs/common';
import { InstancesController } from './instances.controller';
import { EngineClientService } from './engine-client.service';
import { AntibanReadonlyModule } from '../antiban-readonly/antiban-readonly.module';
import { InstanceOwnersModule } from '../instance-owners/instance-owners.module';

@Module({
  imports: [AntibanReadonlyModule, InstanceOwnersModule],
  controllers: [InstancesController],
  providers: [EngineClientService],
  exports: [EngineClientService, InstanceOwnersModule],
})
export class InstancesModule {}
