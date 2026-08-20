import { IsArray, IsOptional, IsString, Length } from 'class-validator';

export class CreateContactDto {
  @IsString()
  @Length(1, 200)
  name: string;

  @IsString()
  @Length(1, 30)
  phone: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsString()
  @Length(0, 2000)
  notes?: string;
}

export class UpdateContactDto {
  @IsOptional()
  @IsString()
  @Length(1, 200)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(1, 30)
  phone?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsString()
  @Length(0, 2000)
  notes?: string;
}
