import { Body, Controller, Delete, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { CampaignsService } from './campaigns.service';
import { CreateCampaignDto, DispatchCampaignDto, UpdateCampaignDto } from './dto';

@Controller('campaigns')
export class CampaignsController {
  constructor(private readonly campaignsService: CampaignsService) {}

  @Get()
  list() {
    return this.campaignsService.list();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.campaignsService.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateCampaignDto) {
    return this.campaignsService.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateCampaignDto) {
    return this.campaignsService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.campaignsService.remove(id);
  }

  @Get(':id/progress')
  progress(@Param('id') id: string) {
    return this.campaignsService.progress(id);
  }

  @Post(':id/dispatch')
  dispatch(@Param('id') id: string, @Body() dto: DispatchCampaignDto, @Req() req: any) {
    return this.campaignsService.dispatch(id, dto, req.user.sub);
  }
}
