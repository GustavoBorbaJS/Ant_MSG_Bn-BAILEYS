import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, RedisClientType } from 'redis';

export type WarmupLevel = 'cold' | 'warm' | 'hot';

export interface RateLimitResult {
  allowed: boolean;
  retryAfterMs?: number;
  reason?: string;
}

interface LevelLimits {
  perMinute: number;
  perHour: number;
  perDay: number;
}

interface AntibanConfig {
  warmupDaysToWarm: number;
  warmupDaysToHot: number;
  globalDailyLimit: number;
  trustedInstances: string[];
  limits: { cold: LevelLimits; warm: LevelLimits; hot: LevelLimits };
}

const WINDOWS: { name: string; seconds: number }[] = [
  { name: 'minute', seconds: 60 },
  { name: 'hour', seconds: 3600 },
  { name: 'day', seconds: 86400 },
];

// Chave de POLITICA (config), diferente das chaves de ESTADO (antiban:{id}:*,
// antiban:global:*) usadas mais abaixo - o painel (Ant_CRM_Bn) tem permissao de
// escrever essa aqui (via tela de Configurações), mas nunca as de estado/contador.
const CONFIG_KEY = 'antiban:config';

@Injectable()
export class AntiBanService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AntiBanService.name);
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

  // Le o override configuravel no Redis (escrito pelo CRM). Se nao existir ou
  // estiver corrompido, cai nos defaults de sempre (env/configuration.ts) - o
  // comportamento sem nenhuma configuração feita no painel continua identico.
  private async getEffectiveConfig(): Promise<AntibanConfig> {
    const defaults: AntibanConfig = {
      warmupDaysToWarm: this.configService.get<number>('antiban.warmupDaysToWarm'),
      warmupDaysToHot: this.configService.get<number>('antiban.warmupDaysToHot'),
      globalDailyLimit: this.configService.get<number>('antiban.globalDailyLimit'),
      trustedInstances: this.configService.get<string[]>('antiban.trustedInstances'),
      limits: this.configService.get('antiban.limits'),
    };

    try {
      const raw = await this.client.get(CONFIG_KEY);
      if (!raw) return defaults;
      const override = JSON.parse(raw);
      return { ...defaults, ...override, limits: { ...defaults.limits, ...override.limits } };
    } catch (err) {
      this.logger.error(`Falha ao ler ${CONFIG_KEY}, usando defaults: ${err.message}`);
      return defaults;
    }
  }

  async getWarmupLevel(instanceId: string): Promise<WarmupLevel> {
    const config = await this.getEffectiveConfig();

    if (config.trustedInstances.includes(instanceId)) {
      return 'hot';
    }

    const key = `antiban:${instanceId}:firstSeen`;
    const now = Date.now();

    const firstSeen = await this.client.set(key, String(now), { NX: true, GET: true });
    const startedAt = firstSeen ? Number(firstSeen) : now;
    const ageDays = (now - startedAt) / 86_400_000;

    if (ageDays >= config.warmupDaysToHot) return 'hot';
    if (ageDays >= config.warmupDaysToWarm) return 'warm';
    return 'cold';
  }

  async checkRateLimit(instanceId: string): Promise<RateLimitResult> {
    const config = await this.getEffectiveConfig();
    const level = await this.getWarmupLevel(instanceId);
    const limits = config.limits[level];
    const limitByWindow: Record<string, number> = {
      minute: limits.perMinute,
      hour: limits.perHour,
      day: limits.perDay,
    };

    for (const window of WINDOWS) {
      const bucket = Math.floor(Date.now() / (window.seconds * 1000));
      const key = `antiban:${instanceId}:${window.name}:${bucket}`;
      const limit = limitByWindow[window.name];

      const current = Number((await this.client.get(key)) || 0);
      if (current >= limit) {
        const bucketEndsAt = (bucket + 1) * window.seconds * 1000;
        return {
          allowed: false,
          retryAfterMs: bucketEndsAt - Date.now(),
          reason: `Limite de ${window.name} atingido para a instância ${instanceId} (${current}/${limit}, nível ${level})`,
        };
      }
    }

    // trava de seguranca global: soma de envios de TODAS as instancias no dia,
    // pra proteger contra bug/misconfiguracao mesmo com varias instancias 'hot'
    const globalLimit = config.globalDailyLimit;
    const dayBucket = Math.floor(Date.now() / 86_400_000);
    const globalKey = `antiban:global:day:${dayBucket}`;
    const globalCount = Number((await this.client.get(globalKey)) || 0);
    if (globalCount >= globalLimit) {
      const bucketEndsAt = (dayBucket + 1) * 86_400_000;
      return {
        allowed: false,
        retryAfterMs: bucketEndsAt - Date.now(),
        reason: `Limite global diário atingido (${globalCount}/${globalLimit})`,
      };
    }

    await Promise.all([
      ...WINDOWS.map(async (window) => {
        const bucket = Math.floor(Date.now() / (window.seconds * 1000));
        const key = `antiban:${instanceId}:${window.name}:${bucket}`;
        const count = await this.client.incr(key);
        if (count === 1) {
          await this.client.expire(key, window.seconds);
        }
      }),
      (async () => {
        const count = await this.client.incr(globalKey);
        if (count === 1) {
          await this.client.expire(globalKey, 86400);
        }
      })(),
    ]);

    return { allowed: true };
  }

  async applyHumanDelay(): Promise<void> {
    const minDelayMs = this.configService.get<number>('antiban.minDelayMs');
    const maxDelayMs = this.configService.get<number>('antiban.maxDelayMs');
    const delayMs = minDelayMs + Math.floor(Math.random() * (maxDelayMs - minDelayMs));

    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}
