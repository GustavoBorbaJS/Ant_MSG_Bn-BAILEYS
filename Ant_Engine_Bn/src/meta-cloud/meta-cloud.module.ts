import { Module } from '@nestjs/common';
import { MetaCloudService } from './meta-cloud.service';

@Module({
  providers: [MetaCloudService],
  exports: [MetaCloudService],
})
export class MetaCloudModule {}
