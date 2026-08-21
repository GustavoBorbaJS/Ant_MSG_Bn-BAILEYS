import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Contact } from '../database/entities/contact.entity';
import { CreateContactDto, UpdateContactDto } from './dto';

export interface ImportContactsResult {
  received: number;
  imported: number;
  duplicates: number;
  invalid: number;
}

// Remove tudo que nao for digito e garante o DDI 55 na frente. Numeros de
// celular/fixo no Brasil tem 10 ou 11 digitos SEM DDI (DDD + numero) - com o
// DDI viram 12 ou 13. Usa o tamanho (nao so o prefixo) pra decidir se falta
// o 55, porque "55" tambem e um DDD de verdade (Santa Maria/RS) - um numero
// tipo "55987654321" (11 digitos) e DDD 55 SEM DDI, nao um numero JA com DDI.
function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 13) return null;
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits.startsWith('55') ? digits : `55${digits}`;
}

@Injectable()
export class ContactsService {
  constructor(
    @InjectRepository(Contact)
    private readonly contactRepo: Repository<Contact>,
  ) {}

  async list(ownerId: string, search?: string, tag?: string, page = 1, pageSize = 50) {
    const qb = this.contactRepo.createQueryBuilder('contact').where('contact.ownerId = :ownerId', { ownerId });

    if (search) {
      qb.andWhere('(contact.name ILIKE :search OR contact.phone ILIKE :search)', { search: `%${search}%` });
    }
    if (tag) {
      qb.andWhere(':tag = ANY(contact.tags)', { tag });
    }

    qb.orderBy('contact.createdAt', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize);

    const [items, total] = await qb.getManyAndCount();
    return { items, total, page, pageSize };
  }

  async findOne(id: string, ownerId: string): Promise<Contact> {
    const contact = await this.contactRepo.findOne({ where: { id, ownerId } });
    if (!contact) {
      throw new NotFoundException('Contato não encontrado');
    }
    return contact;
  }

  create(dto: CreateContactDto, ownerId: string): Promise<Contact> {
    return this.contactRepo.save(this.contactRepo.create({ ...dto, tags: dto.tags || [], ownerId }));
  }

  // Importação em lote (ex: .txt com um telefone por linha). Normaliza (DDI
  // 55) e dedupa dentro do próprio arquivo, depois insere ignorando
  // conflitos com contatos que esse mesmo dono já tem (telefone é unique por
  // dono) - não falha o lote inteiro por causa de duplicados, só reporta
  // quantos ficaram de fora.
  async importPhones(rawPhones: string[], ownerId: string): Promise<ImportContactsResult> {
    const received = rawPhones.length;
    let invalid = 0;
    const normalized = new Set<string>();

    for (const raw of rawPhones) {
      const phone = normalizePhone(raw);
      if (!phone) {
        invalid++;
        continue;
      }
      normalized.add(phone);
    }

    const uniquePhones = Array.from(normalized);
    if (uniquePhones.length === 0) {
      return { received, imported: 0, duplicates: 0, invalid };
    }

    const result = await this.contactRepo
      .createQueryBuilder()
      .insert()
      .into(Contact)
      .values(uniquePhones.map((phone) => ({ name: phone, phone, tags: [], ownerId })))
      .orIgnore()
      .returning(['id'])
      .execute();

    const imported = result.identifiers.length;
    const duplicates = uniquePhones.length - imported;

    return { received, imported, duplicates, invalid };
  }

  async update(id: string, dto: UpdateContactDto, ownerId: string): Promise<Contact> {
    const contact = await this.findOne(id, ownerId);
    Object.assign(contact, dto);
    return this.contactRepo.save(contact);
  }

  async remove(id: string, ownerId: string): Promise<void> {
    const result = await this.contactRepo.delete({ id, ownerId });
    if (!result.affected) {
      throw new NotFoundException('Contato não encontrado');
    }
  }
}
