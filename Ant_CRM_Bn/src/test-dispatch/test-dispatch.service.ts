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
  // manda a mensagem IMEDIATAMENTE em seguida, direto na engine - sem passar
  // pela fila normal (BullMQ/worker), que introduziria um atraso não
  // determinístico e mascararia a janela que queremos testar. Por isso é
  // restrito: é uma ferramenta de diagnóstico, não um disparo comum.
  async dispatch(dto: TestDispatchDto, requester: TestRequesterInfo) {
    if (requester.role !== 'admin' && !requester.canDispatchTest) {
      throw new ForbiddenException('Disparo de teste é exclusivo para administradores ou usuários autorizados pelo administrador.');
    }

    await this.instanceOwners.assertAccess(dto.instanceId, requester);

    const text = dto.text?.trim() || DEFAULT_TEST_TEXT;

    const messageLog = await this.messageLogRepo.save(
      this.messageLogRepo.create({
        instanceId: dto.instanceId,
        to: dto.to,
        text,
        status: 'pending',
        dispatchMode: 'test',
        dispatchedBy: requester.id,
      }),
    );

    this.logger.warn(
      `Disparo de TESTE (reconnect + envio imediato, fora da fila): instancia=${dto.instanceId} ` +
        `usuario=${requester.id} to=${dto.to} messageLogId=${messageLog.id}`,
    );

    try {
      const { status } = await this.engineClient.reconnect(dto.instanceId);
      if (status !== 'connected') {
        throw new Error(`Instância não ficou conectada a tempo pro teste (status=${status})`);
      }

      const result = await this.engineClient.send(dto.instanceId, dto.to, text, messageLog.id);

      await this.messageLogRepo.update(messageLog.id, { status: 'sent', sentAt: new Date() });
      return { messageLogId: messageLog.id, messageId: result?.messageId, status: 'sent' as const };
    } catch (err) {
      const errorMessage = err.response?.data?.message || err.message || 'Falha desconhecida';
      await this.messageLogRepo.update(messageLog.id, { status: 'failed', failedAt: new Date(), errorMessage });
      throw new BadRequestException(`Disparo de teste falhou: ${errorMessage}`);
    }
  }
}
