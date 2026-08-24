import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { InvalidRecipientError } from '../whatsapp/errors';

interface MetaInstanceConfig {
  phoneNumberId: string;
  accessToken: string;
}

@Injectable()
export class MetaCloudService {
  private readonly logger = new Logger(MetaCloudService.name);
  private readonly instances = new Map<string, MetaInstanceConfig>();
  private readonly apiVersion: string;
  // ver comentario equivalente em Ant_Engine_Bn/src/whatsapp/whatsapp.service.ts
  private readonly recentSends = new Map<string, Promise<{ messageId: string }>>();
  private static readonly SEND_DEDUP_TTL_MS = 2 * 60_000;

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

    const url = `https://graph.facebook.com/${this.apiVersion}/${config.phoneNumberId}/messages`;

    // A Meta Cloud API tambem so precisa da URL - ela baixa a imagem sozinha
    // (precisa ser publicamente acessivel, nao so na rede interna do docker)
    const payload = imageUrl
      ? { messaging_product: 'whatsapp', to: this.toE164(to), type: 'image', image: { link: imageUrl, caption: text } }
      : { messaging_product: 'whatsapp', to: this.toE164(to), type: 'text', text: { body: text } };

    const sendPromise = axios
      .post(url, payload, {
        headers: {
          Authorization: `Bearer ${config.accessToken}`,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      })
      .then((response) => ({ messageId: response.data?.messages?.[0]?.id }))
      .catch((err) => {
        const status = err.response?.status;
        const metaError = err.response?.data?.error?.message;
        this.logger.error(`Falha ao enviar via Meta Cloud API (${instanceId}): ${metaError || err.message}`);

        // 400/404/410 da Graph API tipicamente significam parametro/numero
        // invalido (permanente, nao adianta retentar) - 429/5xx sao rate
        // limit/instabilidade do lado da Meta (transitorio).
        if (status && [400, 404, 410].includes(status)) {
          throw new InvalidRecipientError(metaError || err.message);
        }
        throw new Error(metaError || err.message);
      });

    if (idempotencyKey) {
      this.recentSends.set(idempotencyKey, sendPromise);
      sendPromise.catch(() => undefined).finally(() => {
        setTimeout(() => this.recentSends.delete(idempotencyKey), MetaCloudService.SEND_DEDUP_TTL_MS).unref();
      });
    }

    return sendPromise;
  }

  async getStatus(instanceId: string): Promise<{ status: 'connected' | 'disconnected' }> {
    const config = this.instances.get(instanceId);
    if (!config) {
      return { status: 'disconnected' };
    }

    try {
      await axios.get(`https://graph.facebook.com/${this.apiVersion}/${config.phoneNumberId}`, {
        headers: { Authorization: `Bearer ${config.accessToken}` },
        params: { fields: 'id' },
        timeout: 10000,
      });
      return { status: 'connected' };
    } catch (err) {
      const metaError = err.response?.data?.error?.message;
      this.logger.warn(`Instância Meta ${instanceId} não respondeu OK: ${metaError || err.message}`);
      return { status: 'disconnected' };
    }
  }

  private toE164(to: string): string {
    return to.replace(/\D/g, '');
  }
}
