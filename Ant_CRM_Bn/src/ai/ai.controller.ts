import { Body, Controller, Delete, Get, HttpCode, Post, Put, Req } from '@nestjs/common';
import { IsOptional, IsString, Length, MaxLength } from 'class-validator';
import { AiService } from './ai.service';
import { CampaignCopywriterService } from './campaign-copywriter.service';

class ListAiModelsDto {
  @IsString()
  @Length(1, 30)
  provider: string;

  // ausente = usar a chave já salva pra esse provedor
  @IsOptional()
  @IsString()
  @MaxLength(500)
  apiKey?: string;
}

class SaveAiSettingsDto extends ListAiModelsDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  model?: string;
}

class ImproveTextDto {
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  text?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  instruction?: string;
}

// Tudo aqui é do PRÓPRIO usuário logado (req.user.sub): cada um cadastra a
// sua chave e só enxerga a sua configuração. Nenhuma rota devolve a chave.
@Controller('ai')
export class AiController {
  constructor(
    private readonly aiService: AiService,
    private readonly copywriter: CampaignCopywriterService,
  ) {}

  @Get('settings')
  getSettings(@Req() req: any) {
    return this.aiService.getSettings(req.user.sub);
  }

  @Put('settings')
  saveSettings(@Body() dto: SaveAiSettingsDto, @Req() req: any) {
    return this.aiService.saveSettings(req.user.sub, dto.provider, dto.model, dto.apiKey);
  }

  @Delete('settings')
  removeSettings(@Req() req: any) {
    return this.aiService.removeSettings(req.user.sub);
  }

  @Post('models')
  @HttpCode(200)
  listModels(@Body() dto: ListAiModelsDto, @Req() req: any) {
    return this.aiService.listModels(req.user.sub, dto.provider, dto.apiKey);
  }

  // Chamada real, mínima, com a configuração salva - confirma que chave e
  // modelo funcionam juntos (listar modelos só valida a chave).
  @Post('test')
  @HttpCode(200)
  async test(@Req() req: any) {
    const { model } = await this.aiService.complete(
      req.user.sub,
      'Você está respondendo a um teste de conexão de um sistema.',
      'Responda apenas com a palavra: ok',
    );
    return { ok: true, model };
  }

  @Post('improve-text')
  @HttpCode(200)
  improveText(@Body() dto: ImproveTextDto, @Req() req: any) {
    return this.copywriter.improve(req.user.sub, dto.text ?? '', dto.instruction ?? '');
  }
}
