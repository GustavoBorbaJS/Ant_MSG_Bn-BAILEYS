import { Mutex } from 'async-mutex';
import { mkdir, readFile, stat, unlink, writeFile } from 'fs/promises';
import { join } from 'path';
import * as crypto from 'crypto';
import { AuthenticationCreds, AuthenticationState, initAuthCreds, BufferJSON, proto } from '@whiskeysockets/baileys';

// Mesma lógica do useMultiFileAuthState oficial do Baileys (um arquivo por chave,
// um creds.json), mas cada arquivo é criptografado em disco com AES-256-GCM antes
// de gravar e decifrado ao ler. As credenciais do Baileys equivalem às chaves de
// sessão do WhatsApp: quem tiver acesso a elas em texto puro consegue personificar
// o número. Isso protege contra vazamento do volume/disco/backup.

const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function loadEncryptionKey(): Buffer {
  const hex = process.env.SESSIONS_ENCRYPTION_KEY;
  if (!hex) {
    throw new Error(
      'SESSIONS_ENCRYPTION_KEY não definida. Gere uma com: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    );
  }
  const key = Buffer.from(hex, 'hex');
  if (key.length !== 32) {
    throw new Error('SESSIONS_ENCRYPTION_KEY inválida: precisa ser uma string hex de 32 bytes (64 caracteres)');
  }
  return key;
}

function encrypt(plaintext: string, key: Buffer): Buffer {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
}

function decrypt(data: Buffer, key: Buffer): string {
  const iv = data.subarray(0, IV_LENGTH);
  const authTag = data.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = data.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

const fileLocks = new Map<string, Mutex>();
const getFileLock = (path: string): Mutex => {
  let mutex = fileLocks.get(path);
  if (!mutex) {
    mutex = new Mutex();
    fileLocks.set(path, mutex);
  }
  return mutex;
};

const fixFileName = (file: string) => file?.replace(/\//g, '__')?.replace(/:/g, '-');

export const useEncryptedMultiFileAuthState = async (
  folder: string,
): Promise<{ state: AuthenticationState; saveCreds: () => Promise<void> }> => {
  const key = loadEncryptionKey();

  const writeData = async (data: unknown, file: string) => {
    const filePath = join(folder, fixFileName(file));
    const mutex = getFileLock(filePath);
    return mutex.acquire().then(async (release) => {
      try {
        const json = JSON.stringify(data, BufferJSON.replacer);
        await writeFile(filePath, encrypt(json, key));
      } finally {
        release();
      }
    });
  };

  const readData = async (file: string) => {
    try {
      const filePath = join(folder, fixFileName(file));
      const mutex = getFileLock(filePath);
      return await mutex.acquire().then(async (release) => {
        try {
          const raw = await readFile(filePath);
          const json = decrypt(raw, key);
          return JSON.parse(json, BufferJSON.reviver);
        } finally {
          release();
        }
      });
    } catch {
      return null;
    }
  };

  const removeData = async (file: string) => {
    try {
      const filePath = join(folder, fixFileName(file));
      const mutex = getFileLock(filePath);
      await mutex.acquire().then(async (release) => {
        try {
          await unlink(filePath);
        } catch {
          // arquivo ja nao existe, tudo bem
        } finally {
          release();
        }
      });
    } catch {
      // sem lock ainda registrado, nada a remover
    }
  };

  const folderInfo = await stat(folder).catch(() => undefined);
  if (folderInfo) {
    if (!folderInfo.isDirectory()) {
      throw new Error(`Existe algo que não é um diretório em ${folder}`);
    }
  } else {
    await mkdir(folder, { recursive: true });
  }

  const creds: AuthenticationCreds = (await readData('creds.json')) || initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data: Record<string, any> = {};
          await Promise.all(
            ids.map(async (id) => {
              let value = await readData(`${type}-${id}.json`);
              if (type === 'app-state-sync-key' && value) {
                value = proto.Message.AppStateSyncKeyData.fromObject(value);
              }
              data[id] = value;
            }),
          );
          return data;
        },
        set: async (data) => {
          const tasks: Promise<void>[] = [];
          for (const category in data) {
            for (const id in data[category]) {
              const value = data[category][id];
              const file = `${category}-${id}.json`;
              tasks.push(value ? writeData(value, file) : removeData(file));
            }
          }
          await Promise.all(tasks);
        },
      },
    },
    saveCreds: () => writeData(creds, 'creds.json'),
  };
};
