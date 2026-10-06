import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, Index } from 'typeorm';

// Quem pediu pra não receber mais mensagens ("Não tenho interesse"). Tabela
// separada de contacts de propósito: o bloqueio precisa sobreviver a remover
// o contato e reimportar a mesma planilha depois.
//
// Vale POR dono (ownerId), como os contatos: quem respondeu disse "não" pra
// quem mandou, não pros outros usuários do CRM.
//
// phoneKey não é o telefone cru - ver toPhoneKey em opt-outs/phone-key.ts.
@Entity('opt_outs')
@Index(['ownerId', 'phoneKey'], { unique: true })
export class OptOut {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  ownerId: string;

  @Column()
  phoneKey: string;

  // 'reply' = a pessoa respondeu no WhatsApp; 'manual' = marcado no painel
  @Column({ default: 'reply' })
  source: 'reply' | 'manual';

  // instância que recebeu a resposta e o texto recebido (só em 'reply') -
  // rastro pra entender de onde veio o bloqueio
  @Column({ nullable: true })
  instanceId: string;

  @Column({ nullable: true })
  replyText: string;

  @CreateDateColumn()
  createdAt: Date;
}
