import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { createReadStream } from 'fs';
import { CampaignsService } from './campaigns.service';
import { CreateCampaignDto, DispatchCampaignDto, UpdateCampaignDto } from './dto';
import { Public } from '../common/public.decorator';

const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB - bem acima do que o WhatsApp costuma comprimir mesmo

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

  @Post(':id/image')
  @UseInterceptors(FileInterceptor('image', { limits: { fileSize: MAX_IMAGE_SIZE } }))
  setImage(@Param('id') id: string, @UploadedFile() file: Express.Multer.File, @Req() req: any) {
    if (!file) {
      throw new BadRequestException('Nenhuma imagem enviada');
    }
    return this.campaignsService.setImage(id, req.user.sub, file);
  }

  @Delete(':id/image')
  removeImage(@Param('id') id: string, @Req() req: any) {
    return this.campaignsService.removeImage(id, req.user.sub);
  }

  // Sem auth de propósito - ver comentário em CampaignsService.getImagePath
  // (chamado pelo Engine, rede interna, sem token de usuário).
  @Public()
  @Get(':id/image')
  async serveImage(@Param('id') id: string, @Res({ passthrough: true }) res: Response) {
    const image = await this.campaignsService.getImagePath(id);
    if (!image) {
      throw new NotFoundException('Imagem não encontrada');
    }
    res.set({ 'Content-Type': image.mimetype, 'Cache-Control': 'private, max-age=86400' });
    return new StreamableFile(createReadStream(image.path));
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
