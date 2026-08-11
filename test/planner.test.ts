import { describe, expect, it } from 'vitest';
import { projectStations, selectStops, trimStops } from '../src/routing/planner';
import { cumulativeEnergyKwh } from '../src/routing/consumption';
import type { PlanFilters, PlanRequest, RoutePoint, Station, Vehicle } from '../src/types';

const vehicle: Vehicle = {
  id: 'test',
  make: 'Test',
  model: 'Car',
  batteryKwh: 60,
  baseConsumptionWhPerKm: 180,
  maxDcPowerKw: 150,
  maxAcPowerKw: 11,
  connectors: ['ccs'],
  chargeCurve: [
    { socPct: 0, powerKw: 120 },
    { socPct: 20, powerKw: 150 },
    { socPct: 60, powerKw: 100 },
    { socPct: 80, powerKw: 50 },
    { socPct: 100, powerKw: 10 },
  ],
};

const filters: PlanFilters = {
  connectors: [],
  excludedNetworkIds: [],
  freeOnly: false,
  minPowerKw: 50,
  reserveSocPct: 10,
  maxDetourKm: 5,
  avoidTolls: false,
  temperatureC: 20,
};

/** Прямий маршрут уздовж меридіана: 1 точка на 5 км, рівний рельєф, 100 км/год. */
function straightRoute(totalKm: number): RoutePoint[] {
  const points: RoutePoint[] = [];
  for (let km = 0; km <= totalKm; km += 5) {
    points.push({
      lat: 50 + km / 111.32,
      lon: 10,
      distanceKm: km,
      elevationM: 0,
      speedKph: 100,
    });
  }
  return points;
}

function stationAt(id: number, km: number, powerKw = 150, lonOffset = 0): Station {
  return {
    id,
    name: `Станція ${id}`,
    lat: 50 + km / 111.32,
    lon: 10 + lonOffset,
    maxPowerKw: powerKw,
    connectors: ['ccs'],
    networkId: 1,
    networkName: 'Test',
    isFree: false,
    portCount: 4,
    countryCode: 'DE',
    address: null,
  };
}

function request(overrides: Partial<PlanRequest> = {}): PlanRequest {
  return {
    waypoints: [
      { lat: 50, lon: 10 },
      { lat: 55, lon: 10 },
    ],
    vehicle,
    startSocPct: 90,
    targetSocPct: 10,
    filters,
    ...overrides,
  };
}

describe('projectStations', () => {
  const points = straightRoute(200);

  it('прив’язує станцію до правильного місця маршруту', () => {
    const [c] = projectStations([stationAt(1, 100)], points, 5);
    expect(c!.distanceKm).toBeCloseTo(100, 0);
    expect(c!.detourKm).toBeLessThan(0.5);
  });

  it('відкидає станції за межами дозволеного об’їзду', () => {
    // ~0.5° довготи на широті 50° — приблизно 36 км убік.
    expect(projectStations([stationAt(2, 100, 150, 0.5)], points, 5)).toHaveLength(0);
  });

  it('повертає кандидатів упорядкованими за дистанцією', () => {
    const result = projectStations(
      [stationAt(1, 150), stationAt(2, 50), stationAt(3, 100)],
      points,
      5,
    );
    expect(result.map((c) => c.station.id)).toEqual([2, 3, 1]);
  });
});

