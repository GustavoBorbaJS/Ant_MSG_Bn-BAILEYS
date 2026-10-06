import type { proto, WAMessageKey } from '@whiskeysockets/baileys';

// Funções puras do opt-out ("Não tenho interesse"): decidir se um texto é um
// pedido de saída e descobrir de quem veio. Sem socket nem rede, pra dar pra
// conferir os casos sem parear um número.

// Frases aceitas como pedido de saída, já normalizadas (minúsculas, sem
// acento, sem pontuação). A primeira é a que o rodapé das campanhas anuncia
// (OPT_OUT_FOOTER em Ant_CRM_Bn/src/config/configuration.ts) - se mudar o
// texto do rodapé, a frase nova precisa entrar aqui.
const OPT_OUT_PHRASES = [
  'nao tenho interesse',
  'sem interesse',
  'nao quero receber',
  'nao quero mais receber',
  'sair',
  'parar',
  'pare',
  'stop',
  'remover',
  'descadastrar',
];

// Só a frase anunciada aceita complemento ("não tenho interesse, obrigado"),
// e mesmo assim em mensagem curta. O resto precisa ser a mensagem inteira:
// "sair" solto é pedido de saída, "vou sair agora, te ligo depois" não é.
const PREFIX_PHRASE = OPT_OUT_PHRASES[0];
const MAX_PREFIX_MESSAGE_LENGTH = 60;

export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function isOptOutMessage(text: string): boolean {
  const normalized = normalizeText(text);
  if (!normalized) return false;
  if (OPT_OUT_PHRASES.includes(normalized)) return true;
  return normalized.startsWith(PREFIX_PHRASE) && normalized.length <= MAX_PREFIX_MESSAGE_LENGTH;
}

// Texto de uma mensagem recebida, onde quer que o WhatsApp o coloque: texto
// simples, texto com preview/citação, ou o rótulo de um botão/lista clicado
// (é o que chega quando a pessoa toca num botão "Não tenho interesse").
export function extractText(message: proto.IMessage | null | undefined): string {
  const inner = message?.ephemeralMessage?.message ?? message;
  return (
    inner?.conversation ||
    inner?.extendedTextMessage?.text ||
    inner?.buttonsResponseMessage?.selectedDisplayText ||
    inner?.templateButtonReplyMessage?.selectedDisplayText ||
    inner?.listResponseMessage?.title ||
    ''
  );
}

const PHONE_JID_SUFFIX = '@s.whatsapp.net';

function phoneFromJid(jid: string | null | undefined): string | null {
  if (!jid?.endsWith(PHONE_JID_SUFFIX)) return null;
  // "5531988887777:12@s.whatsapp.net" -> "5531988887777"
  return jid.split('@')[0].split(':')[0];
}

// Conversa individual (não grupo, status nem canal)?
export function isDirectChat(key: WAMessageKey): boolean {
  const jid = key.remoteJid ?? '';
  return jid.endsWith(PHONE_JID_SUFFIX) || jid.endsWith('@lid');
}

// Telefone de quem mandou. O WhatsApp cada vez mais entrega o remetente como
// LID (identificador anônimo, "...@lid") em vez do número - nesse caso o
// número vem em remoteJidAlt ou precisa ser resolvido pelo mapeamento da
// sessão (resolveLid). null = não deu pra descobrir o número.
export async function resolveSenderPhone(
  key: WAMessageKey,
  resolveLid: (lid: string) => Promise<string | null>,
): Promise<string | null> {
  const direct = phoneFromJid(key.remoteJid) ?? phoneFromJid(key.remoteJidAlt);
  if (direct) return direct;

  if (key.remoteJid?.endsWith('@lid')) {
    return phoneFromJid(await resolveLid(key.remoteJid).catch(() => null));
  }
  return null;
}
