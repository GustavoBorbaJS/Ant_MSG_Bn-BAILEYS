// Dispara um lote de mensagens de uma vez pra mesma instancia - pra observar o
// anti-ban (rate limit/aquecimento/delay humano) segurando de verdade sob carga real.
// Uso: node scripts/enqueue-batch.js <instanceId> <numero1,numero2,...> <texto da mensagem>
require('dotenv/config');
const { Client } = require('pg');
const { Queue } = require('bullmq');

async function main() {
  const [, , instanceId, numbersArg, ...textParts] = process.argv;

  if (!instanceId || !numbersArg || textParts.length === 0) {
    console.error('Uso: node scripts/enqueue-batch.js <instanceId> <numero1,numero2,...> <texto da mensagem>');
    process.exit(1);
  }

  const numbers = numbersArg
    .split(',')
    .map((n) => n.trim())
    .filter(Boolean);
  const text = textParts.join(' ');

  const pg = new Client({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 5432,
    user: process.env.DB_USERNAME || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.DB_NAME || 'wa_saas',
  });
  await pg.connect();

  const queue = new Queue('messages', {
    connection: {
      host: process.env.REDIS_HOST || 'localhost',
      port: Number(process.env.REDIS_PORT) || 6379,
      password: process.env.REDIS_PASSWORD || undefined,
    },
  });

  for (const to of numbers) {
    const { rows } = await pg.query(
      'INSERT INTO "message_logs" ("instanceId", "to", "text", "status") VALUES ($1, $2, $3, $4) RETURNING id',
      [instanceId, to, text, 'pending'],
    );
    const messageLogId = rows[0].id;
    const job = await queue.add('send-message', { messageLogId, instanceId, to, text });
    console.log(`Enfileirado ${to}: messageLogId=${messageLogId} jobId=${job.id}`);
  }

  await pg.end();
  await queue.close();

  console.log(`\nTotal: ${numbers.length} mensagens enfileiradas para a instância "${instanceId}".`);
  console.log('Acompanhe os logs do worker pra ver o anti-ban segurando/liberando em tempo real.');
}

main().catch((err) => {
  console.error('Falha ao enfileirar lote:', err);
  process.exit(1);
});
