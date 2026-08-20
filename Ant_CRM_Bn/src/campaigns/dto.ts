import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Min,
} from 'class-validator';

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
}
