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
  to: string;
  // ms entre a conexão ficar pronta e essa mensagem específica ser mandada -
  // correlaciona com delayAfterReconnectMs pra mapear a janela perigosa.
  // Não confirma decriptação no destinatário (ver comentário em dispatchNormal)
  msSinceReady: number;
}

@Injectable()
export class TestDispatchService {
  private readonly logger = new Logger(TestDispatchService.name);

  constructor(
    @InjectRepository(MessageLog) private readonly messageLogRepo: Repository<MessageLog>,
    private readonly engineClient: EngineClientService,
    private readonly instanceOwners: InstanceOwnersService,
  ) {}

  async dispatch(dto: TestDispatchDto, requester: TestRequesterInfo) {
    if (requester.role !== 'admin' && !requester.canDispatchTest) {
      throw new ForbiddenException('Disparo de teste é exclusivo para administradores ou usuários autorizados pelo administrador.');
    }

    await this.instanceOwners.assertAccess(dto.instanceId, requester);

    const text = dto.text?.trim() || DEFAULT_TEST_TEXT;
    const burstCount = dto.burstCount ?? 1;
    const texts = Array.from({ length: burstCount }, (_, i) => (burstCount > 1 ? `${text} (#${i + 1}/${burstCount})` : text));

    if (dto.aggressive) {
      return this.dispatchAggressive(dto, requester, texts, burstCount);
    }
    return this.dispatchNormal(dto, requester, texts, burstCount);
  }

  // Reproduz de propósito a janela de sincronismo pós-reconexão do Baileys:
  // reconecta a instância e manda burstCount mensagens em sequência IMEDIATA
  // (ou depois de delayAfterReconnectMs) em seguida, direto na engine - sem
  // passar pela fila normal (BullMQ/worker), que introduziria um atraso não
  // determinístico e mascararia a janela que queremos testar. burstCount > 1
  // é de propósito: o caso real que originou isso mostrou VÁRIAS mensagens
  // seguidas falhando pro mesmo contato. Sem garantia de reprodução - é uma
  // corrida de protocolo fora do nosso controle direto, isso só aumenta a
  // chance de pegar a janela.
  //
  // IMPORTANTE sobre confirmação: "sent" aqui só significa que o WhatsApp
  // aceitou a mensagem pro relay - não confirma que o destinatário conseguiu
  // decifrar ("Não foi possível carregar a mensagem" é um erro do LADO DO
  // RECEPTOR, invisível pra quem manda). O jeito confiável de confirmar
  // reprodução é olhar o log do engine com LOG_LEVEL=debug procurando
  // "recv retry request" pro messageId retornado aqui - é o protocolo do
  // WhatsApp avisando que o destinatário pediu reenvio por falha de
  // decriptação. Resultado "sent" sem esse log = provavelmente decifrou bem.
  private async dispatchNormal(dto: TestDispatchDto, requester: TestRequesterInfo, texts: string[], burstCount: number) {
    this.logger.warn(
      `Disparo de TESTE (reconnect + rajada${dto.delayAfterReconnectMs ? ` após ${dto.delayAfterReconnectMs}ms` : ' imediata'}, fora da fila): ` +
        `instancia=${dto.instanceId} usuario=${requester.id} to=${dto.to} burstCount=${burstCount}`,
    );

    const { status } = await this.engineClient.reconnect(dto.instanceId);
    if (status !== 'connected') {
      throw new BadRequestException(`Instância não ficou conectada a tempo pro teste (status=${status})`);
    }

    if (dto.delayAfterReconnectMs) {
      await new Promise((resolve) => setTimeout(resolve, dto.delayAfterReconnectMs));
    }

    const readyAt = Date.now();
    const recipients = dto.additionalRecipients?.length
      ? Array.from({ length: burstCount }, (_, i) => dto.additionalRecipients![i % dto.additionalRecipients!.length])
      : Array.from({ length: burstCount }, () => dto.to);

    const results: BurstResult[] = [];
    for (let i = 0; i < texts.length; i++) {
      const to = recipients[i];
      const messageText = texts[i];

      const messageLog = await this.messageLogRepo.save(
        this.messageLogRepo.create({
          instanceId: dto.instanceId,
          to,
          text: messageText,
          status: 'pending',
          dispatchMode: 'test',
          dispatchedBy: requester.id,
        }),
      );

      try {
        const result = await this.engineClient.send(dto.instanceId, to, messageText, messageLog.id);
        await this.messageLogRepo.update(messageLog.id, { status: 'sent', sentAt: new Date() });
        results.push({
          messageLogId: messageLog.id,
          messageId: result?.messageId,
          status: 'sent',
          to,
          msSinceReady: Date.now() - readyAt,
        });
      } catch (err) {
        const errorMessage = err.response?.data?.message || err.message || 'Falha desconhecida';
        await this.messageLogRepo.update(messageLog.id, { status: 'failed', failedAt: new Date(), errorMessage });
        results.push({ messageLogId: messageLog.id, status: 'failed', errorMessage, to, msSinceReady: Date.now() - readyAt });
      }
    }

    const sentCount = results.filter((r) => r.status === 'sent').length;
    if (sentCount === 0) {
      throw new BadRequestException(`Disparo de teste falhou: nenhuma das ${burstCount} mensagens foi enviada.`);
    }

    return { results, sentCount, burstCount, aggressive: false, delayAfterReconnectMs: dto.delayAfterReconnectMs ?? 0 };
  }

