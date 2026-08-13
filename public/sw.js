/**
 * Service worker: оболонка застосунку офлайн.
 *
 * Планування маршруту офлайн неможливе — воно потребує і рушія, і бази станцій.
 * Тому кешуємо тільки оболонку й довідники (авто, мережі), щоб застосунок
 * відкривався в дорозі без мережі й показував збережене, а не білий екран.
 *
 * ВАЖЛИВО про HTML: він іде «спершу мережа». Кеш-первий HTML — це пастка:
 * index.html посилається на бандл з хешем у назві, після деплою старий бандл
 * з сервера зникає, і застосунок намертво ламається у всіх, хто вже заходив.
 * Самі ж бандли навпаки безпечно брати з кешу — їхні імена унікальні.
 */
const SHELL_CACHE = 'eplan-shell-v3';
const DATA_CACHE = 'eplan-data-v3';

// Довідники змінюються рідко — їх не соромно віддати з кешу, коли мережі немає.
const CACHEABLE_API = ['/api/vehicles', '/api/networks'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.add('/manifest.webmanifest')));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== SHELL_CACHE && k !== DATA_CACHE).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

/**
 * Чи можна класти цю відповідь у кеш під цією адресою.
 *
 * SPA-фолбек віддає index.html зі статусом 200 на будь-який неіснуючий шлях.
 * Якщо таке закешувати під адресою скрипта, воно застрягне назавжди: браузер
 * відмовиться виконувати HTML як модуль, і полагодити сервер вже не допоможе.
 * Саме так у нас «зник» воркер MapLibre, а з ним і лінія маршруту.
 */
function cacheable(request, response) {
  if (!response.ok) return false;
  if (request.mode === 'navigate') return true;
  return !(response.headers.get('content-type') ?? '').includes('text/html');
}

/** Мережа перша, кеш — запасний варіант. */
async function networkFirst(request, cacheName) {
  try {
    const res = await fetch(request);
    if (cacheable(request, res)) {
      const copy = res.clone();
      caches.open(cacheName).then((c) => c.put(request, copy));
    }
    return res;
  } catch (err) {
    const cached = await caches.match(request);
    if (cached) return cached;
    throw err;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Чужі домени (тайли, геокодування) не чіпаємо: вони мають власні правила
  // кешування, а нам не варто роздувати сховище картинками пів Європи.
  if (url.origin !== self.location.origin) return;

  // Перехід на сторінку: завжди пробуємо мережу, щоб підхопити свіжий деплой.
  if (request.mode === 'navigate') {
    event.respondWith(
      networkFirst(request, SHELL_CACHE).catch(() =>
        caches.match('/').then((r) => r ?? Response.error()),
      ),
    );
    return;
  }

  if (CACHEABLE_API.includes(url.pathname)) {
    event.respondWith(networkFirst(request, DATA_CACHE));
    return;
  }

  // Решта API — тільки мережа: план і сесія з кешу лише зашкодять.
  if (url.pathname.startsWith('/api/')) return;

  // Статика з хешем у назві незмінна — її можна сміливо брати з кешу.
  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ??
        fetch(request).then((res) => {
          if (cacheable(request, res)) {
            const copy = res.clone();
            caches.open(SHELL_CACHE).then((c) => c.put(request, copy));
          }
          return res;
        }),
    ),
  );
});
