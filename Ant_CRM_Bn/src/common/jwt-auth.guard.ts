import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from './public.decorator';
import { UsersService } from '../users/users.service';

// Protege toda a API do CRM por padrao - so rotas marcadas com @Public() (ex: login)
// ficam de fora. Mesma filosofia do ApiKeyGuard do engine (fail closed por padrao).
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private jwtService: JwtService,
    private reflector: Reflector,
    private usersService: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const header = request.headers['authorization'] as string | undefined;
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;

    if (!token) {
      throw new UnauthorizedException('Token ausente');
    }

    try {
      request.user = this.jwtService.verify(token);
    } catch {
      throw new UnauthorizedException('Token inválido ou expirado');
    }

    // Consulta o banco a cada request (nao so no login) para que bloquear um
    // usuario derrube na hora tokens ja emitidos - sem isso o usuario bloqueado
    // continuaria disparando mensagens ate o token expirar.
    const user = await this.usersService.findOne(request.user.sub).catch(() => null);
    if (!user || !user.active) {
      throw new UnauthorizedException('Usuário bloqueado ou inexistente');
    }

    // Aproveita essa consulta (ja feita pra checar "active") pra tambem
    // colocar canDispatchTest fresco no request.user - assim revogar a
    // permissao de disparo de teste vale na hora, sem precisar esperar o
    // token expirar/re-logar (mesmo raciocinio do "active" acima).
    request.user.canDispatchTest = user.canDispatchTest;

    return true;
  }
}
