import { IsOptional, IsString, Matches } from 'class-validator';

// So digitos (com DDI, sem +/espacos/tracos) - exigencia do proprio
// requestPairingCode do Baileys (ver Ant_Engine_Bn/src/whatsapp/dto.ts).
const PHONE_NUMBER_PATTERN = /^[0-9]{8,15}$/;

export class ConnectInstanceDto {
  // Presenca = pedir codigo de pareamento em vez de esperar QR - ver
  // InstancesController.connect.
  @IsOptional()
  @IsString()
  @Matches(PHONE_NUMBER_PATTERN, { message: 'phoneNumber deve conter só dígitos (com DDI), sem +, espaços ou traços' })
  phoneNumber?: string;
}
