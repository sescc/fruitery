// @ts-check
// App-shell service worker. Caches only the static shell listed below (never /api/*, redirects,
// error responses or cross-origin responses, so Access login pages can never be served from cache).
// The one exception is a site icon (D116): a cross-origin "/favicon.ico" image request is answered cache-first
// from its own cache, "fruitery-icons", for about 30 days. Nothing else cross-origin is ever cached.
// The build replaces the version placeholder with a content hash and appends the core module list.

/** @type {ServiceWorkerGlobalScope} */
// @ts-ignore: the worker global
const sw = self;

const VERSION = '__BUILD_VERSION__';
const CACHE = `fruitery-shell-${VERSION}`;
const SHELL = [
  '/',
  '/app.js',
  '/view.js',
  '/editor.js',
  '/editor-model.js',
  '/styles.css',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  ...(/*__SHELL_EXTRA__*/ []),
];

/**
 * Only a plain, successful, same-origin answer may be cached or served from the cache.
 * @param {Response} res
 * @returns {boolean}
 */
function cacheable(res) {
  return res.status === 200 && res.type === 'basic' && !res.redirected;
}

// ----- site icons (D116) -----
const ICON_CACHE = 'fruitery-icons';
const ICON_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const ICON_MAX_ENTRIES = 200;
/** Sidecar entries (synthetic same-origin keys, never fetched) hold when each icon was stored: an opaque response has no readable headers. */
const ICON_STAMP = '/__icon-stamp/';

/**
 * Only this request is an icon request: a GET of an image, to another origin, over https, for /favicon.ico.
 * @param {Request} request
 * @param {URL} url
 * @returns {boolean}
 */
function isIconRequest(request, url) {
  return request.method === 'GET' && request.destination === 'image' && url.protocol === 'https:' && url.origin !== sw.location.origin && url.pathname === '/favicon.ico';
}

/** @param {string} key @returns {string} */
const stampKey = (key) => ICON_STAMP + encodeURIComponent(key);

/**
 * When an icon was stored (epoch ms), or null.
 * @param {Cache} cache
 * @param {string} key
 * @returns {Promise<number | null>}
 */
async function storedAt(cache, key) {
  try {
    const res = await cache.match(stampKey(key));
    const n = res ? Number(await res.text()) : NaN;
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/**
 * Keep at most ICON_MAX_ENTRIES icons: the oldest go first.
 * @param {Cache} cache
 */
async function pruneIcons(cache) {
  const keys = (await cache.keys()).map((r) => r.url);
  const icons = keys.filter((k) => !new URL(k).pathname.startsWith(ICON_STAMP));
  if (icons.length <= ICON_MAX_ENTRIES) return;
  const aged = await Promise.all(icons.map(async (k) => ({ k, at: (await storedAt(cache, k)) ?? 0 })));
  aged.sort((a, b) => a.at - b.at);
  for (const { k } of aged.slice(0, icons.length - ICON_MAX_ENTRIES)) {
    await cache.delete(k);
    await cache.delete(stampKey(k));
  }
}

/**
 * Cache-first, about 30 days. A miss or an expired entry is fetched with the ORIGINAL request (so its
 * no-referrer policy and no-credentials mode are kept); the answer is stored when it is opaque (an
 * image of another origin cannot be read) or a plain success. A stale entry is served when the refetch
 * fails. A failing cache write (quota) never stops the image from showing.
 * @param {Request} request
 * @returns {Promise<Response>}
 */
async function iconResponse(request) {
  const key = request.url;
  /** @type {Cache | null} */
  let cache = null;
  try {
    cache = await caches.open(ICON_CACHE);
  } catch {
    return fetch(request);
  }
  /** @type {Response | undefined} */
  let hit;
  try {
    hit = await cache.match(key, { ignoreVary: true });
  } catch {
    hit = undefined;
  }
  const now = Date.now();
  if (hit) {
    const at = await storedAt(cache, key);
    if (at !== null && now - at >= 0 && now - at < ICON_MAX_AGE_MS) return hit;
  }
  try {
    const res = await fetch(request);
    if (res.type === 'opaque' || res.ok) {
      try {
        await cache.put(key, res.clone());
        await cache.put(stampKey(key), new Response(String(now)));
        await pruneIcons(cache);
      } catch {
        // quota or storage trouble: the image still shows
      }
    }
    return res;
  } catch {
    return hit ?? Response.error();
  }
}
sw.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      for (const url of SHELL) {
        // 'reload' bypasses the HTTP cache; 'error' fails the install on an Access redirect
        const res = await fetch(new Request(url, { cache: 'reload', redirect: 'error' }));
        if (!cacheable(res)) throw new Error(`not cacheable: ${url}`);
        await cache.put(url, res);
      }
      await sw.skipWaiting();
    })(),
  );
});

sw.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key.startsWith('fruitery-shell-') && key !== CACHE) await caches.delete(key);
      await sw.clients.claim();
    })(),
  );
});

sw.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (isIconRequest(request, url)) {
    event.respondWith(iconResponse(request));
    return;
  }
  if (url.origin !== sw.location.origin) return;
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return; // network only: no respondWith

  if (request.mode === 'navigate') {
    // network first; the cached page ('/' = index.html, which the assets layer redirects /index.html to) is only a fallback for a network error
    event.respondWith(
      fetch(request).catch(async () => (await caches.match('/', { cacheName: CACHE })) ?? Response.error()),
    );
    return;
  }

  if (SHELL.includes(url.pathname)) {
    event.respondWith(
      (async () => (await caches.match(request, { cacheName: CACHE, ignoreSearch: true })) ?? fetch(request))(),
    );
  }
});
