import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../database/entities/user.entity';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { CampaignsModule } from '../campaigns/campaigns.module';
import { ContactsModule } from '../contacts/contacts.module';
import { InstanceOwnersModule } from '../instance-owners/instance-owners.module';

@Module({
  // CampaignsModule/ContactsModule/InstanceOwnersModule só entram aqui pra
  // UsersService conseguir apagar tudo que um usuário possui antes de
  // remover ele mesmo (campaigns/contacts/instance_owners têm FK ON DELETE
  // RESTRICT pra users - ver UsersService.remove). Nenhum deles importa
  // UsersModule de volta, sem risco de dependência circular.
  imports: [TypeOrmModule.forFeature([User]), CampaignsModule, ContactsModule, InstanceOwnersModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
