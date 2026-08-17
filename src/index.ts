import { Hono } from 'hono';
import vehicles from '../data/vehicles.json';
import { currentUser, createSession, destroySession, requireAuth, type AuthUser } from './auth/session';
import { hashPassword, verifyPassword } from './auth/password';
import { checkAttempts, clearAttempts } from './auth/throttle';
import {
  parseCredentials,
  parsePlanRequest,
  parseUserPrefs,
  ValidationError,
} from './api/validate';
import { plan } from './routing/planner';
import { planCacheKey, readPlanCache, writePlanCache } from './routing/plan-cache';
import { ValhallaProvider } from './routing/valhalla';
import { temperatureAt } from './routing/weather';
import { importStations } from './stations/import';
import { stationsInBbox } from './stations/query';
import type { Env, PlanRequest, Vehicle } from './types';

type App = { Bindings: Env; Variables: { user: AuthUser } };

const app = new Hono<App>();
const api = new Hono<App>();

/**
 * Перетворює помилку на текст, зрозумілий людині.
 *
 * Спільне для звичайного і стрімового планування: у стрімі статус відповіді
 * змінити вже пізно, тому пояснення має бути в самому повідомленні.
 * Повертає null, якщо це не відома нам помилка.
 */
function describePlanError(err: Error): string {
  const message = err.message ?? '';
  if (!message.startsWith('Valhalla')) return message || 'Внутрішня помилка';

  // Частина відмов рушія постійні: чекати й повторювати безглуздо, треба
  // міняти сам запит. Радити «спробуйте за хвилину» там — знущання.
  if (/max distance|distance exceeds/i.test(message)) {
    return (
      'Маршрут задовгий для сервісу маршрутизації. Розбийте поїздку на кілька ' +
      'частин — додайте проміжну точку десь посередині.'
    );
  }
  if (/no suitable edge|no path|not found/i.test(message)) {
    return (
      'Не вдалося прокласти дорогу між цими точками. Перевірте, що вони на суходолі ' +
      'й біля проїзної дороги, або перенесіть їх ближче до траси.'
    );
  }
  return `Сервіс маршрутизації не відповів: ${message}. Це безкоштовний публічний сервер — спробуйте за хвилину.`;
}

/** Постійні відмови — це помилка запиту (400), тимчасові — шлюзу (502). */
function isPermanentRoutingError(message: string): boolean {
  return /max distance|distance exceeds|no suitable edge|no path|not found/i.test(message);
}

api.onError((err, c) => {
  if (err instanceof ValidationError) return c.json({ error: err.message }, 400);

  // Биті дані — це помилка запиту, а не сервера. Текст парсера JS назовні
  // віддавати теж ні до чого: користувачу він нічого не пояснює.
  if (err instanceof SyntaxError) {
    return c.json({ error: 'Тіло запиту не є коректним JSON' }, 400);
  }

  console.error('API error', c.req.path, err);

  const message = err.message ?? '';
  if (message.startsWith('Valhalla')) {
    return c.json(
      { error: describePlanError(err) },
      isPermanentRoutingError(message) ? 400 : 502,
    );
  }
  return c.json({ error: message || 'Внутрішня помилка' }, 500);
});

api.get('/vehicles', (c) => c.json(vehicles as Vehicle[]));

api.get('/networks', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT n.id, n.name, COUNT(s.id) AS station_count
     FROM networks n JOIN stations s ON s.network_id = n.id
     GROUP BY n.id HAVING station_count > 0
     ORDER BY station_count DESC`,
  ).all();
  return c.json(results ?? []);
});

/** Геокодування через Photon (безкоштовний, без ключа), з кешем у KV. */
api.get('/geocode', async (c) => {
  const q = (c.req.query('q') ?? '').trim();
  if (q.length < 2) return c.json([]);

  const key = `geocode:${q.toLowerCase()}`;
  const cached = await c.env.CACHE.get(key, 'json');
  if (cached) return c.json(cached);

  const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=6&lang=en`;
  const res = await fetch(url, { headers: { 'User-Agent': 'eplan (e.car-ua.com)' } });
  if (!res.ok) return c.json({ error: 'Сервіс геокодування недоступний' }, 502);

  const data = (await res.json()) as {
    features?: { geometry: { coordinates: [number, number] }; properties: Record<string, string> }[];
  };
  const out = (data.features ?? []).map((f) => ({
    lon: f.geometry.coordinates[0],
    lat: f.geometry.coordinates[1],
    name: [f.properties.name, f.properties.city, f.properties.state, f.properties.country]
      .filter((v, i, arr) => v && arr.indexOf(v) === i)
      .join(', '),
  }));

  await c.env.CACHE.put(key, JSON.stringify(out), { expirationTtl: 30 * 24 * 3600 });
  return c.json(out);
});

