import Anthropic from '@anthropic-ai/sdk';
import axios from 'axios';

// Provedores de IA que o usuário pode escolher no menu "IA". Cada um sabe
// duas coisas: listar os modelos que a chave enxerga e completar um texto.
// Provedor novo = mais um item em AI_PROVIDERS implementando AiProvider; o
// resto do sistema (AiService, saúde da instância, campanhas) não muda.

export type AiProviderId = 'anthropic' | 'openai' | 'gemini';

export interface AiModelOption {
  id: string;
  label: string;
}

export interface AiCompletionRequest {
  apiKey: string;
  model: string;
  system: string;
  user: string;
}

export interface AiProvider {
  id: AiProviderId;
  label: string;
  // onde o usuário cria a chave e como ela costuma começar - só pra tela
  keyUrl: string;
  keyPlaceholder: string;
  // usado quando o usuário salva sem escolher modelo; null = precisa escolher
  defaultModel: string | null;
  listModels(apiKey: string): Promise<AiModelOption[]>;
  complete(request: AiCompletionRequest): Promise<string>;
}

export type AiErrorKind = 'auth' | 'rate_limit' | 'refusal' | 'unavailable';

// Erro já traduzido pra quem usa o painel. kind deixa o chamador decidir o
// status HTTP sem olhar pra texto de mensagem.
export class AiProviderError extends Error {
  constructor(
    message: string,
    readonly kind: AiErrorKind,
  ) {
    super(message);
    this.name = 'AiProviderError';
  }
}

const REQUEST_TIMEOUT_MS = 60_000;

// ---------------------------------------------------------------- Anthropic

// Teto de saída pedido ao modelo. A resposta em si é curta (uma mensagem de
// WhatsApp ou um diagnóstico), mas nos modelos atuais o raciocínio do modelo
// também conta nesse teto - apertar demais corta a resposta no meio.
const ANTHROPIC_MAX_TOKENS = 16000;

function anthropicClient(apiKey: string): Anthropic {
  return new Anthropic({ apiKey, timeout: REQUEST_TIMEOUT_MS, maxRetries: 1 });
}

function toAnthropicError(error: unknown): AiProviderError {
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    return new AiProviderError('Chave de API da Anthropic inválida ou sem permissão.', 'auth');
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new AiProviderError('A Anthropic limitou as requisições desta chave. Tente de novo em instantes.', 'rate_limit');
  }
  if (error instanceof Anthropic.APIError) {
    return new AiProviderError(`A Anthropic recusou a requisição (${error.status ?? 'sem status'}): ${error.message}`, 'unavailable');
  }
  return new AiProviderError(`Não foi possível falar com a Anthropic: ${(error as Error).message}`, 'unavailable');
}

const anthropic: AiProvider = {
  id: 'anthropic',
  label: 'Anthropic (Claude)',
  keyUrl: 'https://console.anthropic.com/settings/keys',
  keyPlaceholder: 'sk-ant-...',
  defaultModel: 'claude-opus-5-5',

  async listModels(apiKey) {
    try {
      const models: AiModelOption[] = [];
      for await (const model of anthropicClient(apiKey).models.list()) {
        models.push({ id: model.id, label: model.display_name });
      }
      return models;
    } catch (error) {
      throw toAnthropicError(error);
    }
  },

  async complete({ apiKey, model, system, user }) {
    try {
      const client = anthropicClient(apiKey);
      // modelos mais antigos aceitam menos saída que o nosso teto padrão
      const modelInfo = await client.models.retrieve(model);
      const response = await client.messages.create({
        model,
        max_tokens: Math.min(ANTHROPIC_MAX_TOKENS, modelInfo.max_tokens ?? ANTHROPIC_MAX_TOKENS),
        system,
        messages: [{ role: 'user', content: user }],
      });

      if (response.stop_reason === 'refusal') {
        throw new AiProviderError('O modelo se recusou a responder a este pedido.', 'refusal');
      }

      return response.content
        .map((block) => (block.type === 'text' ? block.text : ''))
        .join('')
        .trim();
    } catch (error) {
      throw error instanceof AiProviderError ? error : toAnthropicError(error);
    }
  },
};

