import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';

// Mesmo contrato/autenticacao que Ant_MSG_Bn/src/engine/engine.service.ts ja usa
// contra o Ant_Engine_Bn. A chave fica só aqui no servidor - o frontend nunca vê.
@Injectable()
export class EngineClientService {
  private readonly logger = new Logger(EngineClientService.name);
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

  async listInstances(): Promise<{ instanceId: string; status: string }[]> {
    const response = await this.axios.get('/instances');
    return response.data;
  }

  async getStatus(instanceId: string): Promise<{ status: string; qr?: string }> {
    const response = await this.axios.get(`/status/${instanceId}`);
    return response.data;
  }

  async connect(instanceId: string): Promise<{ status: string; qr?: string }> {
    const response = await this.axios.post(`/instances/${instanceId}/connect`);
    return response.data;
  }

  async reconnect(instanceId: string): Promise<{ status: string; qr?: string }> {
    const response = await this.axios.post('/reconnect', { instanceId });
    return response.data;
  }

  async checkNumber(instanceId: string, to: string): Promise<{ exists: boolean; jid?: string }> {
    const response = await this.axios.get(`/instances/${instanceId}/check/${to}`);
    return response.data;
  }
}
