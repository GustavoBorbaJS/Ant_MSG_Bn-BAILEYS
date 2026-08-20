import { Module } from '@nestjs/common';
import { InstancesController } from './instances.controller';
import { EngineClientService } from './engine-client.service';
import { AntibanReadonlyModule } from '../antiban-readonly/antiban-readonly.module';

@Module({
  imports: [AntibanReadonlyModule],
  controllers: [InstancesController],
  providers: [EngineClientService],
  exports: [EngineClientService],
})
export class InstancesModule {}
