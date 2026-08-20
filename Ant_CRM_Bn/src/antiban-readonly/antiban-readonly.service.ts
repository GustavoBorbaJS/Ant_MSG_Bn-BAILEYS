import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, RedisClientType } from 'redis';
import { SettingsService } from '../settings/settings.service';

export type WarmupLevel = 'cold' | 'warm' | 'hot';

export interface InstanceUsage {
  warmupLevel: WarmupLevel;
  ageDays: number | null;
  limits: { perMinute: number; perHour: number; perDay: number };
  used: { minute: number; hour: number; day: number };
}

// Espelho SOMENTE LEITURA de Ant_MSG_Bn/src/anti-ban/anti-ban.service.ts - fonte
// da verdade fica lá. Este serviço nunca dá INCR/EXPIRE em chave antiban:* e
// nunca decide se um envio passa; isso é autoridade exclusiva do worker.
// A politica (limites/aquecimento) vem do SettingsService, que ja sabe ler o
// override configurado no painel (mesma chave "antiban:config" que o worker le)
// - assim os numeros mostrados aqui sempre batem com o que esta valendo de verdade.
//
// Detalhe importante: getWarmupLevel do worker usa "SET NX GET" porque é o
// caminho que INICIA o relogio de aquecimento na primeira consulta. Aqui usamos
// GET puro de proposito - só visualizar uma instância no painel não pode iniciar
// o aquecimento dela.
const WINDOWS: { name: 'minute' | 'hour' | 'day'; seconds: number }[] = [
  { name: 'minute', seconds: 60 },
  { name: 'hour', seconds: 3600 },
  { name: 'day', seconds: 86400 },
];

@Injectable()
export class AntibanReadonlyService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AntibanReadonlyService.name);
  private client: RedisClientType;

  constructor(
    private configService: ConfigService,
    private settingsService: SettingsService,
  ) {}

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

  async getWarmupLevel(instanceId: string): Promise<{ level: WarmupLevel; ageDays: number | null }> {
    const config = await this.settingsService.getConfig();

    if (config.trustedInstances.includes(instanceId)) {
      return { level: 'hot', ageDays: null };
    }

    const firstSeen = await this.client.get(`antiban:${instanceId}:firstSeen`);
    if (!firstSeen) {
      return { level: 'cold', ageDays: null };
    }

    const ageDays = (Date.now() - Number(firstSeen)) / 86_400_000;

    let level: WarmupLevel = 'cold';
    if (ageDays >= config.warmupDaysToHot) level = 'hot';
    else if (ageDays >= config.warmupDaysToWarm) level = 'warm';

    return { level, ageDays };
  }

  async getUsage(instanceId: string): Promise<InstanceUsage> {
    const config = await this.settingsService.getConfig();
    const { level, ageDays } = await this.getWarmupLevel(instanceId);
    const limits = config.limits[level];

    const used: InstanceUsage['used'] = { minute: 0, hour: 0, day: 0 };
    await Promise.all(
      WINDOWS.map(async (window) => {
        const bucket = Math.floor(Date.now() / (window.seconds * 1000));
        const value = await this.client.get(`antiban:${instanceId}:${window.name}:${bucket}`);
        used[window.name] = Number(value) || 0;
      }),
    );

    return { warmupLevel: level, ageDays, limits, used };
  }
}
