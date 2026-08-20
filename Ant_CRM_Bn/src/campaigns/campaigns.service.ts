import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Campaign } from '../database/entities/campaign.entity';
import { Contact } from '../database/entities/contact.entity';
import { MessageLog } from '../database/entities/message-log.entity';
import { QueueProducerService } from '../queue/queue-producer.service';
import { CreateCampaignDto, DispatchCampaignDto, DispatchMode, UpdateCampaignDto } from './dto';

type Progress = { pending: number; sent: number; failed: number };

@Injectable()
export class CampaignsService {
  private readonly logger = new Logger(CampaignsService.name);

  constructor(
    @InjectRepository(Campaign) private readonly campaignRepo: Repository<Campaign>,
    @InjectRepository(Contact) private readonly contactRepo: Repository<Contact>,
    @InjectRepository(MessageLog) private readonly messageLogRepo: Repository<MessageLog>,
    private readonly queueProducer: QueueProducerService,
  ) {}

  async list() {
    const campaigns = await this.campaignRepo.find({ order: { createdAt: 'DESC' } });

    const counts = await this.messageLogRepo
      .createQueryBuilder('m')
      .select('m.campaignId', 'campaignId')
      .addSelect('m.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .where('m.campaignId IS NOT NULL')
      .groupBy('m.campaignId')
      .addGroupBy('m.status')
      .getRawMany();

    return campaigns.map((campaign) => {
      const progress: Progress = { pending: 0, sent: 0, failed: 0 };
      for (const row of counts) {
        if (row.campaignId === campaign.id) {
          progress[row.status as keyof Progress] = Number(row.count);
        }
      }
      return { ...campaign, progress };
    });
  }

  async findOne(id: string): Promise<Campaign> {
    const campaign = await this.campaignRepo.findOne({ where: { id } });
    if (!campaign) {
      throw new NotFoundException('Campanha não encontrada');
    }
    return campaign;
  }

  create(dto: CreateCampaignDto): Promise<Campaign> {
    return this.campaignRepo.save(this.campaignRepo.create(dto));
  }

  async update(id: string, dto: UpdateCampaignDto): Promise<Campaign> {
    const campaign = await this.findOne(id);
    Object.assign(campaign, dto);
    return this.campaignRepo.save(campaign);
  }

  async remove(id: string): Promise<void> {
    const result = await this.campaignRepo.delete(id);
    if (!result.affected) {
      throw new NotFoundException('Campanha não encontrada');
    }
  }

  async progress(id: string): Promise<Progress> {
    await this.findOne(id);

    const rows = await this.messageLogRepo
      .createQueryBuilder('m')
      .select('m.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .where('m.campaignId = :id', { id })
      .groupBy('m.status')
      .getRawMany();

    const progress: Progress = { pending: 0, sent: 0, failed: 0 };
    for (const row of rows) {
      progress[row.status as keyof Progress] = Number(row.count);
    }
    return progress;
  }

  // Mesmo caminho que Ant_MSG_Bn/scripts/enqueue-batch.js ja fazia manualmente:
  // insere message_logs 'pending' + enfileira na fila 'messages'. O worker
  // (MessageConsumer) processa esses jobs identico a qualquer outro - nao muda
  // nada la.
  //
  // mode 'direct': usuario decidiu pular o rate limit do anti-ban (avisado e
  // confirmado no front - acknowledgeRisk obrigatorio) pra rodar um teste
  // manual, opcionalmente em lotes (ex: 200/100/200) espacados por
  // batchIntervalMinutes. Cada job carrega skipRateLimit:true, que o worker
  // (Ant_MSG_Bn/src/queue/queue.consumer.ts) usa pra pular o checkRateLimit -
  // ou seja, esse modo REALMENTE ignora os limites de warmup/instancia/globais.
  async dispatch(id: string, dto: DispatchCampaignDto, requesterId: string) {
    const campaign = await this.findOne(id);

    const contacts = await this.contactRepo.find({ where: { id: In(dto.contactIds) } });
    if (contacts.length !== dto.contactIds.length) {
      throw new BadRequestException('Um ou mais contatos não foram encontrados');
    }

    const mode: DispatchMode = dto.mode === 'direct' ? 'direct' : 'auto';
    let batchSizes: number[] = [contacts.length];
    let intervalMs = 0;

    if (mode === 'direct') {
      if (!dto.acknowledgeRisk) {
        throw new BadRequestException(
          'Para usar o modo direto é preciso confirmar que está ciente do risco de bloqueio do chip.',
        );
      }

      batchSizes = dto.batchSizes?.length ? dto.batchSizes : [contacts.length];
      const totalBatched = batchSizes.reduce((sum, n) => sum + n, 0);
      if (totalBatched !== contacts.length) {
        throw new BadRequestException(
          `A soma dos lotes (${totalBatched}) precisa ser igual ao número de contatos selecionados (${contacts.length}).`,
        );
      }

      if (batchSizes.length > 1) {
        if (!dto.batchIntervalMinutes) {
          throw new BadRequestException('Informe o intervalo em minutos entre os lotes.');
        }
        intervalMs = dto.batchIntervalMinutes * 60_000;
      }
    }

    // Preserva a ordem em que o usuario selecionou os contatos - e essa ordem
    // que define quem cai em cada lote (ex: os 200 primeiros selecionados vao
    // no 1o lote).
    const contactsById = new Map(contacts.map((c) => [c.id, c]));
    const orderedContacts = dto.contactIds.map((cid) => contactsById.get(cid)!);

    const messageLogIds: string[] = [];
    let cursor = 0;
    for (let batchIndex = 0; batchIndex < batchSizes.length; batchIndex++) {
      const batchContacts = orderedContacts.slice(cursor, cursor + batchSizes[batchIndex]);
      cursor += batchSizes[batchIndex];
      const delay = batchIndex * intervalMs;

      for (const contact of batchContacts) {
        const messageLog = await this.messageLogRepo.save(
          this.messageLogRepo.create({
            instanceId: dto.instanceId,
            to: contact.phone,
            text: campaign.text,
            status: 'pending',
            campaignId: campaign.id,
            contactId: contact.id,
            dispatchMode: mode,
            dispatchedBy: requesterId,
          }),
        );

        await this.queueProducer.enqueue(
          {
            messageLogId: messageLog.id,
            instanceId: dto.instanceId,
            to: contact.phone,
            text: campaign.text,
            skipRateLimit: mode === 'direct',
          },
          { delay },
        );

        messageLogIds.push(messageLog.id);
      }
    }

    if (mode === 'direct') {
      this.logger.warn(
        `Disparo em modo DIRETO (anti-ban ignorado por confirmação explícita): campanha=${campaign.id} ` +
          `usuario=${requesterId} instancia=${dto.instanceId} contatos=${orderedContacts.length} ` +
          `lotes=${JSON.stringify(batchSizes)} intervaloMin=${dto.batchIntervalMinutes ?? 0}`,
      );
    }

    campaign.lastDispatchedAt = new Date();
    await this.campaignRepo.save(campaign);

    return { dispatched: messageLogIds.length, messageLogIds, mode, batchSizes };
  }
}
