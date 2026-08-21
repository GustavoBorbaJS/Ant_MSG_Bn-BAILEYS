import { Body, Controller, Delete, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { CampaignsService } from './campaigns.service';
import { CreateCampaignDto, DispatchCampaignDto, UpdateCampaignDto } from './dto';

@Controller('campaigns')
export class CampaignsController {
  constructor(private readonly campaignsService: CampaignsService) {}

  @Get()
  list(@Req() req: any) {
    return this.campaignsService.list(req.user.sub);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Req() req: any) {
    return this.campaignsService.findOne(id, req.user.sub);
  }

  @Post()
  create(@Body() dto: CreateCampaignDto, @Req() req: any) {
    return this.campaignsService.create(dto, req.user.sub);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateCampaignDto, @Req() req: any) {
    return this.campaignsService.update(id, dto, req.user.sub);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Req() req: any) {
    return this.campaignsService.remove(id, req.user.sub);
  }

  @Get(':id/progress')
  progress(@Param('id') id: string, @Req() req: any) {
    return this.campaignsService.progress(id, req.user.sub);
  }

  @Post(':id/dispatch')
  dispatch(@Param('id') id: string, @Body() dto: DispatchCampaignDto, @Req() req: any) {
    return this.campaignsService.dispatch(id, dto, { id: req.user.sub, role: req.user.role });
  }
}
