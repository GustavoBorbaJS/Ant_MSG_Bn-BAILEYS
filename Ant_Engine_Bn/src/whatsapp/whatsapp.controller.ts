import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { WhatsappService } from './whatsapp.service';
import { MetaCloudService } from '../meta-cloud/meta-cloud.service';
import { InstanceIdDto, SendDto } from './dto';
import { InstanceNotConnectedError, InvalidRecipientError } from './errors';

const INSTANCE_ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

function assertValidInstanceId(instanceId: string): void {
  if (!INSTANCE_ID_PATTERN.test(instanceId)) {
    throw new BadRequestException('instanceId inválido');
  }
}

@Controller()
export class WhatsappController {
  constructor(
    private readonly whatsappService: WhatsappService,
    private readonly metaCloudService: MetaCloudService,
  ) {}

  // Contrato consumido pelo worker (Ant_MSG_Bn/src/engine/engine.service.ts)
  // engine.service.ts checa response.status === 200, entao nao pode ser o 201 default do Nest para POST
  //
  // Roteamento: instanceIds registrados em META_INSTANCES vao para a Meta Cloud API
  // (numero oficial, sem risco de ban); o resto continua no Baileys. O worker nao sabe
  // nem precisa saber a diferenca - mesma fila, mesmo contrato.
  @Post('send')
  @HttpCode(200)
  async send(@Body() body: SendDto) {
    try {
      if (this.metaCloudService.hasInstance(body.instanceId)) {
        return await this.metaCloudService.sendMessage(
          body.instanceId,
          body.to,
          body.text,
          body.imageUrl,
          body.messageId,
          body.documentFileName,
        );
      }
      return await this.whatsappService.sendMessage(
        body.instanceId,
        body.to,
        body.text,
        body.imageUrl,
        body.messageId,
        body.documentFileName,
      );
    } catch (err) {
      // Status distintos por causa, pra quem consome (Ant_MSG_Bn/src/queue/queue.consumer.ts)
      // conseguir decidir "vale a pena retentar" sem precisar adivinhar por
      // texto de mensagem de erro:
      //   400 = destinatario invalido (nao adianta retentar)
      //   409 = instancia desconectada (transitorio - deve retentar/aguardar reconexao)
      //   503 = qualquer outra falha de envio (default, transitorio)
      if (err instanceof InvalidRecipientError) {
        throw new HttpException(err.message, HttpStatus.BAD_REQUEST);
      }
      if (err instanceof InstanceNotConnectedError) {
        throw new HttpException(err.message, HttpStatus.CONFLICT);
      }
      throw new HttpException(err.message, HttpStatus.SERVICE_UNAVAILABLE);
    }
  }

  @Get('status/:instanceId')
  status(@Param('instanceId') instanceId: string) {
    assertValidInstanceId(instanceId);
    if (this.metaCloudService.hasInstance(instanceId)) {
      return this.metaCloudService.getStatus(instanceId);
    }
    return this.whatsappService.getStatus(instanceId);
  }

  @Post('reconnect')
  @HttpCode(200)
  reconnect(@Body() body: InstanceIdDto) {
    // Meta Cloud API nao tem sessao pra "reconectar" - so reflete o status atual do numero
    if (this.metaCloudService.hasInstance(body.instanceId)) {
      return this.metaCloudService.getStatus(body.instanceId);
    }
    return this.whatsappService.reconnect(body.instanceId);
  }

  // Endpoints de gestao/pareamento (usados por uma futura tela de onboarding, ou manualmente)
  // Nao se aplicam a instancias Meta Cloud API (nao ha QR code / pareamento).
  @Post('instances/:instanceId/connect')
  connect(@Param('instanceId') instanceId: string) {
    assertValidInstanceId(instanceId);
    return this.whatsappService.connectInstance(instanceId);
  }

  @Get('instances')
  list() {
    return this.whatsappService.listInstances();
  }

  // Apaga a sessao (nao e so um reconnect) - pra desatolar uma instancia
  // presa numa sessao morta/invalida, sem precisar entrar no servidor.
  // Nao se aplica a Meta Cloud API (nao tem sessao local pra limpar).
  @Delete('instances/:instanceId')
  @HttpCode(200)
  async reset(@Param('instanceId') instanceId: string) {
    assertValidInstanceId(instanceId);
    if (this.metaCloudService.hasInstance(instanceId)) {
      throw new BadRequestException('Instâncias Meta Cloud API não têm sessão local pra limpar');
    }
    await this.whatsappService.resetInstance(instanceId);
    return { status: 'disconnected' };
  }

  // Confere se um numero existe de verdade no WhatsApp antes de mandar qualquer coisa -
  // util pra diagnosticar formato errado (DDI/DDD faltando etc), ja que o send nao falha
  // sozinho quando o JID nao corresponde a ninguem.
  @Get('instances/:instanceId/check/:to')
  async check(@Param('instanceId') instanceId: string, @Param('to') to: string) {
    assertValidInstanceId(instanceId);
    try {
      return await this.whatsappService.checkNumber(instanceId, to);
    } catch (err) {
      throw new HttpException(err.message, HttpStatus.SERVICE_UNAVAILABLE);
    }
  }
}
