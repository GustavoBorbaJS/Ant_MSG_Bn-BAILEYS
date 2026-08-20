import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Contact } from '../database/entities/contact.entity';
import { CreateContactDto, UpdateContactDto } from './dto';

@Injectable()
export class ContactsService {
  constructor(
    @InjectRepository(Contact)
    private readonly contactRepo: Repository<Contact>,
  ) {}

  async list(search?: string, tag?: string, page = 1, pageSize = 50) {
    const qb = this.contactRepo.createQueryBuilder('contact');

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

  async findOne(id: string): Promise<Contact> {
    const contact = await this.contactRepo.findOne({ where: { id } });
    if (!contact) {
      throw new NotFoundException('Contato não encontrado');
    }
    return contact;
  }

  create(dto: CreateContactDto): Promise<Contact> {
    return this.contactRepo.save(this.contactRepo.create({ ...dto, tags: dto.tags || [] }));
  }

  async update(id: string, dto: UpdateContactDto): Promise<Contact> {
    const contact = await this.findOne(id);
    Object.assign(contact, dto);
    return this.contactRepo.save(contact);
  }

  async remove(id: string): Promise<void> {
    const result = await this.contactRepo.delete(id);
    if (!result.affected) {
      throw new NotFoundException('Contato não encontrado');
    }
  }
}
