import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MessageLog } from '../database/entities/message-log.entity';
import { EngineClientService } from '../instances/engine-client.service';
import { InstanceOwnersService, RequesterInfo } from '../instance-owners/instance-owners.service';
import { TestDispatchDto } from './dto';

const DEFAULT_TEST_TEXT =
  '🧪 Mensagem de teste (Dispara) - disparo de diagnóstico da instância, ignore se não esperava isso.';

export interface TestRequesterInfo extends RequesterInfo {
  canDispatchTest?: boolean;
}

export interface BurstResult {
  messageLogId: string;
  messageId?: string;
  status: 'sent' | 'failed';
  errorMessage?: string;
}

@Injectable()
export class TestDispatchService {
  private readonly logger = new Logger(TestDispatchService.name);

  constructor(
    @InjectRepository(MessageLog) private readonly messageLogRepo: Repository<MessageLog>,
    private readonly engineClient: EngineClientService,
    private readonly instanceOwners: InstanceOwnersService,
  ) {}

  // Reproduz de propósito a janela de sincronismo pós-reconexão do Baileys
  // (ver conversa/investigação que originou isso): reconecta a instância e
  // manda burstCount mensagens em sequência IMEDIATA em seguida, direto na
  // engine - sem passar pela fila normal (BullMQ/worker), que introduziria um
  // atraso não determinístico e mascararia a janela que queremos testar.
  // burstCount > 1 é de propósito (não é só "mandar mais rápido"): o caso
  // real que originou isso mostrou VÁRIAS mensagens seguidas falhando pro
  // mesmo contato, então uma rajada imediata pós-reconexão se parece mais com
  // esse cenário do que um envio único. Sem garantia de reprodução - é uma
  // corrida de protocolo fora do nosso controle direto, isso só aumenta a
  // chance de pegar a janela. Por isso é restrito: ferramenta de diagnóstico,
  // não um disparo comum.
  async dispatch(dto: TestDispatchDto, requester: TestRequesterInfo) {
    if (requester.role !== 'admin' && !requester.canDispatchTest) {
      throw new ForbiddenException('Disparo de teste é exclusivo para administradores ou usuários autorizados pelo administrador.');
    }

    await this.instanceOwners.assertAccess(dto.instanceId, requester);

    const text = dto.text?.trim() || DEFAULT_TEST_TEXT;
    const burstCount = dto.burstCount ?? 1;

    this.logger.warn(
      `Disparo de TESTE (reconnect + rajada imediata, fora da fila): instancia=${dto.instanceId} ` +
        `usuario=${requester.id} to=${dto.to} burstCount=${burstCount}`,
    );

    const { status } = await this.engineClient.reconnect(dto.instanceId);
    if (status !== 'connected') {
      throw new BadRequestException(`Instância não ficou conectada a tempo pro teste (status=${status})`);
    }

    const results: BurstResult[] = [];
    for (let i = 0; i < burstCount; i++) {
      const messageText = burstCount > 1 ? `${text} (#${i + 1}/${burstCount})` : text;
      const messageLog = await this.messageLogRepo.save(
        this.messageLogRepo.create({
          instanceId: dto.instanceId,
          to: dto.to,
          text: messageText,
          status: 'pending',
          dispatchMode: 'test',
          dispatchedBy: requester.id,
        }),
      );

      try {
        const result = await this.engineClient.send(dto.instanceId, dto.to, messageText, messageLog.id);
        await this.messageLogRepo.update(messageLog.id, { status: 'sent', sentAt: new Date() });
        results.push({ messageLogId: messageLog.id, messageId: result?.messageId, status: 'sent' });
      } catch (err) {
        const errorMessage = err.response?.data?.message || err.message || 'Falha desconhecida';
        await this.messageLogRepo.update(messageLog.id, { status: 'failed', failedAt: new Date(), errorMessage });
        results.push({ messageLogId: messageLog.id, status: 'failed', errorMessage });
      }
    }

    const sentCount = results.filter((r) => r.status === 'sent').length;
    if (sentCount === 0) {
      throw new BadRequestException(`Disparo de teste falhou: nenhuma das ${burstCount} mensagens foi enviada.`);
    }

    return { results, sentCount, burstCount };
  }
}
