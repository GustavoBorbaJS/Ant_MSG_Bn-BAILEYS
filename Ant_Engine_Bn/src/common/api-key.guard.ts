import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

// Protege toda a API do engine com um segredo compartilhado com o worker.
// Sem isso, qualquer um que alcance a porta do engine consegue mandar mensagem,
// ler status ou forcar reconexao pelos numeros de WhatsApp da aplicacao.
@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly expectedKey: string;

  constructor(private configService: ConfigService) {
    this.expectedKey = this.configService.get<string>('engineApiKey');
    if (!this.expectedKey) {
      throw new Error('ENGINE_API_KEY não definida. Configure um segredo antes de subir o engine.');
    }
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const header = request.headers['authorization'] as string | undefined;
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;

    if (!token || !this.timingSafeEqual(token, this.expectedKey)) {
      throw new UnauthorizedException('Credenciais inválidas');
    }

    return true;
  }

  private timingSafeEqual(a: string, b: string): boolean {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) {
      return false;
    }
    return crypto.timingSafeEqual(bufA, bufB);
  }
}
