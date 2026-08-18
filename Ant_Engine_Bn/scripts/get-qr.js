// Pareia (ou reconecta) uma instancia real e salva o QR code como PNG local.
// Uso: node scripts/get-qr.js <instanceId>
require('dotenv/config');
const fs = require('fs');
const path = require('path');

async function main() {
  const instanceId = process.argv[2];
  if (!instanceId) {
    console.error('Uso: node scripts/get-qr.js <instanceId>');
    process.exit(1);
  }

  const port = process.env.ENGINE_PORT || 3001;
  const apiKey = process.env.ENGINE_API_KEY;
  if (!apiKey) {
    console.error('ENGINE_API_KEY não definida no .env');
    process.exit(1);
  }

  const res = await fetch(`http://localhost:${port}/instances/${instanceId}/connect`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!res.ok) {
    console.error(`Engine respondeu ${res.status}: ${await res.text()}`);
    process.exit(1);
  }

  const data = await res.json();

  if (data.status === 'connected') {
    console.log(`Instância "${instanceId}" já está conectada. Nada a fazer.`);
    return;
  }

  if (!data.qr) {
    console.log(`Status atual: ${data.status}. Ainda sem QR pronto — rode de novo em alguns segundos.`);
    return;
  }

  const base64 = data.qr.split(',')[1];
  const outPath = path.resolve(`./qr-${instanceId}.png`);
  fs.writeFileSync(outPath, Buffer.from(base64, 'base64'));

  console.log(`QR salvo em: ${outPath}`);
  console.log('No celular: WhatsApp > Configurações > Aparelhos conectados > Conectar aparelho.');
  console.log('O QR expira rápido (~20s) — se demorar pra escanear, rode este script de novo.');
}

main().catch((err) => {
  console.error('Falha ao obter QR:', err.message);
  process.exit(1);
});
