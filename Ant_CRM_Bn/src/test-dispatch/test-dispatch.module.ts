import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MessageLog } from '../database/entities/message-log.entity';
import { TestDispatchController } from './test-dispatch.controller';
import { TestDispatchService } from './test-dispatch.service';
import { InstancesModule } from '../instances/instances.module';
import { InstanceOwnersModule } from '../instance-owners/instance-owners.module';

@Module({
  imports: [TypeOrmModule.forFeature([MessageLog]), InstancesModule, InstanceOwnersModule],
  controllers: [TestDispatchController],
  providers: [TestDispatchService],
})
export class TestDispatchModule {}