/** Зворотне геокодування: клік по мапі → людська назва точки. */
api.get('/reverse', async (c) => {
  const lat = Number(c.req.query('lat'));
  const lon = Number(c.req.query('lon'));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return c.json({ error: 'Потрібні координати lat і lon' }, 400);
  }

  // Округлення до ~100 м: сусідні кліки по одному місцю б'ють в один запис кешу.
  const key = `reverse:${lat.toFixed(3)},${lon.toFixed(3)}`;
  const cached = await c.env.CACHE.get(key, 'json');
  if (cached) return c.json(cached);

  const url = `https://photon.komoot.io/reverse?lat=${lat}&lon=${lon}&lang=en`;
  const res = await fetch(url, { headers: { 'User-Agent': 'eplan (e.car-ua.com)' } });

  // Без назви точка все одно придатна — покажемо координати.
  const fallback = { lat, lon, name: `${lat.toFixed(4)}, ${lon.toFixed(4)}` };
  if (!res.ok) return c.json(fallback);

  const data = (await res.json()) as {
    features?: { properties: Record<string, string> }[];
  };
  const props = data.features?.[0]?.properties;
  const name = props
    ? [props.name, props.street, props.city, props.state, props.country]
        .filter((v, i, arr) => v && arr.indexOf(v) === i)
        .join(', ')
    : '';

  const out = name ? { lat, lon, name } : fallback;
  await c.env.CACHE.put(key, JSON.stringify(out), { expirationTtl: 30 * 24 * 3600 });
  return c.json(out);
});

/** Станції у видимій частині мапи — для шару «показати мережі». */
api.get('/stations', async (c) => {
  const q = c.req.query();
  const nums = ['minLat', 'maxLat', 'minLon', 'maxLon'].map((k) => Number(q[k]));
  if (nums.some((n) => !Number.isFinite(n))) {
    return c.json({ error: 'Потрібні межі minLat, maxLat, minLon, maxLon' }, 400);
  }
  const [minLat, maxLat, minLon, maxLon] = nums as [number, number, number, number];

  // Занадто велика область — це десятки тисяч точок і марний трафік.
  if ((maxLat - minLat) * (maxLon - minLon) > 60) {
    return c.json({ error: 'Завелика область — наблизьте мапу', tooWide: true }, 400);
  }

  // Порожній параметр означає «усі мережі». Без відсіювання порожніх рядків
  // Number('') дасть 0 і вибірка звузиться до неіснуючої мережі з id 0.
  const networkIds = (q.networks ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v !== '')
    .map((v) => Number(v))
    .filter((v) => Number.isFinite(v) && v > 0);

  // Запитуємо на одну більше за ліміт: якщо прийшла — станцій більше, ніж
  // показуємо, і про це треба сказати, а не мовчки обрізати.
  const limit = 400;
  const rows = await stationsInBbox(c.env, {
    minLat,
    maxLat,
    minLon,
    maxLon,
    networkIds,
    minPowerKw: Number.isFinite(Number(q.minPowerKw)) ? Number(q.minPowerKw) : 50,
    freeOnly: q.freeOnly === '1',
    limit: limit + 1,
  });

  const truncated = rows.length > limit;
  return c.json({ stations: truncated ? rows.slice(0, limit) : rows, truncated, limit });
});

