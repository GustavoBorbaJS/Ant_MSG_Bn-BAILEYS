import * as path from 'path';

const DEFAULT_OPT_OUT_CONFIRMATION = 'Pronto! Você não vai mais receber nossas mensagens.';

function resolveOptOutConfirmation(raw: string | undefined): string {
  if (!raw?.trim()) return DEFAULT_OPT_OUT_CONFIRMATION;
  return raw.trim().toLowerCase() === 'off' ? '' : raw.trim();
}

export default () => ({
  port: parseInt(process.env.ENGINE_PORT, 10) || 3001,
  sessionsDir: path.resolve(process.env.SESSIONS_DIR || './sessions'),
  logLevel: process.env.LOG_LEVEL || 'info',
  // segredo compartilhado com o worker; exigido em todas as rotas (ver ApiKeyGuard)
  engineApiKey: process.env.ENGINE_API_KEY || '',
  // onde o engine avisa o CRM de um pedido de saída ("Não tenho interesse") -
  // nome do serviço no docker-compose (ver whatsapp/opt-out.service.ts)
  crmInternalUrl: process.env.CRM_INTERNAL_URL || 'http://crm-api:3002',
  optOut: {
    // resposta enviada a quem pediu pra sair; OPT_OUT_CONFIRMATION=off desliga
    confirmationText: resolveOptOutConfirmation(process.env.OPT_OUT_CONFIRMATION),
  },
  metaCloud: {
    apiVersion: process.env.META_API_VERSION || 'v21.0',
    // JSON: { "instanceId": { "phoneNumberId": "...", "accessToken": "..." }, ... }
    // instanceIds listados aqui sao roteados para a Meta Cloud API em vez do Baileys
    instancesJson: process.env.META_INSTANCES || '',
  },
});
