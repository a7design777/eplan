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
  preferredNetworkIds: [],
  chargingStrategy: 'balanced',
  freeOnly: false,
  minPowerKw: 22,
  reserveSocPct: 10,
  maxDetourKm: 5,
  avoidTolls: false,
  useLiveWeather: true,
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
    usageCost: null,
    accessType: 'public',
    lastVerified: null,
    ports: [{ type: 'ccs', powerKw, count: 4 }],
    statusOperational: true,
    payAtLocation: null,
    membershipRequired: null,
    accessKeyRequired: null,
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
    forcedStationIds: [],
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

describe('стратегії зарядки', () => {
  const points = straightRoute(700);
  const cum = cumulativeEnergyKwh(points, vehicle, { temperatureC: 20 });
  // Щільна мережа: станція кожні 25 км, щоб стратегія мала з чого обирати.
  const candidates = projectStations(
    Array.from({ length: 27 }, (_, i) => stationAt(i + 1, (i + 1) * 25)),
    points,
    5,
  );

  const planWith = (strategy: PlanFilters['chargingStrategy']) => {
    const req = request({ filters: { ...filters, chargingStrategy: strategy } });
    const sel = selectStops(candidates, points, cum, req);
    return { sel, trimmed: trimStops(sel.stops, points, cum, req) };
  };

  it('«менше зупинок» дає не більше зупинок, ніж «часті короткі»', () => {
    const few = planWith('fewest_stops');
    const many = planWith('short_stops');
    expect(few.sel.stops.length).toBeLessThanOrEqual(many.sel.stops.length);
  });

  it('«часті короткі» тримає відрізки коротшими', () => {
    const few = planWith('fewest_stops').sel.stops.map((s) => s.candidate.distanceKm);
    const many = planWith('short_stops').sel.stops.map((s) => s.candidate.distanceKm);
    const maxLeg = (d: number[]) =>
      Math.max(...d.map((km, i) => km - (i === 0 ? 0 : d[i - 1]!)));
    if (few.length > 0 && many.length > 0) {
      expect(maxLeg(many)).toBeLessThan(maxLeg(few));
    }
  });

  it('«часті короткі» не заряджає високо на проміжних зупинках', () => {
    const { trimmed } = planWith('short_stops');
    // Остання зупинка може бути вищою — там діє цільовий SoC користувача.
    for (const s of trimmed.stops.slice(0, -1)) {
      expect(s.departureSocPct).toBeLessThanOrEqual(71);
    }
  });

  it('усі стратегії доводять маршрут до фінішу', () => {
    for (const s of ['fewest_stops', 'balanced', 'short_stops'] as const) {
      const { sel, trimmed } = planWith(s);
      expect(sel.unreachable).toBe(false);
      expect(trimmed.arrivalSocPct).not.toBeNull();
    }
  });
});

describe('улюблені мережі', () => {
  const points = straightRoute(400);
  const cum = cumulativeEnergyKwh(points, vehicle, { temperatureC: 20 });

  it('за інших рівних обирається станція улюбленої мережі', () => {
    // Дві станції поруч і однакової потужності, різні мережі.
    const a = { ...stationAt(1, 200), networkId: 10, networkName: 'A' };
    const b = { ...stationAt(2, 205), networkId: 20, networkName: 'B' };
    const candidates = projectStations([a, b], points, 5);

    const pick = (preferred: number[]) => {
      const req = request({ filters: { ...filters, preferredNetworkIds: preferred } });
      return selectStops(candidates, points, cum, req).stops[0]?.candidate.station.networkId;
    };

    expect(pick([10])).toBe(10);
    expect(pick([20])).toBe(20);
  });
});

