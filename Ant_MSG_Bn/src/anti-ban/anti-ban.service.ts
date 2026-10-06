import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, RedisClientType } from 'redis';
import { ACQUIRE_SEND_SLOT_SCRIPT, START_COOLDOWN_SCRIPT } from './send-slot.lua';

export type WarmupLevel = 'cold' | 'warm' | 'hot';

export type SlotBlockReason = 'cooldown' | 'minute' | 'hour' | 'day' | 'global' | 'pacing';

// Resposta de acquireSendSlot: ou a instância pode enviar em sendAt (agora ou
// daqui a poucos segundos), ou o job deve voltar pra fila até retryAt.
export type SendSlotDecision =
  | { granted: true; sendAt: number }
  | { granted: false; retryAt: number; reason: SlotBlockReason; detail: string };

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

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

// Depois de quanto tempo sem novo rate limit a escalada do cooldown zera.
const COOLDOWN_STRIKES_TTL_MS = HOUR_MS;

// Chave de POLITICA (config), diferente das chaves de ESTADO (antiban:{id}:*,
// antiban:global:*) usadas mais abaixo - o painel (Ant_CRM_Bn) tem permissao de
// escrever essa aqui (via tela de Configurações), mas nunca as de estado/contador.
const CONFIG_KEY = 'antiban:config';

const BLOCK_REASON_LABEL: Record<SlotBlockReason, string> = {
  cooldown: 'instância em pausa por rate limit do provedor',
  minute: 'limite por minuto atingido',
  hour: 'limite por hora atingido',
  day: 'limite diário atingido',
  global: 'limite global diário atingido',
  pacing: 'aguardando a vez no espaçamento entre envios',
};

function bucketOf(now: number, windowMs: number): number {
  return Math.floor(now / windowMs);
}

function bucketEnd(now: number, windowMs: number): number {
  return (bucketOf(now, windowMs) + 1) * windowMs;
}

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
    return this.resolveWarmupLevel(instanceId, await this.getEffectiveConfig());
  }

  // "SET NX GET" de proposito: a PRIMEIRA consulta de uma instância é o que
  // inicia o relógio de aquecimento dela.
  private async resolveWarmupLevel(instanceId: string, config: AntibanConfig): Promise<WarmupLevel> {
    if (config.trustedInstances.includes(instanceId)) {
      return 'hot';
    }

    const now = Date.now();
    const firstSeen = await this.client.set(`antiban:${instanceId}:firstSeen`, String(now), { NX: true, GET: true });
    const startedAt = firstSeen ? Number(firstSeen) : now;
    const ageDays = (now - startedAt) / DAY_MS;

    if (ageDays >= config.warmupDaysToHot) return 'hot';
    if (ageDays >= config.warmupDaysToWarm) return 'warm';
    return 'cold';
  }

  // Pede a vez de enviar pela instância. Concedido = os contadores de
  // minuto/hora/dia/global JÁ foram consumidos e o envio deve acontecer em
  // sendAt. Negado = nada foi consumido e o job deve ser reagendado pra
  // retryAt (horário próprio dele na fila de espera, não o mesmo de todo mundo).
  async acquireSendSlot(instanceId: string): Promise<SendSlotDecision> {
    const config = await this.getEffectiveConfig();
    const level = await this.resolveWarmupLevel(instanceId, config);
    const limits = config.limits[level];
    const { minGapMs, softGapMs } = this.computeGaps(limits);
    const now = Date.now();

    const [granted, at, reason] = (await this.client.eval(ACQUIRE_SEND_SLOT_SCRIPT, {
      keys: [
        `antiban:${instanceId}:nextSlot`,
        `antiban:${instanceId}:softCursor`,
        `antiban:${instanceId}:cooldown`,
        `antiban:${instanceId}:minute:${bucketOf(now, MINUTE_MS)}`,
        `antiban:${instanceId}:hour:${bucketOf(now, HOUR_MS)}`,
        `antiban:${instanceId}:day:${bucketOf(now, DAY_MS)}`,
        `antiban:global:day:${bucketOf(now, DAY_MS)}`,
      ],
      arguments: [
        now,
        minGapMs,
        softGapMs,
        this.configService.get<number>('antiban.maxInlineWaitMs'),
        limits.perMinute,
        limits.perHour,
        limits.perDay,
        config.globalDailyLimit,
        bucketEnd(now, MINUTE_MS),
        bucketEnd(now, HOUR_MS),
        bucketEnd(now, DAY_MS),
      ].map(String),
    })) as [number, number, SlotBlockReason];

    if (granted === 1) {
      return { granted: true, sendAt: at };
    }
    return {
      granted: false,
      retryAt: at,
      reason,
      detail: `${BLOCK_REASON_LABEL[reason]} (instância ${instanceId}, nível ${level})`,
    };
  }

  // minGap = piso garantido entre dois envios da mesma instância (deriva do
  // perMinute do nível, então o limite por minuto é respeitado pelo próprio
  // espaçamento em vez de virar rajada + silêncio). softGap = minGap + variação
  // aleatória, usado pra espaçar quem está na fila de espera.
  private computeGaps(limits: LevelLimits): { minGapMs: number; softGapMs: number } {
    const minDelayMs = this.configService.get<number>('antiban.minDelayMs');
    const maxDelayMs = this.configService.get<number>('antiban.maxDelayMs');

    const minGapMs = Math.max(Math.ceil(MINUTE_MS / limits.perMinute), minDelayMs);
    const jitterRangeMs = Math.max(maxDelayMs - minDelayMs, 0);
    const softGapMs = minGapMs + Math.floor(Math.random() * jitterRangeMs);

    return { minGapMs, softGapMs };
  }

  async getCooldownRemainingMs(instanceId: string): Promise<number> {
    const until = Number((await this.client.get(`antiban:${instanceId}:cooldown`)) || 0);
    return Math.max(0, until - Date.now());
  }

  // Chamado quando o provedor (Meta Cloud API ou WhatsApp via Baileys)
  // respondeu rate limit. Pausa TODOS os envios da instância até o retorno
  // (acquireSendSlot passa a negar com motivo 'cooldown'). providerRetryAfterMs
  // é o tempo que o próprio provedor pediu, quando ele informa.
  async startCooldown(instanceId: string, providerRetryAfterMs = 0): Promise<{ until: number; strikes: number }> {
    const [until, strikes] = (await this.client.eval(START_COOLDOWN_SCRIPT, {
      keys: [`antiban:${instanceId}:cooldown`, `antiban:${instanceId}:cooldownStrikes`],
      arguments: [
        Date.now(),
        this.configService.get<number>('antiban.cooldownBaseMs'),
        this.configService.get<number>('antiban.cooldownMaxMs'),
        Math.max(0, Math.round(providerRetryAfterMs)),
        COOLDOWN_STRIKES_TTL_MS,
      ].map(String),
    })) as [number, number];

    this.logger.warn(
      `Instância ${instanceId} em pausa por rate limit do provedor até ${new Date(until).toISOString()} (ocorrência ${strikes})`,
    );
    return { until, strikes };
  }
}
