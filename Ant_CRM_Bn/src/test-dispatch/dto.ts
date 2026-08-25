import { IsInt, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';

const INSTANCE_ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

// Teto de segurança pra rajada - o objetivo é aumentar a chance de pegar a
// janela de sincronismo pós-reconexão (ver TestDispatchService), não fazer
// disparo em massa disfarçado de teste.
export const MAX_TEST_BURST_COUNT = 20;

export class TestDispatchDto {
  @IsString()
  @Matches(INSTANCE_ID_PATTERN, { message: 'instanceId deve conter apenas letras, números, _ ou -' })
  instanceId: string;

  @IsString()
  @Length(8, 40)
  to: string;

  @IsOptional()
  @IsString()
  @Length(1, 4096)
  text?: string;

  // Quantas mensagens mandar em sequência imediata logo após o reconnect
  // (default 1). O caso real que originou essa feature mostrou várias
  // mensagens seguidas falhando pro mesmo contato - uma rajada se parece
  // mais com isso do que um envio único.
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_TEST_BURST_COUNT)
  burstCount?: number;
}
