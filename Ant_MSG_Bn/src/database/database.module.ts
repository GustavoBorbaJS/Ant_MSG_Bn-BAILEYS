import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { MessageLog } from './entities/message-log.entity';
import { MessageLogService } from './message-log.service';

const isDatabaseConfigured = Boolean(
  process.env.DB_HOST || process.env.DB_NAME || process.env.DATABASE_URL,
);

@Module({
  imports: [
    ...(isDatabaseConfigured
      ? [
          TypeOrmModule.forRootAsync({
            useFactory: (configService: ConfigService) => ({
              type: 'postgres',
              host: configService.get('database.host') || process.env.DB_HOST || 'localhost',
              port: configService.get('database.port') || Number(process.env.DB_PORT) || 5432,
              username: configService.get('database.username') || process.env.DB_USERNAME || 'postgres',
              password: configService.get('database.password') || process.env.DB_PASSWORD || 'postgres',
              database: configService.get('database.database') || process.env.DB_NAME || 'wa_saas',
              entities: [MessageLog],
              // O Ant_CRM_Bn é o único dono do schema (migrations em
              // Ant_CRM_Bn/src/database/migrations). NUNCA ligar synchronize aqui de
              // novo: como esta entidade não conhece campaignId/contactId (colunas
              // do CRM), rodar synchronize:true aqui apagaria essas colunas no
              // próximo boot do worker.
              synchronize: false,
              logging: false,
            }),
            inject: [ConfigService],
          }),
          TypeOrmModule.forFeature([MessageLog]),
        ]
      : []),
  ],
  providers: [MessageLogService],
  exports: [MessageLogService],
})
export class DatabaseModule {}