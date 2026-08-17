import type { Env } from '../types';

/**
 * Обмеження спроб входу й реєстрації.
 *
 * PBKDF2 зі 100 000 ітерацій робить перебір повільним, але не безкоштовним:
 * кожна спроба — це ще й процесорний час нашого Worker'а. Лічильник у KV
 * зупиняє і перебір пароля, і підбір коду запрошення.
 *
 * Ключ — IP плюс дія. Точності до користувача тут не треба: мета не покарати
 * конкретного, а зробити перебір повільним.
 */
const WINDOW_S = 900;
const MAX_ATTEMPTS = 10;

export interface ThrottleResult {
  allowed: boolean;
  retryAfterS: number;
}

export async function checkAttempts(
  env: Env,
  request: Request,
  action: string,
): Promise<ThrottleResult> {
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  const key = `throttle:${action}:${ip}`;

  const raw = await env.CACHE.get(key);
  const count = raw ? Number(raw) : 0;
  if (Number.isFinite(count) && count >= MAX_ATTEMPTS) {
    return { allowed: false, retryAfterS: WINDOW_S };
  }

  // Вікно не ковзне: після першої спроби лічильник живе WINDOW_S і потім
  // зникає разом із записом. Для захисту від перебору цього досить.
  await env.CACHE.put(key, String(count + 1), { expirationTtl: WINDOW_S });
  return { allowed: true, retryAfterS: 0 };
}

/** Успішний вхід знімає лічильник, щоб не карати за забутий пароль. */
export async function clearAttempts(env: Env, request: Request, action: string): Promise<void> {
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  await env.CACHE.delete(`throttle:${action}:${ip}`);
}