describe('selectStops', () => {
  it('не ставить зупинок, якщо заряду вистачає до фінішу', () => {
    const points = straightRoute(100);
    const cum = cumulativeEnergyKwh(points, vehicle, { temperatureC: 20 });
    const candidates = projectStations([stationAt(1, 50)], points, 5);

    const r = selectStops(candidates, points, cum, request());
    expect(r.stops).toHaveLength(0);
    expect(r.unreachable).toBe(false);
  });

  it('ставить зупинку на довгому маршруті', () => {
    const points = straightRoute(600);
    const cum = cumulativeEnergyKwh(points, vehicle, { temperatureC: 20 });
    const candidates = projectStations(
      [100, 200, 250, 350, 450, 500].map((km, i) => stationAt(i + 1, km)),
      points,
      5,
    );

    const r = selectStops(candidates, points, cum, request());
    expect(r.unreachable).toBe(false);
    expect(r.stops.length).toBeGreaterThanOrEqual(2);
    // Кожна зупинка має бути досяжною: прибуття не нижче нуля.
    for (const s of r.stops) expect(s.arrivalSocPct).toBeGreaterThan(0);
  });

  it('позначає маршрут непроїзним, коли зарядок немає', () => {
    const points = straightRoute(600);
    const cum = cumulativeEnergyKwh(points, vehicle, { temperatureC: 20 });

    const r = selectStops([], points, cum, request());
    expect(r.unreachable).toBe(true);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('зупинки йдуть у порядку зростання дистанції', () => {
    const points = straightRoute(900);
    const cum = cumulativeEnergyKwh(points, vehicle, { temperatureC: 20 });
    const candidates = projectStations(
      Array.from({ length: 17 }, (_, i) => stationAt(i + 1, (i + 1) * 50)),
      points,
      5,
    );

    const r = selectStops(candidates, points, cum, request());
    const distances = r.stops.map((s) => s.candidate.distanceKm);
    expect([...distances].sort((a, b) => a - b)).toEqual(distances);
  });
});

describe('trimStops', () => {
  const points = straightRoute(600);
  const cum = cumulativeEnergyKwh(points, vehicle, { temperatureC: 20 });
  const candidates = projectStations(
    [100, 200, 250, 350, 450, 500].map((km, i) => stationAt(i + 1, km)),
    points,
    5,
  );

  it('не заряджає більше, ніж потрібно до наступної точки', () => {
    const selected = selectStops(candidates, points, cum, request());
    const trimmed = trimStops(selected.stops, points, cum, request());

    for (const s of trimmed.stops) {
      expect(s.departureSocPct).toBeGreaterThan(s.arrivalSocPct);
      expect(s.departureSocPct).toBeLessThanOrEqual(100);
      expect(s.chargeDurationMin).toBeGreaterThan(0);
      expect(s.totalStopMin).toBeGreaterThan(s.chargeDurationMin);
    }
  });

  it('приїзд на фініш не нижчий за цільовий SoC', () => {
    const req = request({ targetSocPct: 20 });
    const selected = selectStops(candidates, points, cum, req);
    const trimmed = trimStops(selected.stops, points, cum, req);
    expect(trimmed.arrivalSocPct).toBeGreaterThanOrEqual(19);
  });

  it('вищий цільовий SoC подовжує останню зупинку', () => {
    const low = request({ targetSocPct: 10 });
    const high = request({ targetSocPct: 60 });

    const lowPlan = trimStops(selectStops(candidates, points, cum, low).stops, points, cum, low);
    const highPlan = trimStops(selectStops(candidates, points, cum, high).stops, points, cum, high);

    const lastLow = lowPlan.stops[lowPlan.stops.length - 1]!;
    const lastHigh = highPlan.stops[highPlan.stops.length - 1]!;
    expect(lastHigh.chargeDurationMin).toBeGreaterThan(lastLow.chargeDurationMin);
  });

  it('без зупинок повертає порожній результат', () => {
    const trimmed = trimStops([], points, cum, request());
    expect(trimmed.stops).toHaveLength(0);
  });

  it('недосяжний фініш дає null, а не від’ємний заряд', () => {
    const longPoints = straightRoute(900);
    const longCum = cumulativeEnergyKwh(longPoints, vehicle, { temperatureC: 20 });
    // Єдина зарядка на 100-му кілометрі: далі 800 км без жодної станції.
    const only = projectStations([stationAt(1, 100)], longPoints, 5);
    const selected = selectStops(only, longPoints, longCum, request());
    const trimmed = trimStops(selected.stops, longPoints, longCum, request());

    expect(trimmed.arrivalSocPct).toBeNull();
    expect(trimmed.warnings.length).toBeGreaterThan(0);
  });

  it('досяжний фініш дає невід’ємне число', () => {
    const selected = selectStops(candidates, points, cum, request());
    const trimmed = trimStops(selected.stops, points, cum, request());
    expect(trimmed.arrivalSocPct).not.toBeNull();
    expect(trimmed.arrivalSocPct!).toBeGreaterThanOrEqual(0);
  });
});
