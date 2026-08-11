import type { Context, MiddlewareHandler } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { Env } from '../types';

const COOKIE_NAME = 'eplan_session';
const SESSION_TTL_S = 30 * 24 * 3600;

export interface AuthUser {
  id: string;
  email: string;
}

type AppContext = { Bindings: Env; Variables: { user: AuthUser } };

const toHex = (buf: ArrayBuffer): string =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

/** У БД лежить хеш токена, а не сам токен — витік дампа не дає доступу до сесій. */
async function hashToken(token: string): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)));
}

export async function createSession(
  c: Context<AppContext>,
  userId: string,
): Promise<void> {
  const token = toHex(crypto.getRandomValues(new Uint8Array(32)).buffer);
  const now = Math.floor(Date.now() / 1000);

  await c.env.DB.prepare(
    'INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
  )
    .bind(await hashToken(token), userId, now, now + SESSION_TTL_S)
    .run();

  setCookie(c, COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_TTL_S,
  });
}

export async function destroySession(c: Context<AppContext>): Promise<void> {
  const token = getCookie(c, COOKIE_NAME);
  if (token) {
    await c.env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?')
      .bind(await hashToken(token))
      .run();
  }
  deleteCookie(c, COOKIE_NAME, { path: '/' });
}

export async function currentUser(c: Context<AppContext>): Promise<AuthUser | null> {
  const token = getCookie(c, COOKIE_NAME);
  if (!token) return null;

  const row = await c.env.DB.prepare(
    `SELECT u.id, u.email FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ?`,
  )
    .bind(await hashToken(token), Math.floor(Date.now() / 1000))
    .first<AuthUser>();

  return row ?? null;
}

export const requireAuth: MiddlewareHandler<AppContext> = async (c, next) => {
  const user = await currentUser(c);
  if (!user) return c.json({ error: 'Потрібна авторизація' }, 401);
  c.set('user', user);
  await next();
};
