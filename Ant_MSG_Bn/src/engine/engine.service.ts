import { Injectable, Logger, HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';

@Injectable()
export class EngineService {
  private readonly logger = new Logger(EngineService.name);
  private readonly axios: AxiosInstance;

  constructor(private configService: ConfigService) {
    const apiKey = this.configService.get<string>('engine.apiKey');
    if (!apiKey) {
      throw new Error('ENGINE_API_KEY não definida. Precisa ser igual à do engine (Ant_Engine_Bn/.env).');
    }

    this.axios = axios.create({
      baseURL: this.configService.get('engine.apiUrl'),
      timeout: 30000,
      headers: { Authorization: `Bearer ${apiKey}` },
    });
  }

  // messageId (messageLogId do CRM) vai como chave de idempotencia - se esse
  // axios estourar o timeout (30s) mas a chamada anterior ainda estiver em
  // voo no engine, o BullMQ retenta e chega aqui de novo com o MESMO
  // messageId, permitindo o engine reaproveitar o envio em vez de duplicar.
  async sendRaw(
    instanceId: string,
    to: string,
    text: string,
    imageUrl?: string,
    messageId?: string,
    documentFileName?: string,
  ): Promise<any> {
    this.logger.debug(`Sending message from instance ${instanceId} to ${to}`);

    try {
      const response = await this.axios.post('/send', {
        instanceId,
        to,
        text,
        imageUrl,
        messageId,
        documentFileName,
      });

      if (response.status !== 200) {
        throw new Error(`Engine returned status ${response.status}`);
      }

      this.logger.debug(`Message sent successfully from ${instanceId}`);
      return response.data;
    } catch (error) {
      this.logger.error(`Failed to send message: ${error.message}`);

      // Repassa o corpo inteiro do erro do engine (não só a mensagem) - o 429
      // dele carrega retryAfterMs, que o consumer usa pra pausar a instância
      // (ver Ant_Engine_Bn/src/whatsapp/whatsapp.controller.ts).
      if (error.response) {
        const body = error.response.data;
        throw new HttpException(
          body && typeof body === 'object' ? { message: 'Engine error', ...body } : body || 'Engine error',
          error.response.status,
        );
      }

      throw error;
    }
  }

  async reconnectInstance(instanceId: string): Promise<any> {
    this.logger.warn(`Attempting to reconnect instance ${instanceId}`);
    
    try {
      const response = await this.axios.post('/reconnect', { instanceId });
      this.logger.log(`Instance ${instanceId} reconnected successfully`);
      return response.data;
    } catch (error) {
      this.logger.error(`Failed to reconnect instance ${instanceId}: ${error.message}`);
      throw error;
    }
  }

  async getInstanceStatus(instanceId: string): Promise<string> {
    try {
      const response = await this.axios.get(`/status/${instanceId}`);
      return response.data.status; // 'connected', 'disconnected', 'qr_code'
    } catch (error) {
      this.logger.error(`Failed to get instance status: ${error.message}`);
      return 'unknown';
    }
  }
}