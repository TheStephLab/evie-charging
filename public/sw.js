// App-shell cache so EVIE opens instantly (and shows last-known state) on flaky office Wi-Fi.
// Paths are relative to the service worker, so this works at / and under /Evie/ on GitHub Pages.
const CACHE = 'hub-v7';
const SHELL = ['./', 'charging.html', 'visitor.html', 'settings.html', 'hub.js', 'visitor-page.js', 'visitor-data.js', 'visitor.js', 'app.js', 'backend.js', 'shell.js', 'theme.js', 'settings-page.js', 'scheduler.js', 'settings.js', 'tokens.css', 'styles.css', 'manifest.webmanifest', 'icon.svg', 'fonts/Roboto-Regular.ttf', 'fonts/Roboto-Medium.ttf'];
const scope = () => new URL(self.registration.scope);

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.includes('/api/')) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(async () => {
        const sticker = e.request.mode === 'navigate' && url.pathname.match(/\/c\/(\d{1,2})\/?$/);
        if (sticker) return Response.redirect(new URL(`./charging.html?charger=${sticker[1]}`, scope()).href, 302);
        return (await caches.match(e.request, { ignoreSearch: e.request.mode === 'navigate' })) || caches.match(new URL('./', scope()).href);
      }),
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((list) => (list[0] ? list[0].focus() : self.clients.openWindow(scope().href))),
  );
});
