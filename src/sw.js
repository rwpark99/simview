const V = 'simview-v1.0.3'; const ASSETS = ['./', './index.html', './app.js', './manifest.webmanifest', './icon-192.png', './icon-512.png', './pdf.min.mjs', './pdf.worker.min.mjs'];
self.addEventListener('install', e => { e.waitUntil(caches.open(V).then(c => c.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' }))))); self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V && k !== 'simview-share').map(k => caches.delete(k))))); self.clients.claim(); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method === 'POST' && u.pathname.endsWith('/share')) {
    e.respondWith((async () => { const f = (await e.request.formData()).get('file');
      if (f) await (await caches.open('simview-share')).put('/shared-file', new Response(f, { headers: { 'x-name': encodeURIComponent(f.name || 'shared.hwp') } }));
      return Response.redirect('./?shared=1', 303); })()); return;
  }
  if (u.pathname.endsWith('/version.json')) { e.respondWith(fetch(e.request, { cache: 'no-store' })); return; }
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(r => r || fetch(e.request)));
});
self.addEventListener('message', e => { if (e.data === 'skip') self.skipWaiting(); });
