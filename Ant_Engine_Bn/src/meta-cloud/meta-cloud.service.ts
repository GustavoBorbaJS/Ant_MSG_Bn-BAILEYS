import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { InstanceNotConnectedError, InvalidRecipientError, ProviderRateLimitError } from '../whatsapp/errors';
import { InstanceHealthReport, InstanceTelemetry } from '../common/instance-health';

interface MetaInstanceConfig {
  phoneNumberId: string;
  accessToken: string;
}

type MetaStatus = { status: 'connected' | 'disconnected' };

// Códigos de erro da Graph API (campo error.code) que significam "devagar":
// 4 = limite do app, 80007 = limite da conta WABA, 130429 = throughput da
// Cloud API, 131048 = limite por suspeita de spam, 131056 = muitas mensagens
// pro mesmo par remetente/destinatário.
const RATE_LIMIT_CODES = new Set([4, 80007, 130429, 131048, 131056]);

// Códigos que dizem que o problema é a CONTA/token, não o destinatário:
// 190 = token expirado/inválido, 10 e 200 = permissão, 368 = bloqueio
// temporário por violação de política, 131031 = conta bloqueada,
// 131042 = problema de pagamento, 131045/133010 = número não registrado.
const ACCOUNT_ERROR_CODES = new Set([190, 10, 200, 368, 131031, 131042, 131045, 133010]);

const HEALTH_FIELDS = [
  'display_phone_number',
  'verified_name',
  'quality_rating',
  'messaging_limit_tier',
  'name_status',
  'code_verification_status',
  'status',
  'throughput',
  'health_status',
].join(',');

@Injectable()
export class MetaCloudService {
  private readonly logger = new Logger(MetaCloudService.name);
  private readonly instances = new Map<string, MetaInstanceConfig>();
  private readonly apiVersion: string;
  private readonly telemetry = new InstanceTelemetry();
  // ver comentario equivalente em Ant_Engine_Bn/src/whatsapp/whatsapp.service.ts
  private readonly recentSends = new Map<string, Promise<{ messageId: string }>>();
  private static readonly SEND_DEDUP_TTL_MS = 2 * 60_000;
  // O worker consulta /status ANTES de cada mensagem (ver waitForInstance em
  // Ant_MSG_Bn/src/queue/queue.consumer.ts). Sem cache, cada mensagem custava
  // DUAS chamadas à Graph API (status + envio), dobrando o consumo do rate
  // limit da Meta só pra confirmar o que já se sabia há 2 segundos.
  private readonly statusCache = new Map<string, { value: MetaStatus; expiresAt: number }>();
  private static readonly STATUS_CACHE_TTL_MS = 30_000;

  constructor(private configService: ConfigService) {
    this.apiVersion = this.configService.get<string>('metaCloud.apiVersion');
    this.loadInstances();
  }

  private loadInstances() {
    const raw = this.configService.get<string>('metaCloud.instancesJson');
    if (!raw) return;

    try {
      const parsed = JSON.parse(raw) as Record<string, MetaInstanceConfig>;
      for (const [instanceId, cfg] of Object.entries(parsed)) {
        this.instances.set(instanceId, cfg);
      }
      this.logger.log(`${this.instances.size} instância(s) da Meta Cloud API carregada(s)`);
    } catch (err) {
      this.logger.error(`META_INSTANCES inválido (JSON malformado): ${err.message}`);
    }
  }

  hasInstance(instanceId: string): boolean {
    return this.instances.has(instanceId);
  }

  async sendMessage(
    instanceId: string,
    to: string,
    text: string,
    imageUrl?: string,
    idempotencyKey?: string,
    documentFileName?: string,
  ): Promise<{ messageId: string }> {
    if (idempotencyKey) {
      const existing = this.recentSends.get(idempotencyKey);
      if (existing) {
        this.logger.warn(`Envio duplicado detectado (messageId=${idempotencyKey}) - reaproveitando chamada em andamento/recente`);
        return existing;
      }
    }

    const config = this.instances.get(instanceId);
    if (!config) {
      throw new Error(`Instance ${instanceId} não está registrada como instância Meta Cloud API`);
    }

    const sendPromise = this.postMessage(instanceId, config, this.buildPayload(to, text, imageUrl, documentFileName));

    if (idempotencyKey) {
      this.recentSends.set(idempotencyKey, sendPromise);
      sendPromise.catch(() => undefined).finally(() => {
        setTimeout(() => this.recentSends.delete(idempotencyKey), MetaCloudService.SEND_DEDUP_TTL_MS).unref();
      });
    }

    return sendPromise;
  }

  // A Meta Cloud API so precisa da URL - ela baixa o arquivo sozinha (precisa
  // ser publicamente acessivel, nao so na rede interna do docker).
  // documentFileName presente = PDF (manda como "document"), senão imageUrl
  // presente = imagem, senão texto puro.
  private buildPayload(to: string, text: string, imageUrl?: string, documentFileName?: string) {
    const base = { messaging_product: 'whatsapp', to: this.toE164(to) };

    if (documentFileName) {
      return { ...base, type: 'document', document: { link: imageUrl, filename: documentFileName, caption: text } };
    }
    if (imageUrl) {
      return { ...base, type: 'image', image: { link: imageUrl, caption: text } };
    }
    return { ...base, type: 'text', text: { body: text } };
  }