// ------------------------------------------------------- OpenAI e Gemini (REST)

function toHttpError(providerLabel: string, error: any): AiProviderError {
  const status: number | undefined = error.response?.status;
  const detail: string = error.response?.data?.error?.message || error.message;

  if (status === 401 || status === 403) {
    return new AiProviderError(`Chave de API da ${providerLabel} inválida ou sem permissão.`, 'auth');
  }
  if (status === 429) {
    return new AiProviderError(`A ${providerLabel} limitou as requisições desta chave (ou a conta está sem créditos).`, 'rate_limit');
  }
  return new AiProviderError(`A ${providerLabel} recusou a requisição${status ? ` (${status})` : ''}: ${detail}`, 'unavailable');
}

// /v1/models da OpenAI devolve tudo que a conta acessa (áudio, imagem,
// embeddings...) - aqui só interessa o que conversa por texto.
const OPENAI_NON_CHAT = /embedding|whisper|tts|dall-e|image|audio|realtime|moderation|transcribe|search|instruct|davinci|babbage|sora|codex/i;

const openai: AiProvider = {
  id: 'openai',
  label: 'OpenAI (ChatGPT)',
  keyUrl: 'https://platform.openai.com/api-keys',
  keyPlaceholder: 'sk-...',
  defaultModel: null,

  async listModels(apiKey) {
    try {
      const { data } = await axios.get('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${apiKey}` },
        timeout: REQUEST_TIMEOUT_MS,
      });
      return (data.data as { id: string }[])
        .filter((model) => !OPENAI_NON_CHAT.test(model.id))
        .map((model) => ({ id: model.id, label: model.id }))
        .sort((a, b) => a.id.localeCompare(b.id));
    } catch (error) {
      throw toHttpError('OpenAI', error);
    }
  },

  async complete({ apiKey, model, system, user }) {
    try {
      const { data } = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        },
        { headers: { Authorization: `Bearer ${apiKey}` }, timeout: REQUEST_TIMEOUT_MS },
      );
      return String(data.choices?.[0]?.message?.content ?? '').trim();
    } catch (error) {
      throw toHttpError('OpenAI', error);
    }
  },
};

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

const gemini: AiProvider = {
  id: 'gemini',
  label: 'Google (Gemini)',
  keyUrl: 'https://aistudio.google.com/apikey',
  keyPlaceholder: 'AIza...',
  defaultModel: null,

  async listModels(apiKey) {
    try {
      const { data } = await axios.get(`${GEMINI_BASE_URL}/models`, {
        headers: { 'x-goog-api-key': apiKey },
        params: { pageSize: 200 },
        timeout: REQUEST_TIMEOUT_MS,
      });
      return ((data.models ?? []) as { name: string; displayName?: string; supportedGenerationMethods?: string[] }[])
        .filter((model) => model.supportedGenerationMethods?.includes('generateContent'))
        .map((model) => ({ id: model.name.replace(/^models\//, ''), label: model.displayName || model.name }));
    } catch (error) {
      throw toHttpError('Google', error);
    }
  },

  async complete({ apiKey, model, system, user }) {
    try {
      const { data } = await axios.post(
        `${GEMINI_BASE_URL}/models/${encodeURIComponent(model)}:generateContent`,
        {
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: user }] }],
        },
        { headers: { 'x-goog-api-key': apiKey }, timeout: REQUEST_TIMEOUT_MS },
      );

      const parts: { text?: string }[] = data.candidates?.[0]?.content?.parts ?? [];
      const text = parts.map((part) => part.text ?? '').join('').trim();
      if (!text && data.promptFeedback?.blockReason) {
        throw new AiProviderError('O modelo se recusou a responder a este pedido.', 'refusal');
      }
      return text;
    } catch (error) {
      throw error instanceof AiProviderError ? error : toHttpError('Google', error);
    }
  },
};

export const AI_PROVIDERS: Record<AiProviderId, AiProvider> = { anthropic, openai, gemini };

export function isAiProviderId(value: string): value is AiProviderId {
  return value in AI_PROVIDERS;
}
