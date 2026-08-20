import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { UpdateAntibanConfigDto } from './dto';
import { Roles } from '../common/roles.decorator';
import { RolesGuard } from '../common/roles.guard';

@Controller('settings')
@UseGuards(RolesGuard)
@Roles('admin')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get('antiban')
  getAntibanConfig() {
    return this.settingsService.getConfig();
  }

  @Put('antiban')
  updateAntibanConfig(@Body() dto: UpdateAntibanConfigDto) {
    return this.settingsService.updateConfig(dto);
  }
}
