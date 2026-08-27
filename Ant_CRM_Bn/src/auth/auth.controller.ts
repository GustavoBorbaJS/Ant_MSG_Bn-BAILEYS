import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
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
import { AuthService } from './auth.service';
import { LoginDto } from './login.dto';
import { Public } from '../common/public.decorator';
import { UsersService } from '../users/users.service';

const MAX_AVATAR_SIZE = 3 * 1024 * 1024; // 3MB

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly usersService: UsersService,
  ) {}

  @Public()
  @Post('login')
  login(@Body() body: LoginDto) {
    return this.authService.login(body.username, body.password);
  }

  @Get('me')
  async me(@Req() req: any) {
    const user = await this.usersService.findOne(req.user.sub);
    return {
      id: user.id,
      name: user.name,
      username: user.username,
      email: user.email,
      role: user.role,
      avatarFilename: user.avatarFilename,
    };
  }

  @Post('me/avatar')
  @UseInterceptors(FileInterceptor('avatar', { limits: { fileSize: MAX_AVATAR_SIZE } }))
  setAvatar(@UploadedFile() file: Express.Multer.File, @Req() req: any) {
    if (!file) {
      throw new BadRequestException('Nenhuma imagem enviada');
    }
    return this.usersService.setAvatar(req.user.sub, file);
  }

  @Delete('me/avatar')
  removeAvatar(@Req() req: any) {
    return this.usersService.removeAvatar(req.user.sub);
  }

  // Sem auth de proposito - foto de perfil nao e sensivel, e <img src> nao
  // manda header Authorization (mesmo padrao de CampaignsController.serveImage).
  // Fica aqui (nao em UsersController) porque aquele e admin-only na classe
  // inteira (@Roles('admin')), e qualquer usuario logado precisa conseguir
  // ver avatar de outros (ex: "disparado por" na tela de Atividade).
  @Public()
  @Get('users/:id/avatar')
  async serveAvatar(@Param('id') id: string, @Res({ passthrough: true }) res: Response) {
    const avatar = await this.usersService.getAvatarPath(id);
    if (!avatar) {
      throw new NotFoundException('Avatar não encontrado');
    }
    res.set({ 'Content-Type': avatar.mimetype, 'Cache-Control': 'private, max-age=86400' });
    return new StreamableFile(createReadStream(avatar.path));
  }
}
