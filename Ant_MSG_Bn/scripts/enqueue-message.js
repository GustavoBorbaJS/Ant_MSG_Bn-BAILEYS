// Producer minimo para testar o worker ponta a ponta.
// Insere um MessageLog 'pending' no Postgres e enfileira o job correspondente no BullMQ.
// Uso: node scripts/enqueue-message.js [instanceId] [to] [text]
require('dotenv/config');
const { Client } = require('pg');
const { Queue } = require('bullmq');

async function main() {
  const [, , instanceId = 'instance-teste', to = '5511999999999', text = 'Mensagem de teste do producer'] =
    process.argv;

  const pg = new Client({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 5432,
    user: process.env.DB_USERNAME || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.DB_NAME || 'wa_saas',
  });

  await pg.connect();

  const { rows } = await pg.query(
    'INSERT INTO "message_logs" ("instanceId", "to", "text", "status") VALUES ($1, $2, $3, $4) RETURNING id',
    [instanceId, to, text, 'pending'],
  );
  const messageLogId = rows[0].id;
  await pg.end();

  const queue = new Queue('messages', {
    connection: {
      host: process.env.REDIS_HOST || 'localhost',
      port: Number(process.env.REDIS_PORT) || 6379,
      password: process.env.REDIS_PASSWORD || undefined,
    },
  });

  const job = await queue.add('send-message', { messageLogId, instanceId, to, text });
  await queue.close();

  console.log(`Enfileirado: messageLogId=${messageLogId} jobId=${job.id}`);
}

main().catch((err) => {
  console.error('Falha ao enfileirar mensagem:', err);
  process.exit(1);
});
