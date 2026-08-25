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

  async getStatus(instanceId: string): Promise<{ status: string; qr?: string; pairingCode?: string }> {
    const response = await this.axios.get(`/status/${instanceId}`);
    return response.data;
  }

  // phoneNumber presente = pede codigo de pareamento em vez de QR - ver
  // Ant_Engine_Bn/src/whatsapp/whatsapp.service.ts (requestPairingCode).
  async connect(instanceId: string, phoneNumber?: string): Promise<{ status: string; qr?: string; pairingCode?: string }> {
    const response = await this.axios.post(`/instances/${instanceId}/connect`, phoneNumber ? { phoneNumber } : undefined);
    return response.data;
  }

  async reconnect(instanceId: string): Promise<{ status: string; qr?: string; pairingCode?: string }> {
    const response = await this.axios.post('/reconnect', { instanceId });
    return response.data;
  }

  async checkNumber(instanceId: string, to: string): Promise<{ exists: boolean; jid?: string }> {
    const response = await this.axios.get(`/instances/${instanceId}/check/${to}`);
    return response.data;
  }

  async resetInstance(instanceId: string): Promise<{ status: string }> {
    const response = await this.axios.delete(`/instances/${instanceId}`);
    return response.data;
  }

  // Chama o /send da engine DIRETO, sem passar pela fila (BullMQ) que o
  // worker normal usa - ver TestDispatchService. É de propósito: o objetivo
  // ali é mandar a mensagem o mais rápido possível depois do reconnect,
  // e a fila introduziria uma espera não determinística (poll do worker,
  // rate limit, delay humano) que mascararia justamente a janela de
  // sincronismo que o teste quer flagrar.
  async send(instanceId: string, to: string, text: string, messageId?: string): Promise<{ messageId: string }> {
    const response = await this.axios.post('/send', { instanceId, to, text, messageId });
    return response.data;
  }

  // Modo AGRESSIVO do disparo de teste - ver TestDispatchService e
  // Ant_Engine_Bn/src/whatsapp/whatsapp.service.ts (forceSessionConflict).
  // Abre uma 2ª conexão concorrente na mesma sessão de propósito, o que PODE
  // derrubar/corromper a instância - só chamar com o usuário ciente do risco.
  async forceSessionConflict(
    instanceId: string,
    to: string,
    texts: string[],
  ): Promise<{ results: { status: 'sent' | 'failed'; messageId?: string; errorMessage?: string }[] }> {
    const response = await this.axios.post(`/instances/${instanceId}/force-session-conflict`, { to, texts });
    return response.data;
  }
}
