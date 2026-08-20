import { Module } from '@nestjs/common';
import { QueueProducerService } from './queue-producer.service';

@Module({
  providers: [QueueProducerService],
  exports: [QueueProducerService],
})
export class QueueModule {}
