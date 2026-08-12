/**
 * Одноразове наповнення дзеркала станцій.
 *
 * Запускається локально (не у Worker'і), бо тягне десятки тисяч POI — у cron
 * такий обсяг не влізе в ліміти підзапитів. Далі підтримка актуальності йде
 * інкрементально через src/stations/import.ts.
 *
 *   OCM_API_KEY=... node scripts/fetch-stations.ts
 *   OCM_API_KEY=... MIN_POWER_KW=2 node scripts/fetch-stations.ts   # разом із розетками 220 В
 *   npx wrangler d1 execute eplan --file=data/stations.sql --remote
 */
import { writeFile } from 'node:fs/promises';
import { EUROPE_COUNTRIES, OCM_API, toStationRow, type OcmPoi } from '../src/stations/ocm.ts';

/**
 * 3 кВт, а не 50.
 *
 * Поріг у 50 кВт відсікав дві третини реальних станцій: у коридорі
 * Альмуньєкар — Малага їх 88 проти 226 від 11 кВт. Через це планувальник
 * не бачив зарядку поруч і вів у об'їзд за місто. Заразом це єдиний спосіб,
 * щоб побутові розетки 220 В взагалі потрапляли в базу.
 *
 * Ціна рішення — база більшає приблизно вчетверо і імпорт довший.
 */
const MIN_POWER_KW = Number(process.env.MIN_POWER_KW ?? 3);

/**
 * Ліміт із запасом: Німеччина від 3 кВт дає ~24k. Якщо країна впреться
 * у стелю, скрипт про це скаже — мовчазне обрізання гірше за помилку.
 */
const MAX_RESULTS_PER_COUNTRY = 60000;
const OUT_FILE = new URL('../data/stations.sql', import.meta.url);

const apiKey = process.env.OCM_API_KEY;
if (!apiKey) {
  console.error('Потрібен OCM_API_KEY. Отримати: https://openchargemap.org → my apps → Register An Application');
  process.exit(1);
}

const sqlString = (v: string | null): string =>
  v === null ? 'NULL' : `'${v.replace(/'/g, "''")}'`;

async function fetchJson<T>(url: string): Promise<T> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, { headers: { 'X-API-Key': apiKey! } });
    if (res.ok) return (await res.json()) as T;
    if (res.status === 403 || res.status === 429 || res.status >= 500) {
      const backoffMs = 2000 * 2 ** attempt;
      console.warn(`  ${res.status}, повтор через ${backoffMs / 1000} с`);
      await new Promise((r) => setTimeout(r, backoffMs));
      continue;
    }
    throw new Error(`OCM ${res.status}: ${await res.text()}`);
  }
  throw new Error('OCM: вичерпано спроби');
}

interface Operator {
  ID: number;
  Title: string;
}

console.log('Довідник операторів…');
const reference = await fetchJson<{ Operators: Operator[] }>(
  `${OCM_API}/referencedata/?key=${apiKey}`,
);
const operators = reference.Operators ?? [];
console.log(`  ${operators.length} операторів`);

const lines: string[] = [
  '-- Згенеровано scripts/fetch-stations.ts. Не редагувати вручну.',
  'DELETE FROM stations;',
  'DELETE FROM networks;',
];

for (const op of operators) {
  const title = op.Title?.trim();
  if (!title) continue;
  lines.push(`INSERT OR REPLACE INTO networks (id, name) VALUES (${op.ID}, ${sqlString(title)});`);
}

const now = Math.floor(Date.now() / 1000);
const seen = new Set<number>();
let total = 0;

for (const country of EUROPE_COUNTRIES) {
  const url =
    `${OCM_API}/poi/?key=${apiKey}&output=json&compact=true&verbose=false` +
    `&countrycode=${country}&minpowerkw=${MIN_POWER_KW}&maxresults=${MAX_RESULTS_PER_COUNTRY}`;

  let pois: OcmPoi[];
  try {
    pois = await fetchJson<OcmPoi[]>(url);
  } catch (err) {
    console.error(`${country}: ${(err as Error).message}`);
    continue;
  }

  let kept = 0;
  for (const poi of pois) {
    if (seen.has(poi.ID)) continue;
    const row = toStationRow(poi, country, MIN_POWER_KW);
    if (!row) continue;
    seen.add(poi.ID);
    kept++;
    lines.push(
      'INSERT OR REPLACE INTO stations (id, name, lat, lon, geohash5, max_power_kw, connectors, ' +
        'network_id, is_free, port_count, country_code, address, usage_cost, access_type, ' +
        'last_verified, updated_at) VALUES (' +
        [
          row.id,
          sqlString(row.name),
          row.lat.toFixed(6),
          row.lon.toFixed(6),
          sqlString(row.geohash5),
          row.maxPowerKw,
          sqlString(row.connectors),
          row.networkId ?? 'NULL',
          row.isFree,
          row.portCount,
          sqlString(row.countryCode),
          sqlString(row.address),
          sqlString(row.usageCost),
          sqlString(row.accessType),
          row.lastVerified ?? 'NULL',
          now,
        ].join(', ') +
        ');',
    );
  }
  total += kept;
  const capped = pois.length >= MAX_RESULTS_PER_COUNTRY ? '  ⚠ УПЕРЛОСЬ У ЛІМІТ' : '';
  console.log(`${country}: ${pois.length} POI → ${kept} станцій (разом ${total})${capped}`);

  // Fair use: не молотимо API впритул.
  await new Promise((r) => setTimeout(r, 1200));
}

await writeFile(OUT_FILE, lines.join('\n') + '\n', 'utf8');
console.log(`\nГотово: ${total} станцій → data/stations.sql`);
console.log('Далі: npm run stations:import');