/** Підставляє реальну температуру, якщо користувач не задав її вручну. */
async function withLiveWeather(env: Env, req: PlanRequest): Promise<PlanRequest> {
  if (!req.filters.useLiveWeather) return req;
  const mid = req.waypoints[Math.floor(req.waypoints.length / 2)]!;
  const live = await temperatureAt(env, mid);
  if (live !== null) req.filters.temperatureC = live;
  return req;
}

api.post('/plan', async (c) => {
  const req = await withLiveWeather(c.env, parsePlanRequest(await c.req.json()));

  const key = await planCacheKey(req);
  const cached = await readPlanCache(c.env, key);
  if (cached) return c.json(cached);

  const provider = new ValhallaProvider(c.env);
  const result = await plan(c.env, provider, req);
  const payload = { ...result, temperatureC: req.filters.temperatureC };

  c.executionCtx.waitUntil(writePlanCache(c.env, key, payload));
  return c.json(payload);
});

/**
 * Те саме планування, але з етапами.
 *
 * Довгий маршрут рахується кілька секунд, і мовчазна крутилка не каже нічого.
 * Стрім віддає реальні етапи — не вигаданий відсоток прогресу, а те, що
 * справді відбувається зараз.
 */
api.post('/plan/stream', async (c) => {
  const req = await withLiveWeather(c.env, parsePlanRequest(await c.req.json()));
  const key = await planCacheKey(req);
  const env = c.env;

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (obj: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));

      try {
        const cached = await readPlanCache(env, key);
        if (cached) {
          send({ stage: 'cached' });
          send({ result: cached });
          controller.close();
          return;
        }

        const provider = new ValhallaProvider(env);
        const result = await plan(env, provider, req, (stage) => send({ stage }));
        const payload = { ...result, temperatureC: req.filters.temperatureC };

        await writePlanCache(env, key, payload);
        send({ result: payload });
      } catch (err) {
        // Помилку теж треба донести: стрім уже почався, і статус змінити пізно.
        send({ error: describePlanError(err as Error) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
    },
  });
});

// --- Авторизація ---

const TOO_MANY = 'Забагато спроб. Спробуйте за 15 хвилин.';

api.post('/auth/register', async (c) => {
  const gate = await checkAttempts(c.env, c.req.raw, 'register');
  if (!gate.allowed) return c.json({ error: TOO_MANY }, 429);

  const body = (await c.req.json()) as { inviteCode?: unknown };
  const { email, password } = parseCredentials(body);

  // Поки код заданий у секретах — реєстрація тільки за ним.
  if (c.env.INVITE_CODE) {
    const given = typeof body.inviteCode === 'string' ? body.inviteCode.trim() : '';
    if (given !== c.env.INVITE_CODE) {
      return c.json({ error: 'Потрібен код запрошення', inviteRequired: true }, 403);
    }
  }

  const existing = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?')
    .bind(email)
    .first();
  if (existing) return c.json({ error: 'Такий email вже зареєстровано' }, 409);

  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    'INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)',
  )
    .bind(id, email, await hashPassword(password), Math.floor(Date.now() / 1000))
    .run();

  await createSession(c, id);
  return c.json({ id, email });
});

api.post('/auth/login', async (c) => {
  const gate = await checkAttempts(c.env, c.req.raw, 'login');
  if (!gate.allowed) return c.json({ error: TOO_MANY }, 429);

  const { email, password } = parseCredentials(await c.req.json());
  const user = await c.env.DB.prepare('SELECT id, email, password_hash FROM users WHERE email = ?')
    .bind(email)
    .first<{ id: string; email: string; password_hash: string }>();

  // Однакова відповідь для «немає користувача» і «невірний пароль» — щоб не
  // можна було перебором з'ясувати, які email зареєстровані.
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return c.json({ error: 'Невірний email або пароль' }, 401);
  }

  await clearAttempts(c.env, c.req.raw, 'login');
  await createSession(c, user.id);
  return c.json({ id: user.id, email: user.email });
});

api.post('/auth/logout', async (c) => {
  await destroySession(c);
  return c.json({ ok: true });
});

api.get('/auth/me', async (c) => {
  const user = await currentUser(c);
  return user ? c.json(user) : c.json({ error: 'Не авторизовано' }, 401);
});

// --- Налаштування користувача ---

