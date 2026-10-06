import Anthropic from '@anthropic-ai/sdk';
import axios from 'axios';

// Provedores de IA que o usuário pode escolher no menu "IA". Cada um sabe
// duas coisas: listar os modelos que a chave enxerga e completar um texto.
// Provedor novo = mais um item em AI_PROVIDERS implementando AiProvider; o
// resto do sistema (AiService, saúde da instância, campanhas) não muda.

export type AiProviderId = 'anthropic' | 'openai' | 'gemini' | 'deepseek' | 'zai';

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

// ------------------------------------------- Provedores por REST (sem SDK)

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

interface OpenAiCompatibleOptions {
  id: AiProviderId;
  label: string;
  keyUrl: string;
  keyPlaceholder: string;
  // Um ou mais endereços que falam o protocolo da OpenAI. Mais de um quando o
  // provedor separa as chaves por plano em endereços diferentes: tenta na
  // ordem e fica com o primeiro que aceitar a chave.
  baseUrls: string[];
  // tira da lista o que não conversa por texto (áudio, imagem, embeddings...)
  excludeModels?: RegExp;
  // usada quando o provedor não tem (ou a chave não alcança) a rota de
  // listagem de modelos
  fallbackModels?: string[];
}

// Falha que vale tentar no próximo endereço: a chave pode ser do outro plano
// (o provedor responde 401, 403 ou "sem saldo/pacote" com 4xx). Erro de rede
// ou 5xx é instabilidade, e o outro endereço cairia igual.
function isWrongEndpointError(error: any): boolean {
  const status: number | undefined = error.response?.status;
  return status !== undefined && status >= 400 && status < 500;
}

// Provedor que expõe a API no formato da OpenAI (/models e
// /chat/completions com Bearer). OpenAI, DeepSeek e Z.ai (GLM) entram aqui -
// mudam o endereço, o nome e pequenos detalhes de listagem.
function openAiCompatible(options: OpenAiCompatibleOptions): AiProvider {
  const { id, label, keyUrl, keyPlaceholder, baseUrls, excludeModels, fallbackModels } = options;

  // Chama cada endereço na ordem; devolve o primeiro que der certo. Se todos
  // falharem, o erro mostrado é o do PRIMEIRO (o endereço principal).
  async function onFirstWorkingBase<T>(call: (baseUrl: string) => Promise<T>): Promise<T> {
    let firstError: unknown;
    for (const baseUrl of baseUrls) {
      try {
        return await call(baseUrl);
      } catch (error) {
        firstError ??= error;
        if (!isWrongEndpointError(error)) break;
      }
    }
    throw firstError;
  }

  return {
    id,
    label,
    keyUrl,
    keyPlaceholder,
    defaultModel: null,

    async listModels(apiKey) {
      try {
        const data = await onFirstWorkingBase(
          async (baseUrl) =>
            (await axios.get(`${baseUrl}/models`, { headers: { Authorization: `Bearer ${apiKey}` }, timeout: REQUEST_TIMEOUT_MS }))
              .data,
        );
        return (data.data as { id: string; name?: string }[])
          .filter((model) => !excludeModels?.test(model.id))
          .map((model) => ({ id: model.id, label: model.name || model.id }))
          .sort((a, b) => a.id.localeCompare(b.id));
      } catch (error) {
        const status: number | undefined = (error as any).response?.status;
        // chave recusada continua sendo erro; só a AUSÊNCIA da rota de
        // listagem cai na lista fixa
        if (fallbackModels && status !== 401 && status !== 403) {
          return fallbackModels.map((model) => ({ id: model, label: model }));
        }
        throw toHttpError(label, error);
      }
    },

    async complete({ apiKey, model, system, user }) {
      try {
        const data = await onFirstWorkingBase(
          async (baseUrl) =>
            (
              await axios.post(
                `${baseUrl}/chat/completions`,
                {
                  model,
                  messages: [
                    { role: 'system', content: system },
                    { role: 'user', content: user },
                  ],
                },
                { headers: { Authorization: `Bearer ${apiKey}` }, timeout: REQUEST_TIMEOUT_MS },
              )
            ).data,
        );
        return String(data.choices?.[0]?.message?.content ?? '').trim();
      } catch (error) {
        throw toHttpError(label, error);
      }
    },
  };
}

const openai = openAiCompatible({
  id: 'openai',
  label: 'OpenAI (ChatGPT)',
  keyUrl: 'https://platform.openai.com/api-keys',
  keyPlaceholder: 'sk-...',
  baseUrls: ['https://api.openai.com/v1'],
  // /v1/models da OpenAI devolve tudo que a conta acessa
  excludeModels: /embedding|whisper|tts|dall-e|image|audio|realtime|moderation|transcribe|search|instruct|davinci|babbage|sora|codex/i,
});

const deepseek = openAiCompatible({
  id: 'deepseek',
  label: 'DeepSeek',
  keyUrl: 'https://platform.deepseek.com/api_keys',
  keyPlaceholder: 'sk-...',
  baseUrls: ['https://api.deepseek.com'],
});

// A Z.ai tem dois endereços e a chave só funciona no do plano dela: o geral
// (pago por uso) e o do GLM Coding Plan (assinatura). A documentação dela não
// traz rota de listagem de modelos, então a lista abaixo (página de preços da
// Z.ai) entra quando /models não responde - e a tela ainda deixa digitar
// outro nome de modelo, pra não depender desta lista estar em dia.
const zai = openAiCompatible({
  id: 'zai',
  label: 'Z.ai (GLM)',
  keyUrl: 'https://z.ai/manage-apikey/apikey-list',
  keyPlaceholder: 'chave da Z.ai',
  baseUrls: ['https://api.z.ai/api/paas/v4', 'https://api.z.ai/api/coding/paas/v4'],
  fallbackModels: [
    'glm-5.3',
    'glm-5.3-flash',
    'glm-5.3-flashx',
    'glm-5.2',
    'glm-5.1',
    'glm-5',
    'glm-4.7',
    'glm-4.7-flash',
    'glm-4.7-flashx',
    'glm-4.6',
    'glm-4.5',
    'glm-4.5-air',
    'glm-4.5-flash',
  ],
});

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

export const AI_PROVIDERS: Record<AiProviderId, AiProvider> = { anthropic, openai, gemini, deepseek, zai };

export function isAiProviderId(value: string): value is AiProviderId {
  return value in AI_PROVIDERS;
}
