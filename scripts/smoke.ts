/**
 * Димовий тест проти живого сервера.
 *
 * Обидва падіння з 503 знайшлись лише вручну: юніт-тести їх не ловлять, бо
 * причина була в лімітах Cloudflare, а не в логіці. Цей скрипт ганяє реальні
 * довгі маршрути й повертає ненульовий код виходу, якщо хоч один зламався.
 *
 *   npm run smoke                          # проти продакшну
 *   SMOKE_URL=http://localhost:8787 npm run smoke
 */
export {};

const URL_BASE = process.env.SMOKE_URL ?? 'https://e.car-ua.com';
const TIMEOUT_MS = 120_000;

interface Case {
  name: string;
  from: [number, number];
  to: [number, number];
  /** Очікуємо відмову з поясненням, а не успіх. */
  expectRejected?: boolean;
}

/**
 * Маршрути підібрані так, щоб бити по відомих больових точках: довгі траси
 * через кілька країн, гори, і випадки, де рушій відмовляє назавжди.
 */
const CASES: Case[] = [
  { name: 'Мадрид → Мон-Сен-Мішель', from: [40.4168, -3.7038], to: [48.6361, -1.5115] },
  { name: 'Барселона → Гамбург', from: [41.3874, 2.1686], to: [53.5511, 9.9937] },
  { name: 'Неаполь → Амстердам', from: [40.8518, 14.2681], to: [52.3676, 4.9041] },
  { name: 'Мілан → Гданськ', from: [45.4642, 9.19], to: [54.352, 18.6466] },
  { name: 'Мюнхен → Загреб (через Альпи)', from: [48.1372, 11.5756], to: [45.815, 15.9819] },
  { name: 'Альмуньєкар → Малага (короткий)', from: [36.734, -3.691], to: [36.7213, -4.4214] },
  {
    name: 'Лісабон → Гельсінкі (має відмовити)',
    from: [38.7223, -9.1393],
    to: [60.1699, 24.9384],
    expectRejected: true,
  },
];

const VEHICLE = {
  id: 'smoke',
  make: 'Test',
  model: 'Car',
  batteryKwh: 74,
  baseConsumptionWhPerKm: 168,
  maxDcPowerKw: 233,
  maxAcPowerKw: 11,
  connectors: ['ccs', 'type2'],
  chargeCurve: [
    { socPct: 0, powerKw: 180 },
    { socPct: 10, powerKw: 233 },
    { socPct: 45, powerKw: 215 },
    { socPct: 60, powerKw: 130 },
    { socPct: 75, powerKw: 85 },
    { socPct: 100, powerKw: 10 },
  ],
};

async function run(c: Case): Promise<boolean> {
  const body = {
    waypoints: [
      { lat: c.from[0], lon: c.from[1] },
      { lat: c.to[0], lon: c.to[1] },
    ],
    vehicle: VEHICLE,
    startSocPct: 90,
    targetSocPct: 10,
    filters: { useLiveWeather: false, temperatureC: 15 },
    forcedStationIds: [],
  };

  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${URL_BASE}/api/plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    const ms = Date.now() - started;
    const kb = Math.round(text.length / 1024);

    // Не JSON означає сторінку помилки Cloudflare — саме той випадок,
    // заради якого цей тест і існує.
    if (!text.trimStart().startsWith('{')) {
      report(c.name, false, `${res.status}, не JSON (${text.slice(0, 40).trim()})`, ms, kb);
      return false;
    }

    const data = JSON.parse(text) as {
      error?: string;
      primary?: { totalDistanceKm: number; stops: unknown[]; unreachable: boolean };
    };

    if (c.expectRejected) {
      const ok = Boolean(data.error) && res.status < 500;
      report(c.name, ok, ok ? `відмова з поясненням (${res.status})` : 'очікували відмову', ms, kb);
      return ok;
    }

    if (data.error) {
      report(c.name, false, `error: ${data.error.slice(0, 60)}`, ms, kb);
      return false;
    }
    if (!data.primary || data.primary.unreachable) {
      report(c.name, false, 'маршрут непроїзний', ms, kb);
      return false;
    }

    report(
      c.name,
      true,
      `${Math.round(data.primary.totalDistanceKm)} км, зупинок ${data.primary.stops.length}`,
      ms,
      kb,
    );
    return true;
  } catch (err) {
    report(c.name, false, `впало: ${(err as Error).name}`, Date.now() - started, 0);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function report(name: string, ok: boolean, detail: string, ms: number, kb: number): void {
  const mark = ok ? '✓' : '✗';
  console.log(
    `${mark} ${name.padEnd(34)} ${String(ms).padStart(6)}мс ${String(kb).padStart(5)}КБ  ${detail}`,
  );
}

console.log(`Димовий тест: ${URL_BASE}\n`);
const results: boolean[] = [];
for (const c of CASES) {
  results.push(await run(c));
}

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed} з ${results.length} успішно`);
if (failed > 0) {
  console.error(`ПРОВАЛЕНО: ${failed}`);
  process.exit(1);
}
