// Mock da engine WhatsApp (Baileys etc.) para testar o worker ponta a ponta
// enquanto a engine real nao existe. Simula /send, /status/:instanceId e /reconnect.
require('dotenv/config');
const http = require('http');
const crypto = require('crypto');

const PORT = Number(process.env.ENGINE_MOCK_PORT) || 3001;

const instanceStatus = new Map();

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  try {
    if (req.method === 'POST' && url.pathname === '/send') {
      const { instanceId, to, text } = await readBody(req);
      console.log(`[mock-engine] send from=${instanceId} to=${to} text="${text}"`);

      if (!instanceId || !to || !text) {
        return send(res, 400, { message: 'instanceId, to e text sao obrigatorios' });
      }

      // simula latencia de rede real
      await new Promise((resolve) => setTimeout(resolve, 300 + Math.random() * 700));

      instanceStatus.set(instanceId, 'connected');
      return send(res, 200, { messageId: crypto.randomUUID(), status: 'sent' });
    }

    if (req.method === 'GET' && url.pathname.startsWith('/status/')) {
      const instanceId = url.pathname.split('/status/')[1];
      const status = instanceStatus.get(instanceId) || 'connected';
      return send(res, 200, { status });
    }

    if (req.method === 'POST' && url.pathname === '/reconnect') {
      const { instanceId } = await readBody(req);
      console.log(`[mock-engine] reconnect instance=${instanceId}`);
      instanceStatus.set(instanceId, 'connected');
      return send(res, 200, { status: 'connected' });
    }

    send(res, 404, { message: 'not found' });
  } catch (err) {
    console.error('[mock-engine] error handling request', err);
    send(res, 500, { message: 'internal error' });
  }
});

server.listen(PORT, () => {
  console.log(`[mock-engine] listening on http://localhost:${PORT}`);
});
