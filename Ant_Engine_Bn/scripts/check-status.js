// Confere o status atual de uma instancia (ou lista todas).
// Uso: node scripts/check-status.js [instanceId]
require('dotenv/config');

async function main() {
  const instanceId = process.argv[2];
  const port = process.env.ENGINE_PORT || 3001;
  const apiKey = process.env.ENGINE_API_KEY;
  if (!apiKey) {
    console.error('ENGINE_API_KEY não definida no .env');
    process.exit(1);
  }

  const url = instanceId
    ? `http://localhost:${port}/status/${instanceId}`
    : `http://localhost:${port}/instances`;

  const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
  console.log(JSON.stringify(await res.json(), null, 2));
}

main().catch((err) => {
  console.error('Falha ao consultar status:', err.message);
  process.exit(1);
});
