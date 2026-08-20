import { Module } from '@nestjs/common';
import { AntiBanService } from './anti-ban.service';

@Module({
  providers: [AntiBanService],
  exports: [AntiBanService],
})
export class AntiBanModule {}
