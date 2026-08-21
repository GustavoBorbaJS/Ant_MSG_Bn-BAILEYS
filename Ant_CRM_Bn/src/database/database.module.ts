import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Contact } from './entities/contact.entity';
import { Campaign } from './entities/campaign.entity';
import { MessageLog } from './entities/message-log.entity';
import { User } from './entities/user.entity';
import { InstanceOwner } from './entities/instance-owner.entity';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.get('database.host'),
        port: configService.get('database.port'),
        username: configService.get('database.username'),
        password: configService.get('database.password'),
        database: configService.get('database.database'),
        entities: [Contact, Campaign, MessageLog, User, InstanceOwner],
        // O CRM eh o unico dono do schema (ver Ant_MSG_Bn/database.module.ts,
        // que roda com synchronize:false por causa disso). Mudanca de schema
        // sempre via migration (npm run migration:generate / migration:run).
        synchronize: false,
        logging: false,
      }),
      inject: [ConfigService],
    }),
    TypeOrmModule.forFeature([Contact, Campaign, MessageLog, User, InstanceOwner]),
  ],
  exports: [TypeOrmModule],
})
export class DatabaseModule {}
