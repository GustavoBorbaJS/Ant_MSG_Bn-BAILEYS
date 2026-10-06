// Regras de saúde da instância: função pura (sem I/O) que transforma os sinais
// coletados pelo InstanceHealthService em nota + lista de checagens. Fica
// separada de propósito - é aqui que se ajusta limiar/peso, e dá pra testar
// sem subir engine, Redis ou banco.

export type CheckStatus = 'ok' | 'warn' | 'fail';
export type HealthVerdict = 'healthy' | 'attention' | 'critical';

export interface HealthCheck {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
}

// Espelho do contrato de Ant_Engine_Bn/src/common/instance-health.ts
export interface EngineHealthReport {
  instanceId: string;
  provider: 'baileys' | 'meta_cloud';
  status: string;
  checkedAt: string;
  probe: { ok: boolean; latencyMs?: number; error?: string };
  phoneNumber?: string;
  displayName?: string;
  session?: {
    connectedSince: string | null;
    disconnectsLast24h: number;
    lastDisconnect?: { at: string; statusCode?: number; reason: string };
  };
  sends: {
    since: string;
    ok: number;
    failed: number;
    rateLimited: number;
    lastError?: { at: string; message: string };
    lastRateLimitAt?: string;
  };
  meta?: {
    qualityRating?: string;
    messagingLimitTier?: string;
    nameStatus?: string;
    codeVerificationStatus?: string;
    accountStatus?: string;
    throughputLevel?: string;
    canSendMessage?: string;
    issues: string[];
  };
}

export interface HealthSignals {
  // null = engine inalcançável (nem deu pra perguntar)
  engine: EngineHealthReport | null;
  engineError?: string;
  warmup: {
    level: 'cold' | 'warm' | 'hot';
    ageDays: number | null;
    limits: { perMinute: number; perHour: number; perDay: number };
    used: { minute: number; hour: number; day: number };
  };
  pacing: { cooldownRemainingMs: number; rateLimitStrikes: number };
  delivery24h: { sent: number; failed: number; pending: number };
}

export interface HealthAssessment {
  score: number;
  verdict: HealthVerdict;
  checks: HealthCheck[];
}

const SLOW_PROBE_MS = 3000;
// abaixo disso a taxa de falha não diz nada (1 falha em 2 envios = 50%)
const MIN_DELIVERY_SAMPLE = 10;

interface Rule {
  id: string;
  label: string;
  evaluate(signals: HealthSignals): { status: CheckStatus; detail: string; penalty: number } | null;
}

