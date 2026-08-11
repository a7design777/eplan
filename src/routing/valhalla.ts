import type { Env, LatLon, RoutePoint } from '../types';
import { decodePolyline, haversineKm } from '../lib/geo';
import type { RouteOptions, RouteResult, RoutingProvider } from './provider';

/**
 * Публічний Valhalla FOSSGIS дозволяє 1 запит/сек на клієнта.
 * Тримаємо послідовну чергу в межах isolate плюс кеш у KV — цього достатньо,
 * поки трафік невеликий. При зростанні — свій Valhalla, див. CLAUDE.md.
 */
const MIN_REQUEST_GAP_MS = 1100;
const CACHE_TTL_S = 7 * 24 * 3600;

let queueTail: Promise<unknown> = Promise.resolve();
let lastRequestAt = 0;

function throttled<T>(fn: () => Promise<T>): Promise<T> {
  const run = queueTail.then(async () => {
    const wait = lastRequestAt + MIN_REQUEST_GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequestAt = Date.now();
    return fn();
  });
  // Черга не повинна обриватись через помилку одного запиту.
  queueTail = run.catch(() => undefined);
  return run;
}

async function cacheKey(payload: unknown): Promise<string> {
  const data = new TextEncoder().encode(JSON.stringify(payload));
  const digest = await crypto.subtle.digest('SHA-256', data);
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `valhalla:${hex}`;
}

interface ValhallaManeuver {
  begin_shape_index: number;
  end_shape_index: number;
  length: number;
  time: number;
  toll?: boolean;
}

interface ValhallaLeg {
  shape: string;
  elevation?: number[];
  maneuvers?: ValhallaManeuver[];
  summary: { length: number; time: number };
}

interface ValhallaTrip {
  legs: ValhallaLeg[];
  summary: { length: number; time: number; has_toll?: boolean };
  status?: number;
  status_message?: string;
}

interface ValhallaResponse {
  trip?: ValhallaTrip;
  alternates?: { trip: ValhallaTrip }[];
  error?: string;
  error_code?: number;
}

export class ValhallaProvider implements RoutingProvider {
  constructor(private env: Env) {}

  async route(waypoints: LatLon[], opts: RouteOptions = {}): Promise<RouteResult> {
    const [primary] = await this.routes(waypoints, { ...opts, alternates: 0 });
    if (!primary) throw new Error('Valhalla не повернув маршрут');
    return primary;
  }

  async routes(waypoints: LatLon[], opts: RouteOptions = {}): Promise<RouteResult[]> {
    if (waypoints.length < 2) throw new Error('Потрібно щонайменше дві точки маршруту');

    const elevationIntervalM = opts.elevationIntervalM ?? 0;
    const payload: Record<string, unknown> = {
      locations: waypoints.map((w, i) => ({
        lat: Number(w.lat.toFixed(6)),
        lon: Number(w.lon.toFixed(6)),
        // Проміжні зупинки — саме зупинки: маршрут не «прошиває» їх наскрізь.
        type: i === 0 || i === waypoints.length - 1 ? 'break' : 'break_through',
      })),
      costing: 'auto',
      costing_options: {
        auto: opts.excludeTolls ? { exclude_tolls: true } : { use_tolls: 0.5 },
      },
      directions_options: { units: 'kilometers' },
      directions_type: 'maneuvers',
      ...(elevationIntervalM > 0 ? { elevation_interval: elevationIntervalM } : {}),
      // Valhalla не гарантує, що дасть саме стільки альтернатив — інколи жодної.
      ...(opts.alternates ? { alternates: opts.alternates } : {}),
    };

    const key = await cacheKey(payload);
    const cached = await this.env.CACHE.get(key, 'json');
    const data = (cached as ValhallaResponse | null) ?? (await this.fetchRoute(payload, key));

    const trip = data.trip;
    if (!trip) {
      throw new Error(data.error ?? 'Valhalla не повернув маршрут');
    }

    const trips = [trip, ...(data.alternates ?? []).map((a) => a.trip).filter(Boolean)];
    return trips.map((t) => this.toRouteResult(t, elevationIntervalM));
  }

