import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiSettings } from '../database/entities/ai-settings.entity';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { CampaignCopywriterService } from './campaign-copywriter.service';

@Module({
  imports: [TypeOrmModule.forFeature([AiSettings])],
  controllers: [AiController],
  providers: [AiService, CampaignCopywriterService],
  exports: [AiService],
})
export class AiModule {}