describe('швидкість зарядки важливіша за близькість', () => {
  const points = straightRoute(400);
  const cum = cumulativeEnergyKwh(points, vehicle, { temperatureC: 20 });

  it('не обирає 11 кВт поруч, коли за 30 км є 150 кВт', () => {
    const повільна = { ...stationAt(1, 150, 11), name: 'Повільна 11 кВт' };
    const швидка = { ...stationAt(2, 180, 150), name: 'Швидка 150 кВт' };
    const candidates = projectStations([повільна, швидка], points, 5);

    const r = selectStops(candidates, points, cum, request());
    expect(r.stops[0]?.candidate.station.name).toBe('Швидка 150 кВт');
  });

  it('повільну бере, лише коли іншої немає', () => {
    // 300 км: без зупинки не доїхати, але після зарядки решта дороги посильна.
    const короткий = straightRoute(300);
    const cum300 = cumulativeEnergyKwh(короткий, vehicle, { temperatureC: 20 });
    const повільна = { ...stationAt(1, 150, 11), name: 'Повільна 11 кВт' };
    const candidates = projectStations([повільна], короткий, 5);

    const r = selectStops(candidates, короткий, cum300, request());
    expect(r.stops[0]?.candidate.station.name).toBe('Повільна 11 кВт');
    expect(r.unreachable).toBe(false);
  });

  it('між 150 і 250 кВт вирішує вже розташування, а не потужність', () => {
    // Різниця в часі тут хвилини, тож ближча до потрібної позначки має виграти.
    const ближча = { ...stationAt(1, 180, 150), name: 'Ближча 150' };
    const дальша = { ...stationAt(2, 130, 250), name: 'Дальша 250' };
    const candidates = projectStations([ближча, дальша], points, 5);

    const r = selectStops(candidates, points, cum, request());
    expect(r.stops[0]?.candidate.station.name).toBe('Ближча 150');
  });
});

describe('обов’язкові зупинки, обрані вручну', () => {
  const points = straightRoute(600);
  const cum = cumulativeEnergyKwh(points, vehicle, { temperatureC: 20 });
  const candidates = projectStations(
    Array.from({ length: 11 }, (_, i) => stationAt(i + 1, (i + 1) * 50)),
    points,
    5,
  );

  it('зупиняється саме там, де просив користувач', () => {
    const r = selectStops(candidates, points, cum, request({ forcedStationIds: [2] }));
    expect(r.stops.map((s) => s.candidate.station.id)).toContain(2);
  });

  it('не пропускає обов’язкову, навіть якщо міг би доїхати далі', () => {
    // Станція 1 на 50 км — далеко ближче, ніж дотягнувся б автопланувальник.
    const r = selectStops(candidates, points, cum, request({ forcedStationIds: [1] }));
    expect(r.stops[0]?.candidate.station.id).toBe(1);
  });

  it('добирає проміжну зупинку, якщо до обов’язкової не дотягнути', () => {
    // Станція 9 на 450 км — на одному заряді туди не доїхати.
    const r = selectStops(candidates, points, cum, request({ forcedStationIds: [9] }));
    const ids = r.stops.map((s) => s.candidate.station.id);
    expect(ids).toContain(9);
    expect(ids.length).toBeGreaterThan(1);
    expect(ids.indexOf(9)).toBe(ids.length - 1);
    expect(r.unreachable).toBe(false);
  });

  it('тримає порядок кількох обов’язкових зупинок', () => {
    const r = selectStops(candidates, points, cum, request({ forcedStationIds: [7, 3] }));
    const ids = r.stops.map((s) => s.candidate.station.id);
    expect(ids.indexOf(3)).toBeGreaterThanOrEqual(0);
    expect(ids.indexOf(7)).toBeGreaterThan(ids.indexOf(3));
  });

  it('порожній список нічого не змінює', () => {
    const a = selectStops(candidates, points, cum, request({ forcedStationIds: [] }));
    const b = selectStops(candidates, points, cum, request());
    expect(a.stops.map((s) => s.candidate.station.id)).toEqual(
      b.stops.map((s) => s.candidate.station.id),
    );
  });

  it('неіснуючий id не ламає планування', () => {
    const r = selectStops(candidates, points, cum, request({ forcedStationIds: [99999] }));
    expect(r.unreachable).toBe(false);
    expect(r.stops.length).toBeGreaterThan(0);
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
