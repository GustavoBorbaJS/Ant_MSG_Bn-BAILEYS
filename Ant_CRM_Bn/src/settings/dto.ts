import { Type } from 'class-transformer';
import { IsArray, IsInt, IsString, Min, ValidateNested } from 'class-validator';

class LevelLimitsDto {
  @IsInt()
  @Min(1)
  perMinute: number;

  @IsInt()
  @Min(1)
  perHour: number;

  @IsInt()
  @Min(1)
  perDay: number;
}

class LimitsDto {
  @ValidateNested()
  @Type(() => LevelLimitsDto)
  cold: LevelLimitsDto;

  @ValidateNested()
  @Type(() => LevelLimitsDto)
  warm: LevelLimitsDto;

  @ValidateNested()
  @Type(() => LevelLimitsDto)
  hot: LevelLimitsDto;
}

export class UpdateAntibanConfigDto {
  @IsInt()
  @Min(0)
  warmupDaysToWarm: number;

  @IsInt()
  @Min(0)
  warmupDaysToHot: number;

  @IsInt()
  @Min(1)
  globalDailyLimit: number;

  // controle administrativo (nao e do worker) - teto diario de mensagens pra
  // usuarios com role 'user'. Admin nao tem esse teto.
  @IsInt()
  @Min(1)
  userDailyMessageLimit: number;

  @IsArray()
  @IsString({ each: true })
  trustedInstances: string[];

  @ValidateNested()
  @Type(() => LimitsDto)
  limits: LimitsDto;
}