const RULES: Rule[] = [
  {
    id: 'connection',
    label: 'Conexão com o WhatsApp',
    evaluate({ engine, engineError }) {
      if (!engine) {
        return { status: 'fail', detail: `Engine não respondeu: ${engineError ?? 'erro desconhecido'}`, penalty: 60 };
      }
      if (engine.status !== 'connected') {
        return { status: 'fail', detail: `Instância não está conectada (status: ${engine.status})`, penalty: 60 };
      }
      if (!engine.probe.ok) {
        return {
          status: 'fail',
          detail: `Consta conectada, mas não respondeu ao teste: ${engine.probe.error ?? 'sem resposta'}`,
          penalty: 50,
        };
      }
      if ((engine.probe.latencyMs ?? 0) > SLOW_PROBE_MS) {
        return { status: 'warn', detail: `Respondeu ao teste, mas devagar (${engine.probe.latencyMs}ms)`, penalty: 10 };
      }
      return { status: 'ok', detail: `Conectada e respondendo (${engine.probe.latencyMs}ms)`, penalty: 0 };
    },
  },
  {
    id: 'stability',
    label: 'Estabilidade da sessão',
    evaluate({ engine }) {
      if (!engine?.session) return null;
      const { disconnectsLast24h, lastDisconnect } = engine.session;
      const last = lastDisconnect ? ` - última: ${lastDisconnect.reason}` : '';
      if (disconnectsLast24h >= 5) {
        return { status: 'fail', detail: `${disconnectsLast24h} quedas nas últimas 24h${last}`, penalty: 25 };
      }
      if (disconnectsLast24h >= 2) {
        return { status: 'warn', detail: `${disconnectsLast24h} quedas nas últimas 24h${last}`, penalty: 10 };
      }
      return { status: 'ok', detail: disconnectsLast24h === 0 ? 'Nenhuma queda nas últimas 24h' : `1 queda nas últimas 24h${last}`, penalty: 0 };
    },
  },
  {
    id: 'provider_rate_limit',
    label: 'Rate limit do provedor',
    evaluate({ engine, pacing }) {
      if (pacing.cooldownRemainingMs > 0) {
        const minutes = Math.ceil(pacing.cooldownRemainingMs / 60_000);
        return {
          status: 'fail',
          detail: `Envios pausados por ~${minutes}min: o provedor limitou o ritmo desta instância`,
          penalty: 30,
        };
      }
      const recent = pacing.rateLimitStrikes;
      const sinceStart = engine?.sends.rateLimited ?? 0;
      if (recent > 0 || sinceStart > 0) {
        return {
          status: 'warn',
          detail: `O provedor limitou o ritmo ${Math.max(recent, sinceStart)} vez(es) recentemente`,
          penalty: 15,
        };
      }
      return { status: 'ok', detail: 'Nenhum rate limit do provedor registrado', penalty: 0 };
    },
  },
  {
    id: 'delivery',
    label: 'Entrega nas últimas 24h',
    evaluate({ delivery24h }) {
      const finished = delivery24h.sent + delivery24h.failed;
      if (finished < MIN_DELIVERY_SAMPLE) {
        return { status: 'ok', detail: `Poucos envios pra avaliar (${finished} concluídos)`, penalty: 0 };
      }
      const failureRate = delivery24h.failed / finished;
      const detail = `${delivery24h.failed} falhas em ${finished} envios (${Math.round(failureRate * 100)}%)`;
      if (failureRate >= 0.3) return { status: 'fail', detail, penalty: 25 };
      if (failureRate >= 0.1) return { status: 'warn', detail, penalty: 10 };
      return { status: 'ok', detail, penalty: 0 };
    },
  },
  {
    id: 'warmup',
    label: 'Aquecimento e cota',
    evaluate({ warmup }) {
      const usedShare = warmup.used.day / warmup.limits.perDay;
      const detail = `Nível ${warmup.level}, ${warmup.used.day}/${warmup.limits.perDay} envios hoje`;
      if (usedShare >= 0.9) {
        return { status: 'warn', detail: `${detail} - cota diária quase no fim`, penalty: 5 };
      }
      return { status: 'ok', detail, penalty: 0 };
    },
  },
  {
    id: 'meta_quality',
    label: 'Qualidade do número (Meta)',
    evaluate({ engine }) {
      const meta = engine?.meta;
      if (!meta) return null;
      const tier = meta.messagingLimitTier ? `, tier ${meta.messagingLimitTier}` : '';
      if (meta.canSendMessage === 'BLOCKED') {
        return { status: 'fail', detail: `A Meta bloqueou o envio: ${meta.issues.join('; ') || 'sem detalhe'}`, penalty: 50 };
      }
      if (meta.qualityRating === 'RED') {
        return { status: 'fail', detail: `Qualidade BAIXA (vermelha)${tier} - risco de restrição`, penalty: 40 };
      }
      if (meta.canSendMessage === 'LIMITED') {
        return { status: 'warn', detail: `Envio limitado pela Meta: ${meta.issues.join('; ') || 'sem detalhe'}`, penalty: 15 };
      }
      if (meta.qualityRating === 'YELLOW') {
        return { status: 'warn', detail: `Qualidade MÉDIA (amarela)${tier}`, penalty: 15 };
      }
      return { status: 'ok', detail: `Qualidade ${meta.qualityRating ?? 'não informada'}${tier}`, penalty: 0 };
    },
  },
];

export function assessInstanceHealth(signals: HealthSignals): HealthAssessment {
  const checks: HealthCheck[] = [];
  let score = 100;

  for (const rule of RULES) {
    const result = rule.evaluate(signals);
    if (!result) continue;
    checks.push({ id: rule.id, label: rule.label, status: result.status, detail: result.detail });
    score -= result.penalty;
  }

  score = Math.max(0, score);
  const connectionFailed = checks.some((check) => check.id === 'connection' && check.status === 'fail');

  let verdict: HealthVerdict = 'healthy';
  if (connectionFailed || score < 50) verdict = 'critical';
  else if (score < 80) verdict = 'attention';

  return { score, verdict, checks };
}
