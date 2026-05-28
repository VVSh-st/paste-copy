'use strict';

const SW_VERSION = 'llm-monitor-sw-v3';
const APP_CACHE = `llm-monitor-app-${SW_VERSION}`;
const APP_SHELL = [
  './',
  './index.html'
];

self.addEventListener('install', (event) => {
  // Кэшируем только оболочку приложения. API-запросы LLM намеренно не кэшируем.
  event.waitUntil((async () => {
    const cache = await caches.open(APP_CACHE);

    for (const url of APP_SHELL) {
      try {
        await cache.add(url);
      } catch (error) {
        console.warn('[sw] shell cache failed:', url, error);
      }
    }

    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  // Чистим старые версии кэша, чтобы sw.js не копил мусор.
  event.waitUntil((async () => {
    const keys = await caches.keys();

    await Promise.all(keys.map((key) => {
      if (key.startsWith('llm-monitor-app-') && key !== APP_CACHE) {
        return caches.delete(key);
      }

      return Promise.resolve();
    }));

    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type !== 'SW_PING') return;

  event.ports?.[0]?.postMessage({
    type: 'SW_PONG',
    version: SW_VERSION,
    time: new Date().toISOString()
  });
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (url.origin !== location.origin) {
    // Важно: service worker не превращает браузер в системный proxy.
    // Cross-origin API-запросы не кэшируем и не подменяем.
    return;
  }

  if (request.method !== 'GET') {
    return;
  }

  if (url.pathname.endsWith('/sw-health')) {
    event.respondWith(new Response(JSON.stringify({
      ok: true,
      version: SW_VERSION,
      time: new Date().toISOString()
    }), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store'
      }
    }));
    return;
  }

  event.respondWith((async () => {
    try {
      const response = await fetch(request);

      if (response.ok && isAppShellRequest(request)) {
        const cache = await caches.open(APP_CACHE);
        cache.put(request, response.clone());
      }

      return response;
    } catch (error) {
      const cached = await caches.match(request);

      if (cached) {
        return cached;
      }

      if (request.mode === 'navigate') {
        const fallback = await caches.match('./index.html');
        if (fallback) return fallback;
      }

      throw error;
    }
  })());
});

function isAppShellRequest(request) {
  const url = new URL(request.url);

  return (
    url.pathname === '/' ||
    url.pathname.endsWith('/index.html') ||
    url.pathname.endsWith('/sw.js')
  );
}