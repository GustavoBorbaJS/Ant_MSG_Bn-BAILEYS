import { BadRequestException, HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AiSettings } from '../database/entities/ai-settings.entity';
import { AI_PROVIDERS, AiModelOption, AiProviderError, AiProviderId, isAiProviderId } from './ai-providers';
import { SecretBox } from './secret-box';

// De onde vem a IA usada por um usuário:
//   'user'   - a chave que ele mesmo cadastrou no menu "IA"
//   'server' - a ANTHROPIC_API_KEY do servidor (só quando ele não cadastrou nada)
export type AiSource = 'user' | 'server';

interface ResolvedAi {
  source: AiSource;
  provider: AiProviderId;
  model: string;
  apiKey: string;
}

export interface AiSettingsView {
  configured: boolean;
  source: AiSource | null;
  provider: AiProviderId | null;
  model: string | null;
  // últimos 4 caracteres da chave - o suficiente pra reconhecer, nunca a chave
  keyHint: string | null;
  providers: { id: AiProviderId; label: string; keyUrl: string; keyPlaceholder: string; defaultModel: string | null }[];
}

const NOT_CONFIGURED_MESSAGE = 'Nenhuma IA configurada. Cadastre sua chave de API no menu "IA".';

const STATUS_BY_ERROR_KIND: Record<AiProviderError['kind'], number> = {
  auth: HttpStatus.BAD_REQUEST,
  refusal: HttpStatus.UNPROCESSABLE_ENTITY,
  rate_limit: HttpStatus.TOO_MANY_REQUESTS,
  unavailable: HttpStatus.BAD_GATEWAY,
};

// Porta única pra qualquer uso de IA no CRM: guarda a configuração de cada
// usuário (provedor, modelo, chave cifrada) e completa texto com ela. Quem
// usa IA (saúde da instância, campanhas) chama complete() e não sabe qual
// provedor está por trás - isso é assunto de ai-providers.ts.
@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly secretBox: SecretBox;

  constructor(
    @InjectRepository(AiSettings) private readonly settingsRepo: Repository<AiSettings>,
    private readonly configService: ConfigService,
  ) {
    this.secretBox = new SecretBox(this.configService.get<string>('ai.encryptionSecret'));
  }

  async getSettings(userId: string): Promise<AiSettingsView> {
    const resolved = await this.resolve(userId);
    return {
      configured: resolved !== null,
      source: resolved?.source ?? null,
      provider: resolved?.provider ?? null,
      model: resolved?.model ?? null,
      keyHint: resolved?.source === 'user' ? resolved.apiKey.slice(-4) : null,
      providers: Object.values(AI_PROVIDERS).map(({ id, label, keyUrl, keyPlaceholder, defaultModel }) => ({
        id,
        label,
        keyUrl,
        keyPlaceholder,
        defaultModel,
      })),
    };
  }

  // apiKey ausente = manter a chave já salva (trocar só o modelo). Só vale se
  // o provedor continuar o mesmo: chave de um provedor não serve no outro.
  async saveSettings(userId: string, provider: string, model: string | undefined, apiKey: string | undefined) {
    const providerId = this.assertProvider(provider);
    const key = apiKey?.trim() || (await this.storedKeyFor(userId, providerId));
    if (!key) {
      throw new BadRequestException('Informe a chave de API.');
    }

    const chosenModel = model?.trim() || AI_PROVIDERS[providerId].defaultModel;
    if (!chosenModel) {
      throw new BadRequestException('Escolha um modelo.');
    }

    await this.settingsRepo.save({
      userId,
      provider: providerId,
      model: chosenModel,
      apiKeyEnc: this.secretBox.encrypt(key),
    });
    return this.getSettings(userId);
  }

  async removeSettings(userId: string): Promise<AiSettingsView> {
    await this.settingsRepo.delete({ userId });
    return this.getSettings(userId);
  }

  // Lista os modelos que a chave enxerga - serve também de validação da
  // chave antes de salvar (chave errada falha aqui, com mensagem clara).
  async listModels(userId: string, provider: string, apiKey: string | undefined): Promise<AiModelOption[]> {
    const providerId = this.assertProvider(provider);
    const key = apiKey?.trim() || (await this.storedKeyFor(userId, providerId));
    if (!key) {
      throw new BadRequestException('Informe a chave de API.');
    }
    return this.run(() => AI_PROVIDERS[providerId].listModels(key));
  }

  async isConfigured(userId: string): Promise<boolean> {
    return (await this.resolve(userId)) !== null;
  }

  // Completa um texto com a IA do usuário. Lança HttpException com mensagem
  // pronta pra tela quando não há IA configurada ou o provedor falha.
  async complete(userId: string, system: string, user: string): Promise<{ text: string; model: string }> {
    const ai = await this.resolve(userId);
    if (!ai) {
      throw new BadRequestException(NOT_CONFIGURED_MESSAGE);
    }

    const text = await this.run(() =>
      AI_PROVIDERS[ai.provider].complete({ apiKey: ai.apiKey, model: ai.model, system, user }),
    );
    if (!text) {
      throw new HttpException('A IA devolveu uma resposta vazia. Tente de novo.', HttpStatus.BAD_GATEWAY);
    }
    return { text, model: ai.model };
  }

  private async run<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error) {
      if (error instanceof AiProviderError) {
        throw new HttpException(error.message, STATUS_BY_ERROR_KIND[error.kind]);
      }
      throw error;
    }
  }

  private assertProvider(provider: string): AiProviderId {
    if (!isAiProviderId(provider)) {
      throw new BadRequestException('Provedor de IA desconhecido.');
    }
    return provider;
  }

  private async storedKeyFor(userId: string, provider: AiProviderId): Promise<string | null> {
    const stored = await this.readStored(userId);
    return stored?.provider === provider ? stored.apiKey : null;
  }

  private async resolve(userId: string): Promise<ResolvedAi | null> {
    const stored = await this.readStored(userId);
    if (stored) return stored;

    const serverKey = this.configService.get<string>('ai.serverAnthropicKey');
    if (!serverKey) return null;
    return {
      source: 'server',
      provider: 'anthropic',
      model: this.configService.get<string>('ai.serverAnthropicModel'),
      apiKey: serverKey,
    };
  }

  // Chave que não decifra (segredo do servidor trocado) ou provedor que
  // deixou de existir contam como "não configurado": o usuário recadastra.
  private async readStored(userId: string): Promise<ResolvedAi | null> {
    const row = await this.settingsRepo.findOne({ where: { userId } });
    if (!row || !isAiProviderId(row.provider)) return null;

    try {
      return { source: 'user', provider: row.provider, model: row.model, apiKey: this.secretBox.decrypt(row.apiKeyEnc) };
    } catch {
      this.logger.warn(`Chave de IA do usuário ${userId} não pôde ser decifrada - tratando como não configurada`);
      return null;
    }
  }
}
