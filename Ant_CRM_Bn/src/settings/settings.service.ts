import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, RedisClientType } from 'redis';
import { UpdateAntibanConfigDto } from './dto';

// Unica excecao ao "CRM nunca escreve antiban:*" (ver antiban-readonly.service.ts):
// essa chave e POLITICA/configuração (editavel pelo admin), nao ESTADO de rate
// limit. O worker (Ant_MSG_Bn/src/anti-ban/anti-ban.service.ts) le essa mesma
// chave antes de cair nos defaults do .env - e o unico lugar que decide se um
// envio passa, o CRM so ajusta a politica que ele usa pra decidir.
const CONFIG_KEY = 'antiban:config';

@Injectable()
export class SettingsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SettingsService.name);
  private client: RedisClientType;

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    this.client = createClient({
      socket: {
        host: this.configService.get('redis.host'),
        port: this.configService.get('redis.port'),
      },
      password: this.configService.get('redis.password') || undefined,
    });
    this.client.on('error', (err) => this.logger.error(`Redis error: ${err.message}`));
    await this.client.connect();
  }

  async onModuleDestroy() {
    await this.client?.quit();
  }

  private getDefaults(): UpdateAntibanConfigDto {
    return {
      warmupDaysToWarm: this.configService.get('antiban.warmupDaysToWarm'),
      warmupDaysToHot: this.configService.get('antiban.warmupDaysToHot'),
      globalDailyLimit: this.configService.get('antiban.globalDailyLimit'),
      userDailyMessageLimit: this.configService.get('antiban.userDailyMessageLimit'),
      trustedInstances: this.configService.get('antiban.trustedInstances'),
      limits: this.configService.get('antiban.limits'),
    };
  }

  async getConfig(): Promise<UpdateAntibanConfigDto> {
    const raw = await this.client.get(CONFIG_KEY);
    if (!raw) return this.getDefaults();

    try {
      const override = JSON.parse(raw);
      const defaults = this.getDefaults();
      return { ...defaults, ...override, limits: { ...defaults.limits, ...override.limits } };
    } catch {
      return this.getDefaults();
    }
  }

  async updateConfig(dto: UpdateAntibanConfigDto): Promise<UpdateAntibanConfigDto> {
    await this.client.set(CONFIG_KEY, JSON.stringify(dto));
    this.logger.log('Configuração de anti-ban atualizada pelo painel');
    return dto;
  }
}
