// Move jobs 'delayed' de volta pra 'waiting' agora, ao inves de esperar o horario
// agendado - util quando um limite foi ajustado e os jobs antigos ficaram presos
// num timestamp calculado com o limite antigo.
require('dotenv/config');
const { Queue } = require('bullmq');

async function main() {
  const queue = new Queue('messages', {
    connection: {
      host: process.env.REDIS_HOST || 'localhost',
      port: Number(process.env.REDIS_PORT) || 6379,
      password: process.env.REDIS_PASSWORD || undefined,
    },
  });

  const delayed = await queue.getJobs(['delayed'], 0, 1000);
  console.log(`${delayed.length} job(s) delayed encontrado(s)`);

  for (const job of delayed) {
    await job.promote();
    console.log(`Promovido: job ${job.id}`);
  }

  await queue.close();
}

main().catch((err) => {
  console.error('Falha:', err);
  process.exit(1);
});
