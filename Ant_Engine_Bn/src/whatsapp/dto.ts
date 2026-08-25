import { IsOptional, IsString, IsUrl, Length, Matches } from 'class-validator';

// instanceId vira nome de pasta em disco (sessao) e chave de rate limit no worker -
// trava o formato pra evitar path traversal e afins.
const INSTANCE_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

export class SendDto {
  @IsString()
  @Length(1, 64)
  @Matches(INSTANCE_ID_PATTERN, { message: 'instanceId deve conter apenas letras, números, _ ou -' })
  instanceId: string;

  @IsString()
  @Length(1, 40)
  to: string;

  @IsString()
  @Length(1, 4096)
  text: string;

  // URL interna (ex: http://crm-api:3002/campaigns/:id/image) - require_tld:false
  // pra aceitar hostname de container docker (sem ponto/TLD)
  @IsOptional()
  @IsUrl({ require_tld: false })
  imageUrl?: string;

  // messageLogId do CRM (ver Ant_CRM_Bn/database/entities/message-log.entity.ts) -
  // usado como chave de idempotência: se o worker retentar o MESMO /send (ex:
  // o axios dele deu timeout mas a chamada anterior ainda está em andamento
  // aqui), reaproveitamos a chamada em vez de mandar a mensagem 2x.
  @IsOptional()
  @IsString()
  @Length(1, 64)
  messageId?: string;

  // Presença = tratar imageUrl como um documento (PDF) em vez de imagem -
  // vira o nome do arquivo exibido no WhatsApp. Ver
  // Ant_CRM_Bn/src/campaigns/campaigns.service.ts (dispatch).
  @IsOptional()
  @IsString()
  @Length(1, 200)
  documentFileName?: string;
}

export class InstanceIdDto {
  @IsString()
  @Length(1, 64)
  @Matches(INSTANCE_ID_PATTERN, { message: 'instanceId deve conter apenas letras, números, _ ou -' })
  instanceId: string;
}

// So digitos (com DDI, sem +/espacos/tracos) - exigencia do proprio
// requestPairingCode do Baileys (ver README dele).
const PHONE_NUMBER_PATTERN = /^[0-9]{8,15}$/;

export class ConnectDto {
  // Presenca = pedir codigo de pareamento em vez de esperar QR (ver
  // WhatsappService.openConnection). Ausente = fluxo QR de sempre.
  @IsOptional()
  @IsString()
  @Matches(PHONE_NUMBER_PATTERN, { message: 'phoneNumber deve conter só dígitos (com DDI), sem +, espaços ou traços' })
  phoneNumber?: string;
}
