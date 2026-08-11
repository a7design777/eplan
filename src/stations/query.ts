import type { ConnectorType, Env, PlanFilters, RoutePoint, Station } from '../types';
import { corridorGeohashes } from '../lib/geo';

/**
 * D1 обмежує кількість зв'язаних параметрів у запиті сотнею, тому IN по комірках
 * ріжемо на порції. Запас у 20 параметрів — під фільтри (мережі, конектори).
 */
const MAX_CELLS_PER_QUERY = 90;

interface StationRowDb {
  id: number;
  name: string;
  lat: number;
  lon: number;
  max_power_kw: number;
  connectors: string;
  network_id: number | null;
  network_name: string | null;
  is_free: number;
  port_count: number;
  country_code: string | null;
  address: string | null;
}

function toStation(r: StationRowDb): Station {
  return {
    id: r.id,
    name: r.name,
    lat: r.lat,
    lon: r.lon,
    maxPowerKw: r.max_power_kw,
    connectors: r.connectors.split(',').filter(Boolean) as ConnectorType[],
    networkId: r.network_id,
    networkName: r.network_name,
    isFree: r.is_free === 1,
    portCount: r.port_count,
    countryCode: r.country_code,
    address: r.address,
  };
}

/**
 * Станції в коридорі навколо маршруту, вже відфільтровані під запит користувача.
 *
 * Вибірка йде по geohash5-комірках — без цього D1 сканує всю таблицю станцій
 * на кожне планування.
 */
export async function stationsAlongRoute(
  env: Env,
  points: RoutePoint[],
  filters: PlanFilters,
  vehicleConnectors: ConnectorType[],
): Promise<Station[]> {
  if (points.length === 0) return [];

  const cells = corridorGeohashes(points, filters.maxDetourKm, 5);
  const wantedConnectors =
    filters.connectors.length > 0
      ? filters.connectors.filter((c) => vehicleConnectors.includes(c))
      : vehicleConnectors;
  if (wantedConnectors.length === 0) return [];

  const conditions: string[] = [];
  const baseParams: unknown[] = [];

  conditions.push('s.max_power_kw >= ?');
  baseParams.push(filters.minPowerKw);

  if (filters.freeOnly) conditions.push('s.is_free = 1');

  // Мережі й конектори вбудовуємо прямо в SQL, а не біндимо: список виключених
  // мереж буває довгим і разом із комірками вилазить за ліміт параметрів D1.
  // Це безпечно, бо id вже провалідовані як числа, а конектори — це фіксований enum.
  if (filters.excludedNetworkIds.length > 0) {
    const ids = filters.excludedNetworkIds.map((id) => Math.trunc(id)).join(',');
    conditions.push(`(s.network_id IS NULL OR s.network_id NOT IN (${ids}))`);
  }

  // Конектори зберігаються як CSV — перевіряємо входження з роздільниками,
  // щоб 'type2' не збігався з 'type2x' у майбутньому.
  conditions.push(
    `(${wantedConnectors
      .map((c) => `(',' || s.connectors || ',') LIKE '%,${c},%'`)
      .join(' OR ')})`,
  );

  const byId = new Map<number, Station>();

  for (let i = 0; i < cells.length; i += MAX_CELLS_PER_QUERY) {
    const chunk = cells.slice(i, i + MAX_CELLS_PER_QUERY);
    const sql =
      `SELECT s.id, s.name, s.lat, s.lon, s.max_power_kw, s.connectors, s.network_id,
              n.name AS network_name, s.is_free, s.port_count, s.country_code, s.address
       FROM stations s
       LEFT JOIN networks n ON n.id = s.network_id
       WHERE s.geohash5 IN (${chunk.map(() => '?').join(',')})
         AND ${conditions.join(' AND ')}`;

    const { results } = await env.DB.prepare(sql)
      .bind(...chunk, ...baseParams)
      .all<StationRowDb>();

    for (const r of results ?? []) byId.set(r.id, toStation(r));
  }

  return [...byId.values()];
}