  // Modo AGRESSIVO: abre uma 2ª conexão Baileys concorrente na MESMA sessão
  // (ver Ant_Engine_Bn/src/whatsapp/whatsapp.service.ts forceSessionConflict),
  // forçando o WhatsApp a tratar isso como "mesmo dispositivo logando em outro
  // lugar" - bem mais determinístico pra reproduzir dessincronia de
  // criptografia que o modo normal, mas DESTRUTIVO: pode derrubar/corromper a
  // instância, exigindo reparear depois. Por isso exige a instância já
  // conectada de antes (não faz sentido reconectar e forçar conflito ao mesmo
  // tempo - queremos conflitar com uma conexão de verdade) e confirmação
  // explícita do risco.
  private async dispatchAggressive(dto: TestDispatchDto, requester: TestRequesterInfo, texts: string[], burstCount: number) {
    if (!dto.acknowledgeAggressiveRisk) {
      throw new BadRequestException(
        'O modo agressivo exige confirmação explícita do risco - pode derrubar ou corromper a sessão da instância.',
      );
    }

    const { status } = await this.engineClient.getStatus(dto.instanceId);
    if (status !== 'connected') {
      throw new BadRequestException(
        `Modo agressivo exige a instância já conectada de antes (status atual: ${status}) - conecte primeiro.`,
      );
    }

    this.logger.warn(
      `Disparo de TESTE AGRESSIVO (conflito de sessão forçado): instancia=${dto.instanceId} ` +
        `usuario=${requester.id} to=${dto.to} burstCount=${burstCount}`,
    );

    const logs = await Promise.all(
      texts.map((messageText) =>
        this.messageLogRepo.save(
          this.messageLogRepo.create({
            instanceId: dto.instanceId,
            to: dto.to,
            text: messageText,
            status: 'pending',
            dispatchMode: 'test',
            dispatchedBy: requester.id,
          }),
        ),
      ),
    );

    const conflictStartedAt = Date.now();
    let engineResults: { status: 'sent' | 'failed'; messageId?: string; errorMessage?: string }[];
    try {
      ({ results: engineResults } = await this.engineClient.forceSessionConflict(dto.instanceId, dto.to, texts));
    } catch (err) {
      const errorMessage = err.response?.data?.message || err.message || 'Falha desconhecida';
      await Promise.all(
        logs.map((log) => this.messageLogRepo.update(log.id, { status: 'failed', failedAt: new Date(), errorMessage })),
      );
      throw new BadRequestException(`Modo agressivo falhou: ${errorMessage}`);
    }

    const results: BurstResult[] = [];
    for (let i = 0; i < logs.length; i++) {
      const engineResult = engineResults[i];
      if (engineResult.status === 'sent') {
        await this.messageLogRepo.update(logs[i].id, { status: 'sent', sentAt: new Date() });
      } else {
        await this.messageLogRepo.update(logs[i].id, {
          status: 'failed',
          failedAt: new Date(),
          errorMessage: engineResult.errorMessage,
        });
      }
      results.push({
        messageLogId: logs[i].id,
        messageId: engineResult.messageId,
        status: engineResult.status,
        errorMessage: engineResult.errorMessage,
        to: dto.to,
        // aproximado - a engine manda a rajada em loop sequencial e não
        // devolve timestamp por mensagem, só o elapsed desde que a 2ª conexão
        // (shadow) começou a ser aberta
        msSinceReady: Date.now() - conflictStartedAt,
      });
    }

    const sentCount = results.filter((r) => r.status === 'sent').length;
    return { results, sentCount, burstCount, aggressive: true };
  }
}
