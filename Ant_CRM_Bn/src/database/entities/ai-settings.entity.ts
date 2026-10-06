import { Entity, Column, PrimaryColumn, UpdateDateColumn } from 'typeorm';

// Configuração de IA de cada usuário (menu "IA" do painel): qual provedor,
// qual modelo e a chave de API dele. Tabela separada de users de propósito -
// os endpoints de usuário devolvem a linha de users quase inteira, e a chave
// (mesmo cifrada) não pode pegar carona nessas respostas.
@Entity('ai_settings')
export class AiSettings {
  @PrimaryColumn('uuid')
  userId: string;

  @Column()
  provider: string;

  @Column()
  model: string;

  // AES-256-GCM (ver ai/secret-box.ts) - nunca a chave em texto puro
  @Column('text')
  apiKeyEnc: string;

  @UpdateDateColumn()
  updatedAt: Date;
}
