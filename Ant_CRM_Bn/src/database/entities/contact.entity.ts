import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

// phone é unique POR dono (ownerId), não global - dois usuários diferentes
// podem ter o mesmo número cadastrado cada um na sua própria lista.
@Entity('contacts')
@Index(['phone', 'ownerId'], { unique: true })
export class Contact {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column()
  phone: string;

  @Column('text', { array: true, default: () => "'{}'" })
  tags: string[];

  @Column({ nullable: true })
  notes: string;

  @Column()
  ownerId: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
