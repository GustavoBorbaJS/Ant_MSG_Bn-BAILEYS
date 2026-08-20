import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { MessageConsumer } from './queue.consumer';
import { EngineModule } from '../engine/engine.module';
import { DatabaseModule } from '../database/database.module';
import { AntiBanModule } from '../anti-ban/anti-ban.module';

const isRedisConfigured = Boolean(process.env.REDIS_HOST || process.env.REDIS_URL);

@Module({
  imports: [
    ...(isRedisConfigured
      ? [
          BullModule.forRootAsync({
            useFactory: (configService: ConfigService) => ({
              connection: {
                host: configService.get('redis.host') || process.env.REDIS_HOST || 'localhost',
                port: configService.get('redis.port') || Number(process.env.REDIS_PORT) || 6379,
                password: configService.get('redis.password') || process.env.REDIS_PASSWORD || undefined,
              },
              defaultJobOptions: {
                attempts: configService.get('worker.retryAttempts', 3),
                backoff: {
                  type: 'exponential',
                  delay: configService.get('worker.retryDelay', 5000),
                },
                removeOnComplete: 100,
                removeOnFail: 200,
              },
            }),
            inject: [ConfigService],
          }),
          BullModule.registerQueue({
            name: 'messages',
          }),
          EngineModule,
          DatabaseModule,
          AntiBanModule,
        ]
      : []),
  ],
  providers: isRedisConfigured ? [MessageConsumer] : [],
})
export class QueueModule {}