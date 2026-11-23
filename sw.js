// GPX TopoPrint : service worker de la version web (GitHub Pages).
// Réseau d'abord pour les fichiers de l'appli, avec repli sur le cache hors ligne.
// Les tuiles de carte (autres domaines : IGN, OpenTopoMap, CyclOSM) ne sont pas interceptées.
const CACHE = 'gpx-topoprint-v1';
const APP_FILES = ['./', './index.html', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(APP_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() =>
        caches.match(request, { ignoreSearch: true }).then((hit) =>
          hit || (request.mode === 'navigate' ? caches.match('./index.html') : Response.error()),
        ),
      ),
  );
});
