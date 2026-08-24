import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { User } from '../database/entities/user.entity';
import { CreateUserDto, UpdateUserDto } from './dto';

function generatePassword(): string {
  // 12 caracteres legiveis, alfanumericos - facil de digitar/compartilhar
  return crypto.randomBytes(9).toString('base64url');
}

const ALLOWED_AVATAR_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

@Injectable()
export class UsersService implements OnModuleInit {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private configService: ConfigService,
  ) {}

  // Bootstrap: se ainda nao existe nenhum usuario no banco, cria o admin inicial
  // a partir do que ja estava configurado via env (CRM_ADMIN_USERNAME/HASH) -
  // preserva o login que ja existia antes de mover pra usuarios de verdade no banco.
  //
  // Roda antes das migrations em alguns cenarios de deploy (container sobe
  // antes de alguem rodar "migration:run:prod" manualmente) - sem o catch
  // abaixo, "relation users does not exist" derrubava a API inteira num loop
  // de crash, impedindo ate de abrir um terminal no container pra rodar as
  // migrations. Melhor logar e deixar a API de pe (com login quebrado) do que
  // crashar - depois de rodar as migrations, um restart do container completa
  // o bootstrap normalmente.
  async onModuleInit() {
    let count: number;
    try {
      count = await this.userRepo.count();
    } catch (err) {
      this.logger.error(
        `Não foi possível consultar a tabela "users" (rode as migrations: npm run migration:run:prod) - login vai falhar até lá: ${err.message}`,
      );
      return;
    }
    if (count > 0) return;

    const { adminUsername, adminPasswordHash } = this.configService.get('auth');
    if (!adminUsername || !adminPasswordHash) {
      this.logger.warn('Nenhum usuário no banco e CRM_ADMIN_USERNAME/HASH não configurados - login vai falhar.');
      return;
    }

    await this.userRepo.save(
      this.userRepo.create({
        name: 'Administrador',
        username: adminUsername,
        email: this.configService.get('auth.adminEmail') || `${adminUsername}@local`,
        passwordHash: adminPasswordHash,
        role: 'admin',
      }),
    );
    this.logger.log(`Usuário admin inicial "${adminUsername}" criado a partir do .env`);
  }

  async list(): Promise<Omit<User, 'passwordHash'>[]> {
    const users = await this.userRepo.find({ order: { createdAt: 'DESC' } });
    return users.map(({ passwordHash: _passwordHash, ...rest }) => rest);
  }

  findByUsername(username: string): Promise<User | null> {
    return this.userRepo.findOne({ where: { username } });
  }

  async findOne(id: string): Promise<User> {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException('Usuário não encontrado');
    }
    return user;
  }

  async create(dto: CreateUserDto): Promise<{ user: Omit<User, 'passwordHash'>; password: string }> {
    const existing = await this.userRepo.findOne({ where: [{ username: dto.username }, { email: dto.email }] });
    if (existing) {
      throw new ConflictException('Já existe um usuário com esse username ou email');
    }

    const password = generatePassword();
    const passwordHash = await bcrypt.hash(password, 10);

    const saved = await this.userRepo.save(
      this.userRepo.create({
        name: dto.name,
        username: dto.username,
        email: dto.email,
        role: dto.role || 'user',
        passwordHash,
      }),
    );

    const { passwordHash: _passwordHash, ...user } = saved;
    return { user, password };
  }

  async update(id: string, dto: UpdateUserDto): Promise<Omit<User, 'passwordHash'>> {
    const user = await this.findOne(id);
    Object.assign(user, dto);
    const saved = await this.userRepo.save(user);
    const { passwordHash: _passwordHash, ...rest } = saved;
    return rest;
  }

  async resetPassword(id: string): Promise<string> {
    const user = await this.findOne(id);
    const password = generatePassword();
    user.passwordHash = await bcrypt.hash(password, 10);
    await this.userRepo.save(user);
    return password;
  }

  async setActive(id: string, active: boolean, requesterId: string): Promise<Omit<User, 'passwordHash'>> {
    if (id === requesterId && !active) {
      throw new BadRequestException('Você não pode bloquear a própria conta');
    }

    const user = await this.findOne(id);
    if (!active && user.role === 'admin') {
      const activeAdminCount = await this.userRepo.count({ where: { role: 'admin', active: true } });
      if (activeAdminCount <= 1) {
        throw new BadRequestException('Não é possível bloquear o último administrador ativo');
      }
    }

    user.active = active;
    const saved = await this.userRepo.save(user);
    const { passwordHash: _passwordHash, ...rest } = saved;
    return rest;
  }

  private avatarsDir(): string {
    return path.join(this.configService.get<string>('uploadsDir'), 'avatars');
  }

  async setAvatar(id: string, file: Express.Multer.File): Promise<Omit<User, 'passwordHash'>> {
    const user = await this.findOne(id);

    const ext = ALLOWED_AVATAR_EXT[file.mimetype];
    if (!ext) {
      throw new BadRequestException('Formato não suportado (use JPEG, PNG ou WEBP).');
    }

    const oldFilename = user.avatarFilename;
    const filename = `${user.id}-${crypto.randomBytes(6).toString('hex')}${ext}`;

    await fs.mkdir(this.avatarsDir(), { recursive: true });
    await fs.writeFile(path.join(this.avatarsDir(), filename), file.buffer);

    user.avatarFilename = filename;
    const saved = await this.userRepo.save(user);

    if (oldFilename) {
      await this.deleteAvatarFile(oldFilename);
    }

    const { passwordHash: _passwordHash, ...rest } = saved;
    return rest;
  }

  async removeAvatar(id: string): Promise<Omit<User, 'passwordHash'>> {
    const user = await this.findOne(id);
    if (user.avatarFilename) {
      await this.deleteAvatarFile(user.avatarFilename);
      user.avatarFilename = null;
      await this.userRepo.save(user);
    }
    const { passwordHash: _passwordHash, ...rest } = user;
    return rest;
  }

  // Sem checagem de dono de proposito - chamado pelo endpoint publico
  // (GET /auth/users/:id/avatar, ver AuthController) que serve a foto de
  // qualquer usuario pra exibir em telas de outros usuarios (ex: lista de
  // Usuarios do admin, "disparado por" na Atividade).
  async getAvatarPath(id: string): Promise<{ path: string; mimetype: string } | null> {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user?.avatarFilename) return null;

    const ext = path.extname(user.avatarFilename);
    const mimetype = Object.entries(ALLOWED_AVATAR_EXT).find(([, e]) => e === ext)?.[0] || 'application/octet-stream';

    return { path: path.join(this.avatarsDir(), user.avatarFilename), mimetype };
  }

  private async deleteAvatarFile(filename: string): Promise<void> {
    try {
      await fs.unlink(path.join(this.avatarsDir(), filename));
    } catch (err) {
      if (err.code !== 'ENOENT') {
        this.logger.warn(`Não foi possível remover avatar antigo "${filename}": ${err.message}`);
      }
    }
  }

  async remove(id: string, requesterId: string): Promise<void> {
    if (id === requesterId) {
      throw new BadRequestException('Você não pode remover a própria conta');
    }

    const user = await this.findOne(id);
    if (user.role === 'admin') {
      const adminCount = await this.userRepo.count({ where: { role: 'admin' } });
      if (adminCount <= 1) {
        throw new BadRequestException('Não é possível remover o último administrador');
      }
    }

    await this.userRepo.delete(id);
  }
}
