import { IsOptional, IsString, Length, Matches } from 'class-validator';

const INSTANCE_ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

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
}