  private async fetchRoute(
    payload: Record<string, unknown>,
    key: string,
  ): Promise<ValhallaResponse> {
    const url = `${this.env.VALHALLA_URL}/route`;
    const res = await throttled(() =>
      fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Client-Id': this.env.VALHALLA_CLIENT_ID,
        },
        body: JSON.stringify(payload),
      }),
    );

    const text = await res.text();
    if (!res.ok) {
      let message = `Valhalla ${res.status}`;
      try {
        const parsed = JSON.parse(text) as ValhallaResponse;
        if (parsed.error) message = `Valhalla: ${parsed.error}`;
      } catch {
        // Тіло не JSON — лишаємо код статусу.
      }
      throw new Error(message);
    }

    const data = JSON.parse(text) as ValhallaResponse;
    if (data.trip) {
      await this.env.CACHE.put(key, text, { expirationTtl: CACHE_TTL_S });
    }
    return data;
  }

  private toRouteResult(trip: ValhallaTrip, elevationIntervalM: number): RouteResult {
    const points: RoutePoint[] = [];
    const waypointDistancesKm: number[] = [0];
    let cumulativeKm = 0;
    let tollDistanceKm = 0;
    let hasToll = trip.summary.has_toll ?? false;

    for (const leg of trip.legs) {
      const shape = decodePolyline(leg.shape, 6);
      if (shape.length === 0) continue;

      // Швидкість беремо з маневрів: length/time на маневр — найближче до реальності,
      // що дає Valhalla без окремого запиту.
      const speedByIndex = new Array<number>(shape.length).fill(0);
      for (const m of leg.maneuvers ?? []) {
        const speed = m.time > 0 ? (m.length / m.time) * 3600 : 0;
        for (let i = m.begin_shape_index; i <= m.end_shape_index && i < shape.length; i++) {
          speedByIndex[i] = speed;
        }
        if (m.toll) {
          hasToll = true;
          tollDistanceKm += m.length;
        }
      }

      const legStartKm = cumulativeKm;
      const legPoints: RoutePoint[] = [];
      for (let i = 0; i < shape.length; i++) {
        const [lat, lon] = shape[i]!;
        if (i > 0) {
          const [pLat, pLon] = shape[i - 1]!;
          cumulativeKm += haversineKm({ lat: pLat, lon: pLon }, { lat, lon });
        }
        legPoints.push({
          lat,
          lon,
          distanceKm: cumulativeKm,
          elevationM: null,
          speedKph: speedByIndex[i] || 0,
        });
      }

      // Профіль висот приходить рівномірно вздовж легу з кроком elevation_interval.
      if (elevationIntervalM > 0 && leg.elevation && leg.elevation.length > 1) {
        applyElevation(legPoints, leg.elevation, legStartKm, elevationIntervalM / 1000);
      }

      // Точки стику легів дублюються — пропускаємо повтор.
      points.push(...(points.length > 0 ? legPoints.slice(1) : legPoints));
      waypointDistancesKm.push(cumulativeKm);
    }

    // Швидкості для точок, які не покрив жоден маневр.
    fillMissingSpeeds(points);

    return {
      points,
      distanceKm: trip.summary.length,
      durationMin: trip.summary.time / 60,
      hasToll,
      tollDistanceKm,
      waypointDistancesKm,
    };
  }
}

function applyElevation(
  legPoints: RoutePoint[],
  elevation: number[],
  legStartKm: number,
  intervalKm: number,
): void {
  for (const p of legPoints) {
    const offsetKm = p.distanceKm - legStartKm;
    const pos = offsetKm / intervalKm;
    const lo = Math.max(0, Math.min(elevation.length - 1, Math.floor(pos)));
    const hi = Math.min(elevation.length - 1, lo + 1);
    const t = pos - lo;
    const a = elevation[lo]!;
    const b = elevation[hi]!;
    p.elevationM = a + (b - a) * Math.max(0, Math.min(1, t));
  }
}

function fillMissingSpeeds(points: RoutePoint[]): void {
  const fallbackKph = 90;
  let lastKnown = 0;
  for (const p of points) {
    if (p.speedKph > 0) lastKnown = p.speedKph;
    else p.speedKph = lastKnown || fallbackKph;
  }
}
