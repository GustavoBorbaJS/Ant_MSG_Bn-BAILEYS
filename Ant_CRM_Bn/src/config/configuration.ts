export default () => ({
  port: parseInt(process.env.CRM_PORT, 10) || 3002,
  // onde as imagens de campanha ficam salvas em disco (precisa de volume
  // persistente no docker-compose - ver Dockerfile/compose)
  uploadsDir: process.env.UPLOADS_DIR || './uploads',
  // URL pela qual o Engine (container separado) alcança essa API pra baixar a
  // imagem da campanha na hora de enviar - nome do serviço no docker-compose,
  // resolve via DNS interno. So funciona pra instancias Baileys (mesma rede
  // docker); Meta Cloud API precisaria de uma URL publica de verdade, o que
  // nao é o caso hoje (META_INSTANCES nao usado em produção ainda).
  internalUrl: process.env.CRM_INTERNAL_URL || 'http://crm-api:3002',
  // mesmo Postgres do worker (Ant_MSG_Bn) - mesmas envs, mesmo banco
  database: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT, 10) || 5432,
    username: process.env.DB_USERNAME || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.DB_NAME || 'wa_saas',
  },
  // mesmo Redis do worker - leitura das chaves antiban:* e da fila 'messages'
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT, 10) || 6379,
    password: process.env.REDIS_PASSWORD || '',
  },
  auth: {
    // usados so pra criar o usuario admin inicial no banco, na primeira vez que
    // sobe sem nenhum usuario ainda (ver UsersService.onModuleInit). Depois disso,
    // login sempre confere contra a tabela users - estas envs podem ficar vazias.
    adminUsername: process.env.CRM_ADMIN_USERNAME || '',
    adminEmail: process.env.CRM_ADMIN_EMAIL || '',
    // hash bcrypt, nunca a senha em texto puro
    adminPasswordHash: process.env.CRM_ADMIN_PASSWORD_HASH || '',
    jwtSecret: process.env.CRM_JWT_SECRET || '',
    jwtExpiresIn: process.env.CRM_JWT_EXPIRES_IN || '24h',
  },
  engine: {
    apiUrl: process.env.ENGINE_API_URL || 'http://localhost:3001',
    // precisa ser IGUAL ao ENGINE_API_KEY do Ant_Engine_Bn/.env
    apiKey: process.env.ENGINE_API_KEY || '',
  },
  // mesmos valores do Ant_MSG_Bn/.env - o produtor da fila (queue-producer.service.ts)
  // precisa replicar o defaultJobOptions exato do worker
  worker: {
    retryAttempts: parseInt(process.env.WORKER_RETRY_ATTEMPTS, 10) || 3,
    retryDelay: parseInt(process.env.WORKER_RETRY_DELAY, 10) || 5000,
  },
  // Copia somente-leitura da tabela de limites do worker (Ant_MSG_Bn/src/config/
  // configuration.ts) - so pra exibir os denominadores certos no painel. O CRM
  // nunca decide se um envio passa; isso continua 100% no AntiBanService do worker.
  antiban: {
    warmupDaysToWarm: parseInt(process.env.ANTIBAN_WARMUP_DAYS_TO_WARM, 10) || 3,
    warmupDaysToHot: parseInt(process.env.ANTIBAN_WARMUP_DAYS_TO_HOT, 10) || 7,
    trustedInstances: (process.env.ANTIBAN_TRUSTED_INSTANCES || '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean),
    globalDailyLimit: parseInt(process.env.ANTIBAN_GLOBAL_DAILY_LIMIT, 10) || 1000,
    limits: {
      cold: { perMinute: 2, perHour: 10, perDay: 40 },
      warm: { perMinute: 4, perHour: 30, perDay: 150 },
      hot: { perMinute: 8, perHour: 60, perDay: 500 },
    },
  },
});
