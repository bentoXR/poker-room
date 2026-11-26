// Service Worker do Poker Room (PWA): network-first para HTML, cache-first para assets versionados/mídia
const CACHE_NOME = 'poker-room-v111';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((chaves) =>
      Promise.all(chaves.filter((k) => k !== CACHE_NOME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  const ehHtml = req.mode === 'navigate' || url.pathname === '/' || url.pathname.endsWith('.html');
  const ehAssetImutavel = !ehHtml && (
    url.searchParams.has('v')
    || url.pathname.includes('/sons/')
    || url.pathname.includes('/img/')
  );

  if (ehAssetImutavel) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((res) => {
          if (res && res.status === 200 && res.type === 'basic') {
            const copia = res.clone();
            caches.open(CACHE_NOME).then((cache) => cache.put(req, copia)).catch(() => {});
          }
          return res;
        });
      })
    );
    return;
  }

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.status === 200 && res.type === 'basic') {
          const copia = res.clone();
          caches.open(CACHE_NOME).then((cache) => cache.put(req, copia)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req))
  );
});
