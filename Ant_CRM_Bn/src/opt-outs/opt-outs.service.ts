import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { OptOut } from '../database/entities/opt-out.entity';
import { InstanceOwnersService } from '../instance-owners/instance-owners.service';
import { toPhoneKey } from './phone-key';

// Lista de "não tenho interesse" de cada usuário. Duas entradas:
//   - registerReply: o engine avisa que alguém respondeu pedindo pra sair
//     (ver Ant_Engine_Bn/src/whatsapp/opt-out.service.ts)
//   - optOut / optIn: o operador marca ou desmarca à mão na tela de contatos
// E uma saída: partition, que o disparo usa pra tirar da lista quem saiu
// (ver CampaignsService.dispatch / retryFailed).
@Injectable()
export class OptOutsService {
  private readonly logger = new Logger(OptOutsService.name);

  constructor(
    @InjectRepository(OptOut) private readonly optOutRepo: Repository<OptOut>,
    private readonly instanceOwners: InstanceOwnersService,
  ) {}

  // O bloqueio vai pro DONO da instância que recebeu a resposta. Devolve
  // registered:false quando a pessoa já estava bloqueada - o engine usa isso
  // pra não mandar a confirmação de novo.
  async registerReply(instanceId: string, phone: string, replyText: string): Promise<{ registered: boolean }> {
    const ownerId = await this.instanceOwners.getEffectiveOwnerId(instanceId);
    if (!ownerId) {
      this.logger.warn(`Opt-out de ${phone} ignorado: instância ${instanceId} sem dono`);
      return { registered: false };
    }

    const registered = await this.insertIfNew({
      ownerId,
      phoneKey: toPhoneKey(phone),
      source: 'reply',
      instanceId,
      replyText: replyText.slice(0, 255),
    });
    if (registered) {
      this.logger.log(`Opt-out registrado: ${phone} não recebe mais mensagens do usuário ${ownerId} (instância ${instanceId})`);
    }
    return { registered };
  }

  async optOut(ownerId: string, phone: string): Promise<void> {
    await this.insertIfNew({ ownerId, phoneKey: toPhoneKey(phone), source: 'manual' });
  }

  async optIn(ownerId: string, phone: string): Promise<void> {
    await this.optOutRepo.delete({ ownerId, phoneKey: toPhoneKey(phone) });
  }

  // ON CONFLICT DO NOTHING no índice único (ownerId, phoneKey): duas respostas
  // seguidas da mesma pessoa não viram erro nem linha duplicada.
  private async insertIfNew(row: Partial<OptOut>): Promise<boolean> {
    const result = await this.optOutRepo
      .createQueryBuilder()
      .insert()
      .into(OptOut)
      .values(row)
      .orIgnore()
      .returning(['id'])
      .execute();
    return result.identifiers.length > 0;
  }

  // Separa uma lista qualquer (contatos, message_logs...) entre quem pode
  // receber e quem pediu pra sair, mantendo a ordem original.
  async partition<T>(ownerId: string, items: T[], phoneOf: (item: T) => string): Promise<{ allowed: T[]; optedOut: T[] }> {
    if (items.length === 0) return { allowed: [], optedOut: [] };

    const keys = items.map((item) => toPhoneKey(phoneOf(item)));
    const rows = await this.optOutRepo.find({
      where: { ownerId, phoneKey: In(Array.from(new Set(keys))) },
      select: ['phoneKey'],
    });
    const blocked = new Set(rows.map((row) => row.phoneKey));

    const allowed: T[] = [];
    const optedOut: T[] = [];
    items.forEach((item, index) => (blocked.has(keys[index]) ? optedOut : allowed).push(item));
    return { allowed, optedOut };
  }
}
