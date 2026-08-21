import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InstanceOwner } from '../database/entities/instance-owner.entity';
import { User } from '../database/entities/user.entity';
import { InstanceOwnersService } from './instance-owners.service';

@Module({
  imports: [TypeOrmModule.forFeature([InstanceOwner, User])],
  providers: [InstanceOwnersService],
  exports: [InstanceOwnersService],
})
export class InstanceOwnersModule {}
