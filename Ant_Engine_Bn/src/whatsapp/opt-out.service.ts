import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import type { BaileysEventMap, WAMessage, WASocket } from '@whiskeysockets/baileys';
import { extractText, isDirectChat, isOptOutMessage, resolveSenderPhone } from './opt-out';

const NOTIFY_ATTEMPTS = 3;
const NOTIFY_RETRY_DELAY_MS = 2000;

// Opt-out por resposta: quando alguém responde "Não tenho interesse" (ou
// outra frase de saída - ver opt-out.ts) a uma instância, avisa o CRM, que
// passa a pular esse número nos próximos disparos (OptOutsService lá).
//
// O engine só repassa as mensagens que SÃO pedido de saída. O resto das
// conversas recebidas não sai daqui nem é guardado.
//
// É o único ponto em que o engine chama o CRM (o normal é o contrário) -
// autentica com o próprio ENGINE_API_KEY, que os dois lados já compartilham.
@Injectable()
export class OptOutService {
  private readonly logger = new Logger(OptOutService.name);
  private readonly crm: AxiosInstance;
  private readonly confirmationText: string;

  constructor(configService: ConfigService) {
    this.crm = axios.create({
      baseURL: configService.get<string>('crmInternalUrl'),
      timeout: 10_000,
      headers: { Authorization: `Bearer ${configService.get<string>('engineApiKey')}` },
    });
    this.confirmationText = configService.get<string>('optOut.confirmationText');
  }

  // Ligado no 'messages.upsert' de cada socket (ver WhatsappService.openConnection).
  // Nunca lança: um erro aqui não pode derrubar o handler de eventos da conexão.
  async handleUpsert(instanceId: string, sock: WASocket, upsert: BaileysEventMap['messages.upsert']): Promise<void> {
    // 'notify' = mensagem nova chegando agora; 'append' é histórico sincronizado
    if (upsert.type !== 'notify') return;

    for (const message of upsert.messages) {
      try {
        await this.handleMessage(instanceId, sock, message);
      } catch (err) {
        this.logger.error(`Falha ao tratar possível opt-out na instância ${instanceId}: ${err.message}`);
      }
    }
  }

  private async handleMessage(instanceId: string, sock: WASocket, message: WAMessage): Promise<void> {
    if (message.key.fromMe || !isDirectChat(message.key)) return;

    const text = extractText(message.message);
    if (!isOptOutMessage(text)) return;

    const phone = await resolveSenderPhone(message.key, (lid) => sock.signalRepository.lidMapping.getPNForLID(lid));
    if (!phone) {
      this.logger.warn(
        `Pedido de saída recebido na instância ${instanceId}, mas não foi possível descobrir o número (remetente ${message.key.remoteJid})`,
      );
      return;
    }

    const registered = await this.notifyCrm(instanceId, phone, text);
    if (registered && this.confirmationText) {
      await sock.sendMessage(message.key.remoteJid, { text: this.confirmationText });
    }
  }

  // Devolve true só quando o CRM registrou um bloqueio NOVO - quem já estava
  // bloqueado e escreve de novo não recebe a confirmação repetida.
  private async notifyCrm(instanceId: string, phone: string, text: string): Promise<boolean> {
    for (let attempt = 1; attempt <= NOTIFY_ATTEMPTS; attempt++) {
      try {
        const response = await this.crm.post('/internal/opt-outs', { instanceId, phone, text: text.slice(0, 1000) });
        this.logger.log(`Pedido de saída de ${phone} (instância ${instanceId}) entregue ao CRM`);
        return response.data?.registered === true;
      } catch (err) {
        this.logger.warn(
          `CRM não aceitou o pedido de saída de ${phone} (tentativa ${attempt}/${NOTIFY_ATTEMPTS}): ${err.message}`,
        );
        if (attempt < NOTIFY_ATTEMPTS) {
          await new Promise((resolve) => setTimeout(resolve, NOTIFY_RETRY_DELAY_MS));
        }
      }
    }

    this.logger.error(`Pedido de saída de ${phone} (instância ${instanceId}) NÃO foi registrado - marque o contato à mão no painel`);
    return false;
  }
}
