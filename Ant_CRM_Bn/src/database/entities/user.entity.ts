import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

export type UserRole = 'admin' | 'user';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Index({ unique: true })
  @Column()
  username: string;

  @Index({ unique: true })
  @Column()
  email: string;

  // bcrypt hash - nunca a senha em texto puro
  @Column()
  passwordHash: string;

  @Column({ default: 'user' })
  role: UserRole;

  // false = usuário bloqueado: não consegue logar e tokens já emitidos
  // param de ser aceitos (ver JwtAuthGuard) - inativa disparos e qualquer
  // outra ação dele no CRM sem precisar mexer em cada módulo.
  @Column({ default: true })
  active: boolean;

  // nome do arquivo em disco (uploads/avatars/), nao o path completo - ver
  // UsersService.setAvatar. Servido publicamente via GET /auth/users/:id/avatar
  // (mesmo padrao de Campaign.imageFilename - foto de perfil nao e sensivel).
  @Column({ nullable: true })
  avatarFilename: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
