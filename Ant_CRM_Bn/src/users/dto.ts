import { IsBoolean, IsEmail, IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';
import type { UserRole } from '../database/entities/user.entity';

const USERNAME_PATTERN = /^[a-zA-Z0-9._-]{3,50}$/;

export class CreateUserDto {
  @IsString()
  @Length(1, 200)
  name: string;

  @IsString()
  @Matches(USERNAME_PATTERN, { message: 'username deve ter 3-50 caracteres: letras, números, ., _ ou -' })
  username: string;

  @IsEmail()
  email: string;

  @IsOptional()
  @IsIn(['admin', 'user'])
  role?: UserRole;
}

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @Length(1, 200)
  name?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsIn(['admin', 'user'])
  role?: UserRole;
}

export class SetUserActiveDto {
  @IsBoolean()
  active: boolean;
}
