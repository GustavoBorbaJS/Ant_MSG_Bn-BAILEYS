import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OptOut } from '../database/entities/opt-out.entity';
import { InstanceOwnersModule } from '../instance-owners/instance-owners.module';
import { OptOutsInternalController } from './opt-outs.controller';
import { OptOutsService } from './opt-outs.service';

@Module({
  imports: [TypeOrmModule.forFeature([OptOut]), InstanceOwnersModule],
  controllers: [OptOutsInternalController],
  providers: [OptOutsService],
  exports: [OptOutsService],
})
export class OptOutsModule {}
