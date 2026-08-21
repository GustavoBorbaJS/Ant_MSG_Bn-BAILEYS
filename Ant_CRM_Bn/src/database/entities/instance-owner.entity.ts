import { Entity, Column, PrimaryColumn, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { User } from './user.entity';

// instanceId vem do Engine (Baileys), que não tem noção de usuário - essa
// tabela é o único lugar que mapeia "de quem é" cada instância WhatsApp.
// Sem registro aqui = instância "legada" (de antes desse recurso existir),
// tratada como do admin (ver InstanceOwnersService.resolveOwnerOnConnect).
@Entity('instance_owners')
export class InstanceOwner {
  @PrimaryColumn()
  instanceId: string;

  @Column()
  ownerId: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'ownerId' })
  owner: User;

  @CreateDateColumn()
  createdAt: Date;
}
