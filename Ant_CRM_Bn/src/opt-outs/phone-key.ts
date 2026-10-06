// Chave de comparação de telefone pro opt-out.
//
// O mesmo celular brasileiro aparece de dois jeitos: o contato cadastrado com
// o nono dígito (5531 9 8888-7777, 13 dígitos) e o WhatsApp respondendo, em
// boa parte dos DDDs, SEM ele (5531 8888-7777, 12 dígitos). Comparar o
// telefone cru deixaria passar justamente quem pediu pra sair. A chave tira o
// nono dígito de números brasileiros de 13 dígitos, então as duas formas caem
// no mesmo valor. Números de outros países ficam só com os dígitos.
export function toPhoneKey(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  const isBrazilianMobileWithNinthDigit = digits.length === 13 && digits.startsWith('55') && digits[4] === '9';
  return isBrazilianMobileWithNinthDigit ? digits.slice(0, 4) + digits.slice(5) : digits;
}