api.get('/prefs', requireAuth, async (c) => {
  const row = await c.env.DB.prepare('SELECT prefs_json FROM user_prefs WHERE user_id = ?')
    .bind(c.get('user').id)
    .first<{ prefs_json: string }>();

  // Порожні налаштування — не помилка, просто користувач ще нічого не міняв.
  if (!row) return c.json(null);
  return c.json(JSON.parse(row.prefs_json));
});

api.put('/prefs', requireAuth, async (c) => {
  const prefs = parseUserPrefs(await c.req.json());
  await c.env.DB.prepare(
    'INSERT OR REPLACE INTO user_prefs (user_id, prefs_json, updated_at) VALUES (?, ?, ?)',
  )
    .bind(c.get('user').id, JSON.stringify(prefs), Math.floor(Date.now() / 1000))
    .run();
  return c.json({ ok: true });
});

// --- Збережені маршрути ---

api.get('/routes', requireAuth, async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT id, name, created_at, updated_at FROM saved_routes WHERE user_id = ? ORDER BY updated_at DESC LIMIT 100',
  )
    .bind(c.get('user').id)
    .all();
  return c.json(results ?? []);
});

api.get('/routes/:id', requireAuth, async (c) => {
  const row = await c.env.DB.prepare(
    'SELECT id, name, request_json, plan_json, created_at, updated_at FROM saved_routes WHERE id = ? AND user_id = ?',
  )
    .bind(c.req.param('id'), c.get('user').id)
    .first<{ id: string; name: string; request_json: string; plan_json: string | null }>();

  if (!row) return c.json({ error: 'Маршрут не знайдено' }, 404);
  return c.json({
    id: row.id,
    name: row.name,
    request: JSON.parse(row.request_json),
    plan: row.plan_json ? JSON.parse(row.plan_json) : null,
  });
});

api.post('/routes', requireAuth, async (c) => {
  const body = (await c.req.json()) as { name?: unknown; request?: unknown; plan?: unknown };
  const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 120) : null;
  if (!name) throw new ValidationError('Вкажіть назву маршруту');

  // Прогін через валідатор — у БД не має потрапляти те, що потім не розпланується.
  const request = parsePlanRequest(body.request);

  const id = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  await c.env.DB.prepare(
    'INSERT INTO saved_routes (id, user_id, name, request_json, plan_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(
      id,
      c.get('user').id,
      name,
      JSON.stringify(request),
      body.plan ? JSON.stringify(body.plan) : null,
      now,
      now,
    )
    .run();

  return c.json({ id, name });
});

api.patch('/routes/:id', requireAuth, async (c) => {
  const body = (await c.req.json()) as { name?: unknown };
  const name =
    typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 120) : null;
  if (!name) throw new ValidationError('Вкажіть назву маршруту');

  const res = await c.env.DB.prepare(
    'UPDATE saved_routes SET name = ?, updated_at = ? WHERE id = ? AND user_id = ?',
  )
    .bind(name, Math.floor(Date.now() / 1000), c.req.param('id'), c.get('user').id)
    .run();

  if (res.meta.changes === 0) return c.json({ error: 'Маршрут не знайдено' }, 404);
  return c.json({ ok: true, name });
});

api.delete('/routes/:id', requireAuth, async (c) => {
  const res = await c.env.DB.prepare('DELETE FROM saved_routes WHERE id = ? AND user_id = ?')
    .bind(c.req.param('id'), c.get('user').id)
    .run();
  if (res.meta.changes === 0) return c.json({ error: 'Маршрут не знайдено' }, 404);
  return c.json({ ok: true });
});

app.route('/api', api);
app.all('/api/*', (c) => c.json({ error: 'Невідомий ендпоінт' }, 404));

// Все інше віддає SPA зі static assets.
app.get('*', (c) => c.env.ASSETS.fetch(c.req.raw));

export default {
  fetch: app.fetch,

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      importStations(env)
        .then((r) => console.log(`Оновлено станцій: ${r.updated} (з ${r.since})`))
        .catch((e) => console.error('Помилка імпорту станцій', e)),
    );
  },
} satisfies ExportedHandler<Env>;
