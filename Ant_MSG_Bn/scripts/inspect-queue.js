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

  const counts = await queue.getJobCounts();
  console.log('counts:', counts);

  for (const state of ['waiting', 'active', 'delayed', 'completed', 'failed']) {
    const jobs = await queue.getJobs([state], 0, 20);
    console.log(`--- ${state} (${jobs.length}) ---`);
    for (const job of jobs) {
      console.log(job.id, job.name, JSON.stringify(job.data), 'attemptsMade=', job.attemptsMade, 'failedReason=', job.failedReason);
    }
  }

  await queue.close();
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
