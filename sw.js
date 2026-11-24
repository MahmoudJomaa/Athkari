const V = 'zakeroon-v7';
const SHELL = ['./', './index.html', './manifest.json', './icon.svg', './icon-192.png', './icon-512.png', './apple-touch-icon.png'];

self.addEventListener('install', e => {
  // cache:'reload' skips the browser's HTTP cache so a new version always caches fresh files
  e.waitUntil(caches.open(V).then(c => Promise.all(SHELL.map(u => c.add(new Request(u, { cache: 'reload' })).catch(() => {})))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const ok = url.origin === location.origin || /fonts\.(googleapis|gstatic)\.com$/.test(url.hostname);
  if (!ok) return;

  // Pages: network first (always the latest version when online), cache only when offline
  if (req.mode === 'navigate') {
    e.respondWith(caches.open(V).then(c =>
      fetch(req, { cache: 'no-cache' }).then(res => {
        if (res && res.ok) c.put('./index.html', res.clone());
        return res;
      }).catch(async () => (await c.match(req, { ignoreSearch: true })) || (await c.match('./index.html')))
    ));
    return;
  }

  // Other files: serve from cache, refresh in the background
  e.respondWith(caches.open(V).then(async c => {
    const hit = await c.match(req);
    const net = fetch(req).then(res => {
      if (res && (res.ok || res.type === 'opaque')) c.put(req, res.clone());
      return res;
    }).catch(() => hit);
    return hit || net;
  }));
});

// Tapping a reminder notification opens (or focuses) the app on the right page
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
    const c = cs.find(w => w.url.startsWith(self.registration.scope));
    if (c) return c.focus().then(w => (w || c).navigate(url)).catch(() => self.clients.openWindow(url));
    return self.clients.openWindow(url);
  }));
});

// Reminder sent from the server (GitHub Actions -> Firebase Cloud Messaging) while the app is closed
self.addEventListener('push', e => {
  let p = {};
  try { p = e.data ? e.data.json() : {}; } catch (_) {}
  const d = p.data || p;
  e.waitUntil(self.registration.showNotification(d.title || 'ذاكرون', {
    body: d.body || '', icon: 'icon-192.png', badge: 'icon-192.png',
    tag: d.tag || 'zk', lang: 'ar', dir: 'rtl', data: { url: d.url || './' }
  }));
});
