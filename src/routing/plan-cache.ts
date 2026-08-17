import type { Env, PlanRequest, PlanResponse } from '../types';

/**
 * Кеш готових планів.
 *
 * Раніше кешувались лише відповіді Valhalla, а всю решту — вибірку станцій,
 * проєкцію, підбір зупинок — рахували наново на кожен перегляд. Для довгого
 * маршруту це кілька секунд і сотні прочитаних рядків D1 щоразу, коли людина
 * просто перемкнула вкладку і повернулась.
 *
 * Година життя: за цей час ціни й станції не змінюються, а температура з
 * прогнозу вже врахована в ключі — вона й так оновлюється раз на годину.
 */
const TTL_S = 3600;

/**
 * Ключ будується з уже підставленою температурою, тому план із живою погодою
 * не змішується з планом, де користувач задав градуси вручну.
 */
export async function planCacheKey(req: PlanRequest): Promise<string> {
  const shape = {
    w: req.waypoints.map((p) => [Number(p.lat.toFixed(4)), Number(p.lon.toFixed(4))]),
    v: {
      b: req.vehicle.batteryKwh,
      c: req.vehicle.baseConsumptionWhPerKm,
      p: req.vehicle.maxDcPowerKw,
      k: req.vehicle.connectors,
      curve: req.vehicle.chargeCurve,
    },
    s: req.startSocPct,
    t: req.targetSocPct,
    f: req.filters,
    x: [...req.forcedStationIds].sort((a, b) => a - b),
  };
  const data = new TextEncoder().encode(JSON.stringify(shape));
  const digest = await crypto.subtle.digest('SHA-256', data);
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `plan:${hex}`;
}

export async function readPlanCache(env: Env, key: string): Promise<PlanResponse | null> {
  try {
    return await env.CACHE.get<PlanResponse>(key, 'json');
  } catch {
    // Пошкоджений запис не має ламати планування — просто порахуємо заново.
    return null;
  }
}

export async function writePlanCache(env: Env, key: string, plan: PlanResponse): Promise<void> {
  try {
    await env.CACHE.put(key, JSON.stringify(plan), { expirationTtl: TTL_S });
  } catch {
    // Значення понад ліміт KV або збій запису — кеш не критичний.
  }
}
