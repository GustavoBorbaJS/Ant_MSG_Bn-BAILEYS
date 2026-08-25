import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, MoreThanOrEqual, Repository } from 'typeorm';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { Campaign } from '../database/entities/campaign.entity';
import { Contact } from '../database/entities/contact.entity';
import { MessageLog } from '../database/entities/message-log.entity';
import { QueueProducerService } from '../queue/queue-producer.service';
import { InstanceOwnersService, RequesterInfo } from '../instance-owners/instance-owners.service';
import { SettingsService } from '../settings/settings.service';
import { CreateCampaignDto, DispatchCampaignDto, DispatchMode, RetryFailedDto, UpdateCampaignDto } from './dto';

type Progress = { pending: number; sent: number; failed: number };

const ALLOWED_ATTACHMENT_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'application/pdf': '.pdf',
};

@Injectable()
export class CampaignsService {
  private readonly logger = new Logger(CampaignsService.name);

  constructor(
    @InjectRepository(Campaign) private readonly campaignRepo: Repository<Campaign>,
    @InjectRepository(Contact) private readonly contactRepo: Repository<Contact>,
    @InjectRepository(MessageLog) private readonly messageLogRepo: Repository<MessageLog>,
    private readonly queueProducer: QueueProducerService,
    private readonly instanceOwners: InstanceOwnersService,
    private readonly configService: ConfigService,
    private readonly settingsService: SettingsService,
  ) {}

  private uploadsDir(): string {
    return this.configService.get<string>('uploadsDir');
  }

