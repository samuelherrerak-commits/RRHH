// Service worker de CADS: permite instalar el sitio como app. Siempre pide la versión nueva a la red
// (así nunca se queda una versión vieja) y solo usa la copia guardada si no hay conexión.
const CACHE = 'cads-v1';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(clients.claim()));
self.addEventListener('fetch', (e) => {
  const r = e.request;
  if (r.method !== 'GET' || new URL(r.url).origin !== location.origin) return;   // la API (Google) no pasa por aquí
  e.respondWith(fetch(r).then((resp) => {
    if (resp.ok) { const copia = resp.clone(); caches.open(CACHE).then((c) => c.put(r, copia)); }
    return resp;
  }).catch(() => caches.match(r).then((m) => m || Response.error())));
});
