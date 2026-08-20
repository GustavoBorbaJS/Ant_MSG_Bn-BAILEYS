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

  async sendRaw(instanceId: string, to: string, text: string): Promise<any> {
    this.logger.debug(`Sending message from instance ${instanceId} to ${to}`);

    try {
      const response = await this.axios.post('/send', {
        instanceId,
        to,
        text,
      });

      if (response.status !== 200) {
        throw new Error(`Engine returned status ${response.status}`);
      }

      this.logger.debug(`Message sent successfully from ${instanceId}`);
      return response.data;
    } catch (error) {
      this.logger.error(`Failed to send message: ${error.message}`);

      // Trata erros específicos da engine
      if (error.response) {
        throw new HttpException(
          error.response.data?.message || 'Engine error',
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