  private async postMessage(
    instanceId: string,
    config: MetaInstanceConfig,
    payload: object,
  ): Promise<{ messageId: string }> {
    try {
      const response = await axios.post(
        `https://graph.facebook.com/${this.apiVersion}/${config.phoneNumberId}/messages`,
        payload,
        {
          headers: { Authorization: `Bearer ${config.accessToken}`, 'Content-Type': 'application/json' },
          timeout: 30000,
        },
      );
      this.telemetry.recordSendOk(instanceId);
      return { messageId: response.data?.messages?.[0]?.id };
    } catch (err) {
      throw this.toSendError(instanceId, err);
    }
  }

  // Traduz o erro da Graph API pro erro tipado que o /send converte em status
  // HTTP (ver whatsapp.controller.ts). A ordem importa: o código do erro
  // (error.code) é mais confiável que o status HTTP - a Meta devolve rate
  // limit e bloqueio de conta com status variados.
  private toSendError(instanceId: string, err: any): Error {
    const httpStatus: number | undefined = err.response?.status;
    const metaError = err.response?.data?.error;
    const code = Number(metaError?.code);
    const message = metaError?.message || err.message;
    const detail = Number.isFinite(code) ? `${message} (código ${code})` : message;

    this.logger.error(`Falha ao enviar via Meta Cloud API (${instanceId}): ${detail}`);

    if (RATE_LIMIT_CODES.has(code) || httpStatus === 429) {
      this.telemetry.recordRateLimit(instanceId, detail);
      const retryAfterSeconds = Number(err.response?.headers?.['retry-after']);
      return new ProviderRateLimitError(detail, retryAfterSeconds > 0 ? retryAfterSeconds * 1000 : undefined);
    }

    this.telemetry.recordSendFailure(instanceId, detail);

    if (ACCOUNT_ERROR_CODES.has(code) || httpStatus === 401 || httpStatus === 403) {
      this.statusCache.delete(instanceId);
      return new InstanceNotConnectedError(detail);
    }

    // 400/404/410 restantes tipicamente significam parametro/numero invalido
    // (permanente, nao adianta retentar) - 5xx e rede sao instabilidade do
    // lado da Meta (transitorio).
    if (httpStatus && [400, 404, 410].includes(httpStatus)) {
      return new InvalidRecipientError(detail);
    }
    return new Error(detail);
  }

  async getStatus(instanceId: string): Promise<MetaStatus> {
    const cached = this.statusCache.get(instanceId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    const value = await this.fetchStatus(instanceId);
    this.statusCache.set(instanceId, { value, expiresAt: Date.now() + MetaCloudService.STATUS_CACHE_TTL_MS });
    return value;
  }

  private async fetchStatus(instanceId: string): Promise<MetaStatus> {
    const config = this.instances.get(instanceId);
    if (!config) {
      return { status: 'disconnected' };
    }

    try {
      await this.getPhoneNumber(config, 'id', 10000);
      return { status: 'connected' };
    } catch (err) {
      const metaError = err.response?.data?.error?.message;
      this.logger.warn(`Instância Meta ${instanceId} não respondeu OK: ${metaError || err.message}`);
      return { status: 'disconnected' };
    }
  }

  private getPhoneNumber(config: MetaInstanceConfig, fields: string, timeout: number) {
    return axios.get(`https://graph.facebook.com/${this.apiVersion}/${config.phoneNumberId}`, {
      headers: { Authorization: `Bearer ${config.accessToken}` },
      params: { fields },
      timeout,
    });
  }

  // Checagem de saúde sob demanda (não passa pelo cache de status): pergunta à
  // Graph API a nota de qualidade, o tier de envio e se o número pode enviar.
  async getHealth(instanceId: string): Promise<InstanceHealthReport> {
    const config = this.instances.get(instanceId);
    const report: InstanceHealthReport = {
      instanceId,
      provider: 'meta_cloud',
      status: 'disconnected',
      checkedAt: new Date().toISOString(),
      probe: { ok: false },
      sends: this.telemetry.sendStats(instanceId),
    };
    if (!config) {
      report.probe.error = 'Instância não registrada em META_INSTANCES';
      return report;
    }

    const startedAt = Date.now();
    try {
      const { data } = await this.getPhoneNumber(config, HEALTH_FIELDS, 15000);
      report.status = 'connected';
      report.probe = { ok: true, latencyMs: Date.now() - startedAt };
      report.phoneNumber = data.display_phone_number;
      report.displayName = data.verified_name;
      report.meta = {
        qualityRating: data.quality_rating,
        messagingLimitTier: data.messaging_limit_tier,
        nameStatus: data.name_status,
        codeVerificationStatus: data.code_verification_status,
        accountStatus: data.status,
        throughputLevel: data.throughput?.level,
        canSendMessage: data.health_status?.can_send_message,
        issues: this.collectHealthIssues(data.health_status),
      };
    } catch (err) {
      const metaError = err.response?.data?.error;
      report.probe = {
        ok: false,
        latencyMs: Date.now() - startedAt,
        error: metaError ? `${metaError.message} (código ${metaError.code})` : err.message,
      };
    }

    this.statusCache.set(instanceId, {
      value: { status: report.status as MetaStatus['status'] },
      expiresAt: Date.now() + MetaCloudService.STATUS_CACHE_TTL_MS,
    });
    return report;
  }

  // health_status.entities lista cada nível (número, WABA, business, app) com
  // os erros que impedem ou limitam o envio - achata em frases legíveis.
  private collectHealthIssues(healthStatus: any): string[] {
    const issues: string[] = [];
    for (const entity of healthStatus?.entities ?? []) {
      for (const error of entity.errors ?? []) {
        issues.push(`${entity.entity_type}: ${error.error_description}${error.possible_solution ? ` - ${error.possible_solution}` : ''}`);
      }
    }
    return issues;
  }

  private toE164(to: string): string {
    return to.replace(/\D/g, '');
  }
}
