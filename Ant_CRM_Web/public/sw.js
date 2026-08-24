// Service worker minimo, so pra habilitar o prompt de instalacao (PWA)
// exige um SW registrado com um handler de fetch. Sem cache proprio: tudo
// passa direto pra rede.
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', () => {});
