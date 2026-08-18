import * as path from 'path';

export default () => ({
  port: parseInt(process.env.ENGINE_PORT, 10) || 3001,
  sessionsDir: path.resolve(process.env.SESSIONS_DIR || './sessions'),
  logLevel: process.env.LOG_LEVEL || 'info',
  // segredo compartilhado com o worker; exigido em todas as rotas (ver ApiKeyGuard)
  engineApiKey: process.env.ENGINE_API_KEY || '',
  metaCloud: {
    apiVersion: process.env.META_API_VERSION || 'v21.0',
    // JSON: { "instanceId": { "phoneNumberId": "...", "accessToken": "..." }, ... }
    // instanceIds listados aqui sao roteados para a Meta Cloud API em vez do Baileys
    instancesJson: process.env.META_INSTANCES || '',
  },
});
