import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Campaign } from './campaign.entity';
import { Contact } from './contact.entity';
import { User } from './user.entity';

// Mesma tabela que Ant_MSG_Bn/src/database/entities/message-log.entity.ts mapeia.
// O worker so toca id/status/sentAt/failedAt/errorMessage/updatedAt - campaignId e
// contactId sao donos exclusivos do CRM (ver database.module.ts sobre quem
// sincroniza o schema).
@Entity('message_logs')
export class MessageLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  instanceId: string;

  @Column()
  to: string;

  @Column('text')
  text: string;

  @Column({ default: 'pending' })
  status: 'pending' | 'sent' | 'failed';

  @Column({ nullable: true })
  sentAt: Date;

  @Column({ nullable: true })
  failedAt: Date;

  @Column({ nullable: true })
  errorMessage: string;

  @Column({ nullable: true })
  campaignId: string;

  @ManyToOne(() => Campaign, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'campaignId' })
  campaign: Campaign;

  @Column({ nullable: true })
  contactId: string;

  @ManyToOne(() => Contact, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'contactId' })
  contact: Contact;

  // 'direct' = disparo manual que pulou o rate limit do anti-ban (ver
  // CampaignsService.dispatch) - guardado por mensagem pra dar rastreabilidade
  // de quem decidiu ignorar a proteção e quando. 'test' = disparo de teste
  // (reconecta + envia na hora, fora da fila - ver TestDispatchService),
  // exclusivo de admin/usuários autorizados.
  @Column({ default: 'auto' })
  dispatchMode: 'auto' | 'direct' | 'test';

  @Column({ nullable: true })
  dispatchedBy: string;

  // sem FK no banco (evita mais uma migration) - so pra dar join na aba de
  // atividade admin (message-logs/activity) e mostrar quem disparou
  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'dispatchedBy' })
  dispatcher: User;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
