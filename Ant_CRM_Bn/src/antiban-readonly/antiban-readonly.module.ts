import { Module } from '@nestjs/common';
import { AntibanReadonlyService } from './antiban-readonly.service';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [SettingsModule],
  providers: [AntibanReadonlyService],
  exports: [AntibanReadonlyService],
})
export class AntibanReadonlyModule {}
