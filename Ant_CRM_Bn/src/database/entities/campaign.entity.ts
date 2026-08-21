import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('campaigns')
export class Campaign {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  // template enviado verbatim - sem interpolacao {{nome}} no v1
  @Column('text')
  text: string;

  @Column({ nullable: true })
  lastDispatchedAt: Date;

  // nome do arquivo em disco (uploads/), nao o path completo - ver
  // CampaignsService.setImage. Texto vira legenda quando tem imagem.
  @Column({ nullable: true })
  imageFilename: string;

  @Column()
  ownerId: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
