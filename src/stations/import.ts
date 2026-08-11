import type { Env } from '../types';
import { OCM_API, toStationRow, type OcmPoi } from './ocm';

const MIN_POWER_KW = 50;
const MAX_RESULTS = 5000;
const CURSOR_KEY = 'ocm_last_modified';
const BATCH_SIZE = 200;

/**
 * Інкрементальне оновлення дзеркала станцій (cron).
 *
 * Тягне тільки те, що змінилось з минулого разу — повний імпорт Європи в cron
 * не влазить у ліміти, для нього є scripts/fetch-stations.ts.
 */
export async function importStations(env: Env): Promise<{ updated: number; since: string }> {
  if (!env.OCM_API_KEY) throw new Error('Не налаштовано OCM_API_KEY');

  const cursor = await env.DB.prepare('SELECT value FROM import_state WHERE key = ?')
    .bind(CURSOR_KEY)
    .first<{ value: string }>();

  // Перший запуск після bulk-імпорту: беремо вікно в 30 днів назад.
  const since =
    cursor?.value ?? new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);

  const url =
    `${OCM_API}/poi/?key=${env.OCM_API_KEY}&output=json&compact=true&verbose=false` +
    `&minpowerkw=${MIN_POWER_KW}&maxresults=${MAX_RESULTS}&modifiedsince=${since}`;

  const res = await fetch(url, { headers: { 'X-API-Key': env.OCM_API_KEY } });
  if (!res.ok) throw new Error(`OCM ${res.status}: ${await res.text()}`);
  const pois = (await res.json()) as OcmPoi[];

  const now = Math.floor(Date.now() / 1000);
  const statements: D1PreparedStatement[] = [];
  const insert = env.DB.prepare(
    `INSERT OR REPLACE INTO stations
     (id, name, lat, lon, geohash5, max_power_kw, connectors, network_id, is_free,
      port_count, country_code, address, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  let updated = 0;
  for (const poi of pois) {
    // countrycode на POI недоступний у compact-режимі — країна вже стоїть з bulk-імпорту,
    // тож для оновлених записів лишаємо її невідомою, а не затираємо помилковою.
    const row = toStationRow(poi, null, MIN_POWER_KW);
    if (!row) continue;
    statements.push(
      insert.bind(
        row.id,
        row.name,
        row.lat,
        row.lon,
        row.geohash5,
        row.maxPowerKw,
        row.connectors,
        row.networkId,
        row.isFree,
        row.portCount,
        row.countryCode,
        row.address,
        now,
      ),
    );
    updated++;
  }

  for (let i = 0; i < statements.length; i += BATCH_SIZE) {
    await env.DB.batch(statements.slice(i, i + BATCH_SIZE));
  }

  const newCursor = new Date().toISOString().slice(0, 10);
  await env.DB.prepare(
    'INSERT OR REPLACE INTO import_state (key, value, updated_at) VALUES (?, ?, ?)',
  )
    .bind(CURSOR_KEY, newCursor, now)
    .run();

  return { updated, since };
}
