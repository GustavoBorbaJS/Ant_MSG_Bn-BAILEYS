import { Body, Controller, HttpCode, Post, Req, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import { IsString, Length, Matches } from 'class-validator';
import { Public } from '../common/public.decorator';
import { OptOutsService } from './opt-outs.service';

class RegisterOptOutReplyDto {
  @IsString()
  @Matches(/^[a-zA-Z0-9_-]{1,64}$/, { message: 'instanceId inválido' })
  instanceId: string;

  @IsString()
  @Matches(/^[0-9]{8,15}$/, { message: 'phone deve conter só dígitos' })
  phone: string;

  @IsString()
  @Length(1, 1000)
  text: string;
}

// Única rota do CRM chamada pelo ENGINE (o sentido normal é o contrário). Não
// tem usuário logado, então fica fora do JwtAuthGuard (@Public) e se
// autentica com o mesmo ENGINE_API_KEY que o CRM já usa pra chamar o engine -
// é o segredo que os dois lados já compartilham.
@Controller('internal/opt-outs')
export class OptOutsInternalController {
  constructor(
    private readonly optOutsService: OptOutsService,
    private readonly configService: ConfigService,
  ) {}

  @Public()
  @Post()
  @HttpCode(200)
  register(@Body() dto: RegisterOptOutReplyDto, @Req() req: any) {
    this.assertEngineKey(req.headers['authorization']);
    return this.optOutsService.registerReply(dto.instanceId, dto.phone, dto.text);
  }

  private assertEngineKey(header: string | undefined): void {
    const expected = Buffer.from(`Bearer ${this.configService.get<string>('engine.apiKey')}`);
    const received = Buffer.from(header ?? '');
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
      throw new UnauthorizedException('Chave do engine inválida');
    }
  }
}
