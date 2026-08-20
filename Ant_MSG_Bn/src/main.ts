import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const logger = new Logger('Bootstrap');
  
  logger.log('🚀 Worker started and ready to process messages');
  
  // Mantém o processo vivo
  process.on('SIGTERM', async () => {
    logger.log('🛑 SIGTERM received, closing gracefully...');
    await app.close();
    process.exit(0);
  });
}

bootstrap();