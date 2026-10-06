import { Injectable, Logger } from '@nestjs/common';
import { AiService } from '../ai/ai.service';
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

Contexto do sistema: instâncias novas passam por aquecimento (níveis cold, warm, hot) com limites de envio por minuto, hora e dia. "cooldown" é uma pausa automática aplicada quando o provedor (Meta/WhatsApp) responde com rate limit. O "modo direto" de disparo ignora o aquecimento e é o principal fator de risco de bloqueio.

Formato da resposta: somente um objeto JSON, sem texto antes ou depois e sem bloco de código, com exatamente estas chaves:
- "summary": string com 2 a 3 frases diretas sobre o estado atual.
- "risks": lista de 0 a 4 strings, do risco mais grave para o menos grave. Lista vazia se não houver risco real.
- "recommendations": lista de 1 a 4 strings, cada uma uma ação concreta e executável neste sistema (por exemplo: reconectar a instância, esperar a pausa do provedor acabar, reduzir o volume diário, manter o aquecimento, revisar a lista de contatos, não usar o modo direto).`;

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

// A resposta vem de provedores diferentes (ver ai/ai-providers.ts) e nem
// todos garantem JSON puro - alguns embrulham em bloco de código ou soltam
// uma frase antes. Pega o primeiro objeto do texto e confere o formato;
// qualquer coisa fora do esperado vira null (tela mostra só as regras).
function parseDiagnosis(text: string): Omit<HealthAiDiagnosis, 'model'> | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;

  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    if (typeof parsed.summary !== 'string' || !isStringArray(parsed.risks) || !isStringArray(parsed.recommendations)) {
      return null;
    }
    return { summary: parsed.summary, risks: parsed.risks, recommendations: parsed.recommendations };
  } catch {
    return null;
  }
}

// Camada OPCIONAL por cima das regras (instance-health.rules.ts): usa a IA
// que o usuário configurou no menu "IA" (ver AiService). As regras decidem
// nota e veredito; a IA só traduz os sinais em diagnóstico e próximos
// passos. Qualquer falha aqui (sem IA configurada, chave inválida, timeout,
// resposta fora do formato) devolve null e a tela mostra só as regras - a
// checagem de saúde nunca depende da IA estar no ar.
@Injectable()
export class InstanceHealthAdvisorService {
  private readonly logger = new Logger(InstanceHealthAdvisorService.name);

  constructor(private readonly aiService: AiService) {}

  isEnabledFor(userId: string): Promise<boolean> {
    return this.aiService.isConfigured(userId);
  }

  async diagnose(userId: string, signals: HealthSignals, assessment: HealthAssessment): Promise<HealthAiDiagnosis | null> {
    if (!(await this.aiService.isConfigured(userId))) return null;

    try {
      const { text, model } = await this.aiService.complete(userId, SYSTEM_PROMPT, JSON.stringify({ assessment, signals }));
      const diagnosis = parseDiagnosis(text);
      if (!diagnosis) {
        this.logger.warn(`Diagnóstico por IA fora do formato esperado (modelo ${model})`);
        return null;
      }
      return { ...diagnosis, model };
    } catch (error) {
      this.logger.warn(`Diagnóstico por IA indisponível: ${error.message}`);
      return null;
    }
  }
}
