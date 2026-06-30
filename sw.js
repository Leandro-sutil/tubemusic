self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  // Deixa o Brave gerenciar as requisições de rede livremente
});