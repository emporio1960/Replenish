/* Replenish service worker: keeps the app shell available offline. */
const CACHE = 'replenish-v1';

async function precache() {
  const cache = await caches.open(CACHE);
  const res = await fetch('./', { cache: 'no-cache' });
  if (!res.ok) return;
  const html = await res.clone().text();
  await cache.put('./', res);
  const urls = new Set(['./manifest.webmanifest', './favicon.svg', './icon-192.png']);
  for (const m of html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)) urls.add(m[1]);
  await Promise.all(
    [...urls].map(async (u) => {
      const url = new URL(u, self.registration.scope).href;
      try {
        const r = await fetch(url);
        if (!r.ok) return;
        await cache.put(url, r.clone());
        // Fonts are referenced from the stylesheet, so follow those too.
        if (url.endsWith('.css')) {
          const css = await r.text();
          for (const f of css.matchAll(/url\(([^)]+\.woff2)\)/g)) {
            const font = new URL(f[1].replace(/["']/g, ''), url).href;
            const fr = await fetch(font);
            if (fr.ok) await cache.put(font, fr);
          }
        }
      } catch {
        /* offline during install: the file is cached when first used instead */
      }
    }),
  );
}

self.addEventListener('install', (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  // Pages: try the network first so updates arrive, fall back to the saved copy offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) caches.open(CACHE).then((c) => c.put('./', res.clone()));
          return res.clone();
        })
        .catch(() => caches.match('./').then((hit) => hit || Response.error())),
    );
    return;
  }

  // Everything else (hashed scripts, styles, fonts, icons): saved copy first.
  event.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((list) => (list[0] ? list[0].focus() : self.clients.openWindow('./'))),
  );
});
