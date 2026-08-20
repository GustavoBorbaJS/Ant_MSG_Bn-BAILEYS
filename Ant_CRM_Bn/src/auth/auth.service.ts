import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { UsersService } from '../users/users.service';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private configService: ConfigService,
    private jwtService: JwtService,
    private usersService: UsersService,
  ) {
    const { jwtSecret } = this.configService.get('auth');
    if (!jwtSecret) {
      throw new Error('CRM_JWT_SECRET precisa estar definido.');
    }
  }

  async login(username: string, password: string): Promise<{ accessToken: string }> {
    const user = await this.usersService.findByUsername(username);
    const validPassword = user ? await bcrypt.compare(password, user.passwordHash) : false;

    if (!user || !validPassword) {
      this.logger.warn(`Login inválido para usuário "${username}"`);
      throw new UnauthorizedException('Usuário ou senha inválidos');
    }

    if (!user.active) {
      this.logger.warn(`Login bloqueado para usuário "${username}" (conta inativa)`);
      throw new UnauthorizedException('Usuário bloqueado. Fale com um administrador.');
    }

    const accessToken = this.jwtService.sign({ sub: user.id, username: user.username, role: user.role });
    return { accessToken };
  }
}
