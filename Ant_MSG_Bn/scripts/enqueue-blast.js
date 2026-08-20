// Enfileira N mensagens de uma vez pro mesmo destinatario - um so processo Node,
// mais eficiente que rodar o script individual N vezes. Uso:
// node scripts/enqueue-blast.js <instanceId> <to> <count> <texto>
require('dotenv/config');
const { Client } = require('pg');
const { Queue } = require('bullmq');

async function main() {
  const [, , instanceId, to, countArg, ...textParts] = process.argv;
  const count = Number(countArg);

  if (!instanceId || !to || !count || textParts.length === 0) {
    console.error('Uso: node scripts/enqueue-blast.js <instanceId> <to> <count> <texto>');
    process.exit(1);
  }

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

  const baseText = textParts.join(' ');

  for (let i = 1; i <= count; i++) {
    const text = `${baseText} #${i}`;
    const { rows } = await pg.query(
      'INSERT INTO "message_logs" ("instanceId", "to", "text", "status") VALUES ($1, $2, $3, $4) RETURNING id',
      [instanceId, to, text, 'pending'],
    );
    const job = await queue.add('send-message', { messageLogId: rows[0].id, instanceId, to, text });
    console.log(`[${i}/${count}] messageLogId=${rows[0].id} jobId=${job.id}`);
  }

  await pg.end();
  await queue.close();
  console.log(`\nTotal: ${count} mensagens enfileiradas para "${to}" via instância "${instanceId}".`);
}

main().catch((err) => {
  console.error('Falha ao enfileirar lote:', err);
  process.exit(1);
});