  async list(ownerId: string) {
    const campaigns = await this.campaignRepo.find({ where: { ownerId }, order: { createdAt: 'DESC' } });

    const counts = await this.messageLogRepo
      .createQueryBuilder('m')
      .select('m.campaignId', 'campaignId')
      .addSelect('m.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .where('m.campaignId IN (:...ids)', { ids: campaigns.length ? campaigns.map((c) => c.id) : [null] })
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

  async findOne(id: string, ownerId: string): Promise<Campaign> {
    const campaign = await this.campaignRepo.findOne({ where: { id, ownerId } });
    if (!campaign) {
      throw new NotFoundException('Campanha não encontrada');
    }
    return campaign;
  }

  create(dto: CreateCampaignDto, ownerId: string): Promise<Campaign> {
    return this.campaignRepo.save(this.campaignRepo.create({ ...dto, ownerId }));
  }

  async update(id: string, dto: UpdateCampaignDto, ownerId: string): Promise<Campaign> {
    const campaign = await this.findOne(id, ownerId);
    Object.assign(campaign, dto);
    return this.campaignRepo.save(campaign);
  }

  async remove(id: string, ownerId: string): Promise<void> {
    const campaign = await this.findOne(id, ownerId);
    await this.campaignRepo.delete({ id, ownerId });
    if (campaign.imageFilename) {
      await this.deleteImageFile(campaign.imageFilename);
    }
  }

  // Chamado quando um usuário é removido de vez (ver UsersService.remove) -
  // campaigns.ownerId tem FK ON DELETE RESTRICT pra users, então precisa
  // sumir com as campanhas (e as imagens em disco) ANTES de apagar o dono.
  async removeAllOwnedBy(ownerId: string): Promise<void> {
    const campaigns = await this.campaignRepo.find({ where: { ownerId } });
    await this.campaignRepo.delete({ ownerId });
    for (const campaign of campaigns) {
      if (campaign.imageFilename) {
        await this.deleteImageFile(campaign.imageFilename);
      }
    }
  }

  async setImage(id: string, ownerId: string, file: Express.Multer.File): Promise<Campaign> {
    const campaign = await this.findOne(id, ownerId);

    const ext = ALLOWED_ATTACHMENT_EXT[file.mimetype];
    if (!ext) {
      throw new BadRequestException('Formato não suportado (use JPEG, PNG, WEBP, GIF ou PDF).');
    }

    const oldFilename = campaign.imageFilename;
    const filename = `${campaign.id}-${crypto.randomBytes(6).toString('hex')}${ext}`;

    await fs.mkdir(this.uploadsDir(), { recursive: true });
    await fs.writeFile(path.join(this.uploadsDir(), filename), file.buffer);

    campaign.imageFilename = filename;
    const saved = await this.campaignRepo.save(campaign);

    if (oldFilename) {
      await this.deleteImageFile(oldFilename);
    }

    return saved;
  }

  async removeImage(id: string, ownerId: string): Promise<Campaign> {
    const campaign = await this.findOne(id, ownerId);
    if (campaign.imageFilename) {
      await this.deleteImageFile(campaign.imageFilename);
      campaign.imageFilename = null;
      await this.campaignRepo.save(campaign);
    }
    return campaign;
  }

  // Sem checagem de dono de propósito - essa URL é chamada pelo Engine (rede
  // interna do docker, sem token de usuário) na hora de repassar a imagem pro
  // WhatsApp. O nome do arquivo (uuid + hex aleatório) já não é adivinhável.
  async getImagePath(id: string): Promise<{ path: string; mimetype: string } | null> {
    const campaign = await this.campaignRepo.findOne({ where: { id } });
    if (!campaign?.imageFilename) return null;

    const ext = path.extname(campaign.imageFilename);
    const mimetype = Object.entries(ALLOWED_ATTACHMENT_EXT).find(([, e]) => e === ext)?.[0] || 'application/octet-stream';

    return { path: path.join(this.uploadsDir(), campaign.imageFilename), mimetype };
  }

  private async deleteImageFile(filename: string): Promise<void> {
    try {
      await fs.unlink(path.join(this.uploadsDir(), filename));
    } catch (err) {
      if (err.code !== 'ENOENT') {
        this.logger.warn(`Não foi possível remover imagem antiga "${filename}": ${err.message}`);
      }
    }
  }

  async progress(id: string, ownerId: string): Promise<Progress> {
    await this.findOne(id, ownerId);

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

  // Teto diario de mensagens por usuario (role 'user' - admin nao tem teto),
  // configuravel em Configurações. Conta qualquer message_log já disparado
  // hoje (pending/sent/failed - a tentativa em si já consumiu a cota),
  // independente de campanha ou modo.
  private async assertUserDailyLimit(userId: string, additionalCount: number): Promise<void> {
    const { userDailyMessageLimit } = await this.settingsService.getConfig();

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const sentToday = await this.messageLogRepo.count({
      where: { dispatchedBy: userId, createdAt: MoreThanOrEqual(startOfDay) },
    });

    const remaining = Math.max(0, userDailyMessageLimit - sentToday);
    if (additionalCount > remaining) {
      throw new BadRequestException(`Você só tem ${remaining} mensagens restantes no dia.`);
    }
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
  async dispatch(id: string, dto: DispatchCampaignDto, requester: RequesterInfo) {
    const campaign = await this.findOne(id, requester.id);

    await this.instanceOwners.assertAccess(dto.instanceId, requester);

    // ownerId aqui garante que ninguem dispare pra um contato de outro
    // usuario so adivinhando o id dele
    const contacts = await this.contactRepo.find({ where: { id: In(dto.contactIds), ownerId: requester.id } });
    if (contacts.length !== dto.contactIds.length) {
      throw new BadRequestException('Um ou mais contatos não foram encontrados');
    }

    // Repetir o mesmo disparo N vezes (ex: mandar 500x pro proprio numero pra
    // testar a instancia/fila) e exclusivo de admin - a tela nem mostra a
    // opção pra usuario comum, e o backend recusa mesmo que tentem forçar via
    // chamada direta na API.
    const repeatCount = dto.repeatCount ?? 1;
    if (repeatCount > 1 && requester.role !== 'admin') {
      throw new BadRequestException('Repetir o mesmo disparo várias vezes é uma opção exclusiva para administradores.');
    }

    // Preserva a ordem em que o usuario selecionou os contatos - e essa ordem
    // que define quem cai em cada lote (ex: os 200 primeiros selecionados vao
    // no 1o lote). repeatCount > 1 repete a lista inteira ANTES da divisão em
    // lotes, entao tudo abaixo (validação de lote, limite diário) já opera
    // sobre o total final de mensagens, repetição incluída.
    const contactsById = new Map(contacts.map((c) => [c.id, c]));
    const baseOrderedContacts = dto.contactIds.map((cid) => contactsById.get(cid)!);
    const orderedContacts =
      repeatCount > 1 ? Array.from({ length: repeatCount }, () => baseOrderedContacts).flat() : baseOrderedContacts;

    // controle administrativo por usuario (nao e do anti-ban) - vale pros dois
    // modos, inclusive direto, que so ignora o rate limit tecnico do worker
    if (requester.role !== 'admin') {
      await this.assertUserDailyLimit(requester.id, orderedContacts.length);
    }

    const mode: DispatchMode = dto.mode === 'direct' ? 'direct' : 'auto';
    let batchSizes: number[] = [orderedContacts.length];
    let intervalMs = 0;

    if (mode === 'direct') {
      if (!dto.acknowledgeRisk) {
        throw new BadRequestException(
          'Para usar o modo direto é preciso confirmar que está ciente do risco de bloqueio do chip.',
        );
      }

      batchSizes = dto.batchSizes?.length ? dto.batchSizes : [orderedContacts.length];
      const totalBatched = batchSizes.reduce((sum, n) => sum + n, 0);
      if (totalBatched !== orderedContacts.length) {
        const repeatNote = repeatCount > 1 ? ` (já com a repetição x${repeatCount} aplicada)` : '';
        throw new BadRequestException(
          `A soma dos lotes (${totalBatched}) precisa ser igual ao total de mensagens (${orderedContacts.length}${repeatNote}).`,
        );
      }

      if (batchSizes.length > 1) {
        if (!dto.batchIntervalMinutes) {
          throw new BadRequestException('Informe o intervalo em minutos entre os lotes.');
        }
        intervalMs = dto.batchIntervalMinutes * 60_000;
      }
    }

    // Agendamento: as message_logs sao criadas AGORA (aparecem como
    // "pendente" no histórico), só o job na fila fica com delay até o
    // horário escolhido - o worker (Ant_MSG_Bn/src/queue/queue.consumer.ts)
    // não sabe nem precisa saber que foi agendado, processa igual a qualquer
    // outro job quando o delay vence. Se vier no passado (ex: relógio do
    // navegador adiantado), trata como imediato em vez de rejeitar.
    const scheduledAt = dto.scheduledAt ? new Date(dto.scheduledAt) : null;
    const scheduleDelayMs = scheduledAt ? Math.max(0, scheduledAt.getTime() - Date.now()) : 0;

    // ver comentario em configuration.ts sobre a limitação com Meta Cloud API
    const imageUrl = campaign.imageFilename
      ? `${this.configService.get<string>('internalUrl')}/campaigns/${campaign.id}/image`
      : undefined;

    // PDF vai como "document" no WhatsApp (nao "image") - o nome do arquivo
    // extraido do proprio imageFilename ja diz qual e (ver ALLOWED_ATTACHMENT_EXT).
    // Presença de documentFileName é o sinal que a engine usa pra decidir o
    // tipo de mensagem (ver Ant_Engine_Bn/src/whatsapp/whatsapp.service.ts).
    const isPdf = campaign.imageFilename?.toLowerCase().endsWith('.pdf');
    const documentFileName = isPdf
      ? `${campaign.name.replace(/[\\/:*?"<>|]+/g, '').trim() || 'documento'}.pdf`
      : undefined;

    const messageLogIds: string[] = [];
    let cursor = 0;
    for (let batchIndex = 0; batchIndex < batchSizes.length; batchIndex++) {
      const batchContacts = orderedContacts.slice(cursor, cursor + batchSizes[batchIndex]);
      cursor += batchSizes[batchIndex];
      const delay = scheduleDelayMs + batchIndex * intervalMs;

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
            dispatchedBy: requester.id,
          }),
        );

        await this.queueProducer.enqueue(
          {
            messageLogId: messageLog.id,
            instanceId: dto.instanceId,
            to: contact.phone,
            text: campaign.text,
            skipRateLimit: mode === 'direct',
            imageUrl,
            documentFileName,
          },
          { delay },
        );

        messageLogIds.push(messageLog.id);
      }
    }

    if (mode === 'direct') {
      this.logger.warn(
        `Disparo em modo DIRETO (anti-ban ignorado por confirmação explícita): campanha=${campaign.id} ` +
          `usuario=${requester.id} instancia=${dto.instanceId} contatos=${orderedContacts.length} ` +
          `lotes=${JSON.stringify(batchSizes)} intervaloMin=${dto.batchIntervalMinutes ?? 0}`,
      );
    }

    if (repeatCount > 1) {
      this.logger.warn(
        `Disparo REPETIDO ${repeatCount}x (exclusivo admin): campanha=${campaign.id} usuario=${requester.id} ` +
          `instancia=${dto.instanceId} contatos_selecionados=${contacts.length} total_mensagens=${orderedContacts.length}`,
      );
    }

    if (scheduledAt) {
      this.logger.log(
        `Disparo AGENDADO pra ${scheduledAt.toISOString()}: campanha=${campaign.id} usuario=${requester.id} ` +
          `instancia=${dto.instanceId} total_mensagens=${orderedContacts.length}`,
      );
    }

    campaign.lastDispatchedAt = new Date();
    await this.campaignRepo.save(campaign);

    return {
      dispatched: messageLogIds.length,
      messageLogIds,
      mode,
      batchSizes,
      repeatCount,
      scheduledAt: scheduledAt?.toISOString() ?? null,
    };
  }

