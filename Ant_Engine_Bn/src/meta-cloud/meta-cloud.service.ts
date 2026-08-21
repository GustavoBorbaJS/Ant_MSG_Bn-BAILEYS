import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

interface MetaInstanceConfig {
  phoneNumberId: string;
  accessToken: string;
}

@Injectable()
export class MetaCloudService {
  private readonly logger = new Logger(MetaCloudService.name);
  private readonly instances = new Map<string, MetaInstanceConfig>();
  private readonly apiVersion: string;

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

  async sendMessage(instanceId: string, to: string, text: string, imageUrl?: string): Promise<{ messageId: string }> {
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

    try {
      const response = await axios.post(
        url,
        payload,
        {
          headers: {
            Authorization: `Bearer ${config.accessToken}`,
            'Content-Type': 'application/json',
          },
          timeout: 30000,
        },
      );

      return { messageId: response.data?.messages?.[0]?.id };
    } catch (err) {
      const metaError = err.response?.data?.error?.message;
      this.logger.error(`Falha ao enviar via Meta Cloud API (${instanceId}): ${metaError || err.message}`);
      throw new Error(metaError || err.message);
    }
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
