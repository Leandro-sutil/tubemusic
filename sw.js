const CACHE_NAME = 'tubemusic-v1';
const ASSETS = [
  './',
  './index.html',
  './app.js',
  './manifest.json',
  'https://cdn.tailwindcss.com',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css'
];

// Instala o Service Worker e guarda a estrutura do app no cache
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.clients.claim();
});

// Intercepta as requisições: se estiver offline, busca do cache
self.addEventListener('fetch', (e) => {
  // Permite apenas arquivos locais ou as CDN essenciais (Tailwind e FontAwesome)
  if (!e.request.url.startsWith(self.location.origin) && !e.request.url.includes('tailwindcss') && !e.request.url.includes('font-awesome')) {
    return;
  }
  
  e.respondWith(
    caches.match(e.request).then((cachedResponse) => {
      return cachedResponse || fetch(e.request);
    })
  );
});
