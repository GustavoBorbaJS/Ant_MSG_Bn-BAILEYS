import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';

// Teto de segurança pra repeatCount (ver DispatchCampaignDto abaixo) - so
// admin usa essa opção, mas mesmo assim protege contra erro de digitação
// (ex: 500000 em vez de 500) que travaria o worker/fila por horas.
export const MAX_REPEAT_COUNT = 5000;

export type DispatchMode = 'auto' | 'direct';

const INSTANCE_ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

export class CreateCampaignDto {
  @IsString()
  @Length(1, 200)
  name: string;

  @IsString()
  @Length(1, 4096)
  text: string;
}

export class UpdateCampaignDto {
  @IsOptional()
  @IsString()
  @Length(1, 200)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(1, 4096)
  text?: string;
}

export class DispatchCampaignDto {
  @IsString()
  @Matches(INSTANCE_ID_PATTERN, { message: 'instanceId deve conter apenas letras, números, _ ou -' })
  instanceId: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  contactIds: string[];

  // 'direct' pula o rate limit do anti-ban (Ant_MSG_Bn) - exige acknowledgeRisk
  // e opcionalmente um plano de lotes (ver CampaignsService.dispatch)
  @IsOptional()
  @IsIn(['auto', 'direct'])
  mode?: DispatchMode;

  @IsOptional()
  @IsBoolean()
  acknowledgeRisk?: boolean;

  // ex: [200, 100, 200] - soma precisa bater com contactIds.length
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsInt({ each: true })
  @Min(1, { each: true })
  batchSizes?: number[];

  @IsOptional()
  @IsInt()
  @Min(1)
  batchIntervalMinutes?: number;

  // Repete cada contato selecionado N vezes (ex: mandar 500x pro seu próprio
  // número pra testar a instância/fila). Exclusivo de admin - ver
  // CampaignsService.dispatch. Default 1 (comportamento normal).
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_REPEAT_COUNT)
  repeatCount?: number;

  // Agenda o disparo pra um horário futuro (ISO 8601) em vez de imediato -
  // as message_logs já são criadas agora (aparecem como "pendente" no
  // histórico), só o envio de fato fica adiado até esse horário (ver
  // CampaignsService.dispatch). Se vier no passado, dispara imediatamente.
  @IsOptional()
  @IsISO8601()
  scheduledAt?: string;
}

export class RetryFailedDto {
  // Instância a usar no reenvio - pode ser diferente da que as mensagens
  // originais tentaram (ex: aquela caiu/nunca conectou, essa aqui já
  // reconectou). Ver CampaignsService.retryFailed.
  @IsString()
  @Matches(INSTANCE_ID_PATTERN, { message: 'instanceId deve conter apenas letras, números, _ ou -' })
  instanceId: string;
}
