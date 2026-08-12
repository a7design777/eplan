/**
 * Service worker: оболонка застосунку офлайн.
 *
 * Планування маршруту офлайн неможливе — воно потребує і рушія, і бази станцій.
 * Тому кешуємо тільки оболонку й довідники (авто, мережі), щоб застосунок
 * відкривався в дорозі без мережі й показував збережене, а не білий екран.
 */
const SHELL_CACHE = 'eplan-shell-v1';
const DATA_CACHE = 'eplan-data-v1';

// Довідники змінюються рідко — їх не соромно віддати з кешу, коли мережі немає.
const CACHEABLE_API = ['/api/vehicles', '/api/networks'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(['/', '/manifest.webmanifest'])),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== SHELL_CACHE && k !== DATA_CACHE)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Чужі домени (тайли, геокодування) не чіпаємо: вони мають власні правила
  // кешування, а нам не варто роздувати сховище картинками пів Європи.
  if (url.origin !== self.location.origin) return;

  if (CACHEABLE_API.includes(url.pathname)) {
    // Мережа перша: дані свіжі, поки є зв'язок.
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(DATA_CACHE).then((c) => c.put(request, copy));
          return res;
        })
        .catch(() => caches.match(request).then((r) => r ?? Response.error())),
    );
    return;
  }

  // Решта API — тільки мережа: план і сесія з кешу лише зашкодять.
  if (url.pathname.startsWith('/api/')) return;

  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ??
        fetch(request)
          .then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(SHELL_CACHE).then((c) => c.put(request, copy));
            }
            return res;
          })
          .catch(() => caches.match('/').then((r) => r ?? Response.error())),
    ),
  );
});
