export default () => ({
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT, 10) || 6379,
    password: process.env.REDIS_PASSWORD || '',
  },
  database: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT, 10) || 5432,
    username: process.env.DB_USERNAME || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.DB_NAME || 'wa_saas',
  },
  engine: {
    apiUrl: process.env.ENGINE_API_URL || 'http://engine:3000',
    // precisa ser IGUAL ao ENGINE_API_KEY configurado no engine (Ant_Engine_Bn/.env)
    apiKey: process.env.ENGINE_API_KEY || '',
  },
  worker: {
    concurrency: parseInt(process.env.WORKER_CONCURRENCY, 10) || 5,
    retryAttempts: parseInt(process.env.WORKER_RETRY_ATTEMPTS, 10) || 3,
    retryDelay: parseInt(process.env.WORKER_RETRY_DELAY, 10) || 5000,
    // Quanto tempo uma mensagem fica aguardando a instância reconectar antes
    // de desistir de vez. NAO consome os "attempts" do BullMQ (é reagendamento,
    // nao retry) - queda de conexão/QR pendente não deveria custar tentativas
    // de envio, só tempo. Default 20min: cobre queda de rede, restart de
    // container e reconexão pós-QR (515) sem exigir novo disparo manual.
    instanceWaitTimeoutMs: parseInt(process.env.WORKER_INSTANCE_WAIT_TIMEOUT_MS, 10) || 20 * 60_000,
    // Intervalo entre re-checagens de status enquanto aguarda a instância.
    instanceRecheckDelayMs: parseInt(process.env.WORKER_INSTANCE_RECHECK_DELAY_MS, 10) || 10_000,
    // Intervalo mínimo entre chamadas de /reconnect para a MESMA instância -
    // evita que um lote de centenas de mensagens, todas encontrando a
    // instância caída ao mesmo tempo, disparem reconexões concorrentes
    // (cada uma derrubando/recriando o socket da anterior).
    instanceReconnectCooldownMs: parseInt(process.env.WORKER_INSTANCE_RECONNECT_COOLDOWN_MS, 10) || 15_000,
    // Quantas vezes a MESMA mensagem pode ser reagendada por rate limit do
    // provedor (429 do engine) antes de desistir. Cada reagendamento espera o
    // cooldown da instância (ver antiban.cooldown*) e NAO consome "attempts".
    maxRateLimitDeferrals: parseInt(process.env.WORKER_MAX_RATE_LIMIT_DEFERRALS, 10) || 5,
  },
  antiban: {
    // Espaçamento entre envios da MESMA instância (ver AntiBanService.acquireSendSlot):
    //   intervalo mínimo = max(60s / perMinute do nível, minDelayMs)
    //   intervalo real   = mínimo + sorteio de até (maxDelayMs - minDelayMs)
    // ou seja, minDelayMs é o piso e a diferença pro maxDelayMs é a variação
    // "humana" somada por cima.
    minDelayMs: parseInt(process.env.ANTIBAN_MIN_DELAY_MS, 10) || 2000,
    maxDelayMs: parseInt(process.env.ANTIBAN_MAX_DELAY_MS, 10) || 6000,
    // Até quanto tempo um job espera a própria vez DENTRO do worker (segurando
    // um slot de concorrência). Acima disso ele volta pra fila como 'delayed'
    // e libera o slot pra outras instâncias.
    maxInlineWaitMs: parseInt(process.env.ANTIBAN_MAX_INLINE_WAIT_MS, 10) || 5000,
    // Pausa da instância quando o provedor (Meta/WhatsApp) responde rate
    // limit: dobra a cada ocorrência seguida (base, 2x, 4x...) até o teto.
    cooldownBaseMs: parseInt(process.env.ANTIBAN_COOLDOWN_BASE_MS, 10) || 60_000,
    cooldownMaxMs: parseInt(process.env.ANTIBAN_COOLDOWN_MAX_MS, 10) || 30 * 60_000,
    // dias de idade da instancia para sair de cold -> warm -> hot
    warmupDaysToWarm: parseInt(process.env.ANTIBAN_WARMUP_DAYS_TO_WARM, 10) || 3,
    warmupDaysToHot: parseInt(process.env.ANTIBAN_WARMUP_DAYS_TO_HOT, 10) || 7,
    // instanceIds que ja sao numeros estabelecidos (nao novos pro WhatsApp) e podem
    // pular o aquecimento gradual, indo direto para o nivel 'hot'
    trustedInstances: (process.env.ANTIBAN_TRUSTED_INSTANCES || '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean),
    // trava de seguranca: teto de envios por dia somando TODAS as instancias,
    // independente do nivel de aquecimento de cada uma
    globalDailyLimit: parseInt(process.env.ANTIBAN_GLOBAL_DAILY_LIMIT, 10) || 1000,
    // limites de envio por instancia, conforme o nivel de aquecimento
    limits: {
      cold: { perMinute: 2, perHour: 10, perDay: 40 },
      warm: { perMinute: 4, perHour: 30, perDay: 150 },
      hot: { perMinute: 8, perHour: 60, perDay: 500 },
    },
  },
});