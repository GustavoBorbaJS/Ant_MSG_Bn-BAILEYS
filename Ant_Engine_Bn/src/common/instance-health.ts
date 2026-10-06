// Contrato de GET /instances/:instanceId/health - consumido pelo CRM
// (Ant_CRM_Bn/src/instance-health), que soma a isto os dados de fila/anti-ban
// e calcula a nota final. Aqui só entra o que o ENGINE enxerga: conexão com o
// provedor e o histórico recente de envios deste processo.
export interface InstanceHealthReport {
  instanceId: string;
  provider: 'baileys' | 'meta_cloud';
  status: string;
  checkedAt: string;
  // Consulta de verdade ao provedor feita agora (não o status em cache)
  probe: { ok: boolean; latencyMs?: number; error?: string };
  phoneNumber?: string;
  displayName?: string;
  session?: {
    connectedSince: string | null;
    disconnectsLast24h: number;
    lastDisconnect?: { at: string; statusCode?: number; reason: string };
  };
  sends: SendStats;
  // Só Meta Cloud API - campos do número na Graph API
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

export interface SendStats {
  // desde quando este processo conta (zera a cada restart do engine)
  since: string;
  ok: number;
  failed: number;
  rateLimited: number;
  lastError?: { at: string; message: string };
  lastRateLimitAt?: string;
}

const DAY_MS = 86_400_000;
const MAX_DISCONNECTS_KEPT = 50;

interface DisconnectEvent {
  at: number;
  statusCode?: number;
  reason: string;
}

interface Telemetry {
  since: number;
  ok: number;
  failed: number;
  rateLimited: number;
  lastError?: { at: number; message: string };
  lastRateLimitAt?: number;
  connectedSince: number | null;
  disconnects: DisconnectEvent[];
}

// Histórico em memória por instância, alimentado por quem envia/conecta
// (WhatsappService e MetaCloudService). Fica FORA do registro da conexão de
// propósito: o registro é recriado a cada reconexão, e o que interessa pra
// saúde é justamente o que aconteceu ao longo das reconexões.
export class InstanceTelemetry {
  private readonly byInstance = new Map<string, Telemetry>();

  private of(instanceId: string): Telemetry {
    let telemetry = this.byInstance.get(instanceId);
    if (!telemetry) {
      telemetry = { since: Date.now(), ok: 0, failed: 0, rateLimited: 0, connectedSince: null, disconnects: [] };
      this.byInstance.set(instanceId, telemetry);
    }
    return telemetry;
  }

  recordSendOk(instanceId: string): void {
    this.of(instanceId).ok += 1;
  }

  recordSendFailure(instanceId: string, message: string): void {
    const telemetry = this.of(instanceId);
    telemetry.failed += 1;
    telemetry.lastError = { at: Date.now(), message };
  }

  recordRateLimit(instanceId: string, message: string): void {
    const telemetry = this.of(instanceId);
    telemetry.rateLimited += 1;
    telemetry.lastRateLimitAt = Date.now();
    telemetry.lastError = { at: Date.now(), message };
  }

  recordConnected(instanceId: string): void {
    this.of(instanceId).connectedSince = Date.now();
  }

  recordDisconnected(instanceId: string, reason: string, statusCode?: number): void {
    const telemetry = this.of(instanceId);
    telemetry.connectedSince = null;
    telemetry.disconnects.push({ at: Date.now(), statusCode, reason });
    if (telemetry.disconnects.length > MAX_DISCONNECTS_KEPT) {
      telemetry.disconnects.shift();
    }
  }

  forget(instanceId: string): void {
    this.byInstance.delete(instanceId);
  }

  sendStats(instanceId: string): SendStats {
    const telemetry = this.of(instanceId);
    return {
      since: new Date(telemetry.since).toISOString(),
      ok: telemetry.ok,
      failed: telemetry.failed,
      rateLimited: telemetry.rateLimited,
      lastError: telemetry.lastError && {
        at: new Date(telemetry.lastError.at).toISOString(),
        message: telemetry.lastError.message,
      },
      lastRateLimitAt: telemetry.lastRateLimitAt ? new Date(telemetry.lastRateLimitAt).toISOString() : undefined,
    };
  }

  session(instanceId: string): NonNullable<InstanceHealthReport['session']> {
    const telemetry = this.of(instanceId);
    const last = telemetry.disconnects[telemetry.disconnects.length - 1];
    return {
      connectedSince: telemetry.connectedSince ? new Date(telemetry.connectedSince).toISOString() : null,
      disconnectsLast24h: telemetry.disconnects.filter((d) => Date.now() - d.at < DAY_MS).length,
      lastDisconnect: last && { at: new Date(last.at).toISOString(), statusCode: last.statusCode, reason: last.reason },
    };
  }
}
