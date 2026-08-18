import { IsString, Length, Matches } from 'class-validator';

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
}

export class InstanceIdDto {
  @IsString()
  @Length(1, 64)
  @Matches(INSTANCE_ID_PATTERN, { message: 'instanceId deve conter apenas letras, números, _ ou -' })
  instanceId: string;
}
