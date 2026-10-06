import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

// Cifra as chaves de API dos usuários antes de irem pro banco (AES-256-GCM).
// A chave de cifragem deriva de um segredo do servidor, então um dump do
// banco sozinho não entrega as chaves de API de ninguém.
//
// Formato guardado: base64( iv[12] | tag[16] | ciphertext ).
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

export class SecretBox {
  private readonly key: Buffer;

  constructor(secret: string) {
    this.key = createHash('sha256').update(secret).digest();
  }

  encrypt(plain: string): string {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
  }

  // Lança se o conteúdo foi adulterado ou cifrado com outro segredo (ex: o
  // segredo do servidor foi trocado) - quem chama trata como "sem chave".
  decrypt(boxed: string): string {
    const raw = Buffer.from(boxed, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', this.key, raw.subarray(0, IV_LENGTH));
    decipher.setAuthTag(raw.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH));
    return Buffer.concat([decipher.update(raw.subarray(IV_LENGTH + TAG_LENGTH)), decipher.final()]).toString('utf8');
  }
}
