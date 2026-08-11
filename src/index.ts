import { Hono } from 'hono';
import vehicles from '../data/vehicles.json';
import { currentUser, createSession, destroySession, requireAuth, type AuthUser } from './auth/session';
import { hashPassword, verifyPassword } from './auth/password';
import { parseCredentials, parsePlanRequest, ValidationError } from './api/validate';
import { plan } from './routing/planner';
import { ValhallaProvider } from './routing/valhalla';
import { importStations } from './stations/import';
import type { Env, Vehicle } from './types';

type App = { Bindings: Env; Variables: { user: AuthUser } };

const app = new Hono<App>();
const api = new Hono<App>();

api.onError((err, c) => {
  if (err instanceof ValidationError) return c.json({ error: err.message }, 400);
  console.error('API error', err);
  return c.json({ error: err.message || 'Внутрішня помилка' }, 500);
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

api.post('/plan', async (c) => {
  const req = parsePlanRequest(await c.req.json());
  const provider = new ValhallaProvider(c.env);
  const result = await plan(c.env, provider, req);
  return c.json(result);
});

// --- Авторизація ---

api.post('/auth/register', async (c) => {
  const { email, password } = parseCredentials(await c.req.json());

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
  const { email, password } = parseCredentials(await c.req.json());
  const user = await c.env.DB.prepare('SELECT id, email, password_hash FROM users WHERE email = ?')
    .bind(email)
    .first<{ id: string; email: string; password_hash: string }>();

  // Однакова відповідь для «немає користувача» і «невірний пароль» — щоб не
  // можна було перебором з'ясувати, які email зареєстровані.
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return c.json({ error: 'Невірний email або пароль' }, 401);
  }

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
