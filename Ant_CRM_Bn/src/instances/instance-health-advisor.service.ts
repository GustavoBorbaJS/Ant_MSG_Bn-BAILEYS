import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { HealthAssessment, HealthSignals } from './instance-health.rules';

export interface HealthAiDiagnosis {
  summary: string;
  risks: string[];
  recommendations: string[];
  model: string;
}

const SYSTEM_PROMPT = `Você é o analista de saúde de instâncias de WhatsApp de um CRM de disparo de mensagens em massa.

Você recebe um JSON com duas partes:
- "assessment": a nota (0-100), o veredito e as checagens já calculadas por regras fixas do sistema.
- "signals": os dados brutos que alimentaram essas regras (conexão, quedas, rate limit, entregas, aquecimento, dados da Meta quando o número é oficial).

Seu trabalho é explicar para o operador, em português do Brasil e em linguagem simples, o que esses dados significam para o risco de bloqueio do número e para a entrega das próximas campanhas, e o que ele deve fazer agora.

Regras:
- Baseie-se apenas nos dados recebidos. Não invente números, eventos nem causas que os dados não sustentam; quando a amostra for pequena demais para concluir algo, diga isso.
- Não contradiga o veredito das regras: você interpreta e prioriza, não recalcula a nota.
- "summary": 2 a 3 frases diretas com o estado atual.
- "risks": de 0 a 4 itens, do mais grave para o menos grave. Lista vazia se não houver risco real.
- "recommendations": de 1 a 4 ações concretas e executáveis neste sistema (por exemplo: reconectar a instância, esperar a pausa do provedor acabar, reduzir o volume diário, manter o aquecimento, revisar a lista de contatos, não usar o modo direto).

Contexto do sistema: instâncias novas passam por aquecimento (níveis cold, warm, hot) com limites de envio por minuto, hora e dia. "cooldown" é uma pausa automática aplicada quando o provedor (Meta/WhatsApp) responde com rate limit. O "modo direto" de disparo ignora o aquecimento e é o principal fator de risco de bloqueio.`;

const DIAGNOSIS_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    risks: { type: 'array', items: { type: 'string' } },
    recommendations: { type: 'array', items: { type: 'string' } },
  },
  required: ['summary', 'risks', 'recommendations'],
  additionalProperties: false,
};

// Camada OPCIONAL por cima das regras (instance-health.rules.ts): só existe
// se ANTHROPIC_API_KEY estiver configurada. As regras decidem nota e veredito;
// a IA só traduz os sinais em diagnóstico e próximos passos. Qualquer falha
// aqui (sem chave, timeout, recusa) devolve null e a tela mostra só as regras -
// a checagem de saúde nunca depende da IA estar no ar.
@Injectable()
export class InstanceHealthAdvisorService {
  private readonly logger = new Logger(InstanceHealthAdvisorService.name);
  private readonly client: Anthropic | null;
  private readonly model: string;

  constructor(configService: ConfigService) {
    const apiKey = configService.get<string>('healthAi.apiKey');
    this.model = configService.get<string>('healthAi.model');
    // timeout/retries curtos: isto roda dentro de uma requisição do painel
    this.client = apiKey ? new Anthropic({ apiKey, timeout: 45_000, maxRetries: 1 }) : null;
  }

  get enabled(): boolean {
    return this.client !== null;
  }

  async diagnose(signals: HealthSignals, assessment: HealthAssessment): Promise<HealthAiDiagnosis | null> {
    if (!this.client) return null;

    try {
      const response = await this.client.beta.messages.create({
        model: this.model,
        max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system: SYSTEM_PROMPT,
        output_config: { effort: 'low', format: { type: 'json_schema', schema: DIAGNOSIS_SCHEMA } },
        messages: [{ role: 'user', content: JSON.stringify({ assessment, signals }) }],
      });

      if (response.stop_reason !== 'end_turn') {
        this.logger.warn(`Diagnóstico por IA não concluído (stop_reason=${response.stop_reason})`);
        return null;
      }

      const text = response.content.find((block) => block.type === 'text');
      if (!text || text.type !== 'text') return null;

      return { ...(JSON.parse(text.text) as Omit<HealthAiDiagnosis, 'model'>), model: response.model };
    } catch (error) {
      if (error instanceof Anthropic.AuthenticationError) {
        this.logger.error('ANTHROPIC_API_KEY inválida - diagnóstico por IA indisponível');
      } else if (error instanceof Anthropic.RateLimitError) {
        this.logger.warn('Diagnóstico por IA indisponível: rate limit da API da Anthropic');
      } else if (error instanceof Anthropic.APIError) {
        this.logger.error(`Diagnóstico por IA falhou (${error.status}): ${error.message}`);
      } else {
        this.logger.error(`Diagnóstico por IA falhou: ${error.message}`);
      }
      return null;
    }
  }
}
