import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { UserRole } from '../database/entities/user.entity';
import { ROLES_KEY } from './roles.decorator';

// Roda DEPOIS do JwtAuthGuard (que ja populou request.user a partir do token).
// So entra em acao em rotas marcadas com @Roles(...) - sem a marcacao, deixa passar.
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest();
    if (!requiredRoles.includes(user?.role)) {
      throw new ForbiddenException('Acesso restrito a administradores');
    }
    return true;
  }
}
