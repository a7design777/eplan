import type { Env, LatLon } from '../types';

/**
 * Температура на маршруті з Open-Meteo — безкоштовно і без ключа.
 *
 * Беремо одну точку — середину маршруту, а не кожен сегмент: різниця
 * температури вздовж навіть довгої траси рідко впливає на план сильніше,
 * ніж похибка самої моделі споживання, а запитів було б у рази більше.
 */
const API = 'https://api.open-meteo.com/v1/forecast';
const CACHE_TTL_S = 3600;

export async function temperatureAt(env: Env, point: LatLon): Promise<number | null> {
  // Округлення до 0.5° — сусідні маршрути потрапляють в один запис кешу.
  const lat = Math.round(point.lat * 2) / 2;
  const lon = Math.round(point.lon * 2) / 2;
  const key = `weather:${lat},${lon}`;

  const cached = await env.CACHE.get(key);
  if (cached !== null) {
    const value = Number(cached);
    return Number.isFinite(value) ? value : null;
  }

  try {
    const res = await fetch(`${API}?latitude=${lat}&longitude=${lon}&current=temperature_2m`);
    if (!res.ok) return null;

    const data = (await res.json()) as { current?: { temperature_2m?: number } };
    const t = data.current?.temperature_2m;
    if (typeof t !== 'number' || !Number.isFinite(t)) return null;

    await env.CACHE.put(key, String(t), { expirationTtl: CACHE_TTL_S });
    return t;
  } catch {
    // Погода — приємне доповнення, а не умова роботи: без неї плануємо далі
    // на температурі, яку задав користувач.
    return null;
  }
}
