const CACHE_NAME = 'oaab-library-runtime-v3';
const CACHE_PREFIX = 'oaab-library-runtime-';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (!isRuntimeAsset(url)) return;
  event.respondWith(isApplicationCode(url) ? networkFirst(request) : cacheFirst(request));
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (cacheable(response)) await cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw error;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (cacheable(response)) await cache.put(request, response.clone());
  return response;
}

function cacheable(response) {
  return response.ok || response.type === 'opaque';
}

function isApplicationCode(url) {
  return url.origin === self.location.origin && (
    url.pathname.startsWith('/src/library/') ||
    url.pathname.startsWith('/wasm/pkg/') ||
    url.pathname.startsWith('/library/')
  );
}

function isRuntimeAsset(url) {
  if (isApplicationCode(url)) return true;
  if (url.origin === self.location.origin && url.pathname.startsWith('/library/')) return true;
  return /(?:cdn\.jsdelivr\.net\/gh\/OAAB-Modding\/Data|raw\.githubusercontent\.com\/OAAB-Modding\/Data)/i.test(url.href)
    && /\.(?:nif|dds|tga|bmp|png|jpe?g)$/i.test(url.pathname);
}