  // Reenvia mensagens que falharam nessa campanha SEM precisar re-selecionar
  // contatos - reaproveita to/text/contactId de cada message_log 'failed' e
  // cria uma nova tentativa 'pending' pra cada uma. instanceId pode ser
  // diferente do original de proposito: o caso comum e a instancia original
  // ter caido/nunca conectado (ver ensureInstanceReady em
  // Ant_MSG_Bn/src/queue/queue.consumer.ts, que desiste apos ~20min e marca
  // 'failed') e o usuario reenviar usando outra instancia ja reconectada.
  // O log antigo NAO e apagado nem alterado - fica como registro historico
  // da tentativa que falhou; a nova tentativa e uma linha nova.
  async retryFailed(id: string, dto: RetryFailedDto, requester: RequesterInfo) {
    const campaign = await this.findOne(id, requester.id);

    await this.instanceOwners.assertAccess(dto.instanceId, requester);

    const failedLogs = await this.messageLogRepo.find({
      where: { campaignId: campaign.id, status: 'failed', dispatchedBy: requester.id },
      order: { createdAt: 'ASC' },
    });

    if (failedLogs.length === 0) {
      throw new BadRequestException('Não há mensagens falhadas pra reenviar nessa campanha.');
    }

    if (requester.role !== 'admin') {
      await this.assertUserDailyLimit(requester.id, failedLogs.length);
    }

    const imageUrl = campaign.imageFilename
      ? `${this.configService.get<string>('internalUrl')}/campaigns/${campaign.id}/image`
      : undefined;
    const isPdf = campaign.imageFilename?.toLowerCase().endsWith('.pdf');
    const documentFileName = isPdf
      ? `${campaign.name.replace(/[\\/:*?"<>|]+/g, '').trim() || 'documento'}.pdf`
      : undefined;

    const messageLogIds: string[] = [];
    for (const old of failedLogs) {
      const messageLog = await this.messageLogRepo.save(
        this.messageLogRepo.create({
          instanceId: dto.instanceId,
          to: old.to,
          text: old.text,
          status: 'pending',
          campaignId: campaign.id,
          contactId: old.contactId,
          // reenvio sempre respeita o anti-ban, mesmo que a tentativa
          // original tenha sido em modo direto - reenviar nao repete o
          // "aceite de risco" original, entao nao herda o bypass.
          dispatchMode: 'auto',
          dispatchedBy: requester.id,
        }),
      );

      await this.queueProducer.enqueue({
        messageLogId: messageLog.id,
        instanceId: dto.instanceId,
        to: old.to,
        text: old.text,
        skipRateLimit: false,
        imageUrl,
        documentFileName,
      });

      messageLogIds.push(messageLog.id);
    }

    this.logger.log(
      `Reenvio de falhas: campanha=${campaign.id} usuario=${requester.id} instancia=${dto.instanceId} ` +
        `total=${messageLogIds.length}`,
    );

    return { retried: messageLogIds.length, messageLogIds };
  }
}
