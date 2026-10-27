// SVGCraft — The service worker: SVGCraft works offline once it has been
// opened, and can be installed as an app (see manifest.webmanifest).
//
// Network first: online, every file comes fresh (so a new version never
// mixes with old scripts) and the copy kept here is updated; offline, the
// kept copy is used. Installing keeps everything index.html loads, read
// from its src / href attributes, so there's no list to keep in step.
'use strict';

const CACHE = 'svgcraft-v1';

self.addEventListener('install', (e) => {
  e.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      const html = await (await fetch('index.html', { cache: 'no-cache' })).text();
      const files = [...html.matchAll(/\b(?:src|href)="([^"#:]+)"/g)].map((m) => m[1]);
      const urls = [
        ...new Set([
          './',
          'index.html',
          'about.html',
          'help.html',
          'manifest.webmanifest',
          ...files,
        ]),
      ];
      // One missing file mustn't stop the rest being kept.
      await Promise.allSettled(urls.map((u) => cache.add(u)));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // This app's files, and the Google Fonts it uses.
  const fonts = /^fonts\.(googleapis|gstatic)\.com$/.test(url.hostname);
  if (url.origin !== location.origin && !fonts) return;
  e.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      try {
        const res = await fetch(req);
        if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
        return res;
      } catch (err) {
        const kept =
          (await cache.match(req, { ignoreSearch: true })) ||
          (req.mode === 'navigate' && (await cache.match('index.html')));
        if (kept) return kept;
        throw err;
      }
    })(),
  );
});
