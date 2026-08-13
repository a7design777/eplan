import type {
  ChargingStrategy,
  ConnectorType,
  PlanFilters,
  PlanRequest,
  Vehicle,
  Waypoint,
} from '../types';

export class ValidationError extends Error {}

const CONNECTORS: ConnectorType[] = ['ccs', 'chademo', 'type2', 'tesla', 'schuko'];

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function num(v: unknown, field: string, min: number, max: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) throw new ValidationError(`Поле ${field} має бути числом`);
  if (n < min || n > max) {
    throw new ValidationError(`Поле ${field} має бути в межах ${min}…${max}`);
  }
  return n;
}

function str(v: unknown, field: string, maxLen: number): string {
  if (typeof v !== 'string' || v.trim() === '') {
    throw new ValidationError(`Поле ${field} обов'язкове`);
  }
  if (v.length > maxLen) throw new ValidationError(`Поле ${field} задовге`);
  return v.trim();
}

function connectorList(v: unknown, field: string): ConnectorType[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new ValidationError(`Поле ${field} має бути списком`);
  const out: ConnectorType[] = [];
  for (const item of v) {
    if (typeof item !== 'string' || !CONNECTORS.includes(item as ConnectorType)) {
      throw new ValidationError(`Невідомий тип конектора: ${String(item)}`);
    }
    out.push(item as ConnectorType);
  }
  return out;
}

function parseWaypoint(v: unknown, index: number): Waypoint {
  if (!isRecord(v)) throw new ValidationError(`Точка ${index + 1} має неправильний формат`);
  return {
    lat: num(v.lat, `waypoints[${index}].lat`, -90, 90),
    lon: num(v.lon, `waypoints[${index}].lon`, -180, 180),
    name: typeof v.name === 'string' ? v.name.slice(0, 200) : undefined,
  };
}

export function parseVehicle(v: unknown): Vehicle {
  if (!isRecord(v)) throw new ValidationError('Не вказано авто');

  const curveRaw = v.chargeCurve;
  if (!Array.isArray(curveRaw) || curveRaw.length < 2) {
    throw new ValidationError('Крива зарядки має містити щонайменше дві точки');
  }
  const chargeCurve = curveRaw.map((p, i) => {
    if (!isRecord(p)) throw new ValidationError(`Точка кривої ${i + 1} має неправильний формат`);
    return {
      socPct: num(p.socPct, `chargeCurve[${i}].socPct`, 0, 100),
      powerKw: num(p.powerKw, `chargeCurve[${i}].powerKw`, 0, 1000),
    };
  });
  chargeCurve.sort((a, b) => a.socPct - b.socPct);

  const connectors = connectorList(v.connectors, 'connectors');
  if (connectors.length === 0) throw new ValidationError('Авто має мати хоча б один конектор');

  return {
    id: typeof v.id === 'string' ? v.id.slice(0, 64) : 'custom',
    make: typeof v.make === 'string' ? v.make.slice(0, 64) : 'Custom',
    model: typeof v.model === 'string' ? v.model.slice(0, 128) : 'Custom',
    batteryKwh: num(v.batteryKwh, 'batteryKwh', 5, 300),
    baseConsumptionWhPerKm: num(v.baseConsumptionWhPerKm, 'baseConsumptionWhPerKm', 60, 500),
    maxDcPowerKw: num(v.maxDcPowerKw, 'maxDcPowerKw', 3, 1000),
    maxAcPowerKw: num(v.maxAcPowerKw ?? 11, 'maxAcPowerKw', 1, 100),
    connectors,
    chargeCurve,
  };
}

const STRATEGIES: ChargingStrategy[] = ['fewest_stops', 'balanced', 'short_stops'];

export function parseFilters(v: unknown): PlanFilters {
  const f = isRecord(v) ? v : {};
  const excludedRaw = Array.isArray(f.excludedNetworkIds) ? f.excludedNetworkIds : [];
  if (excludedRaw.length > 200) throw new ValidationError('Забагато виключених мереж');

  const preferredRaw = Array.isArray(f.preferredNetworkIds) ? f.preferredNetworkIds : [];
  if (preferredRaw.length > 200) throw new ValidationError('Забагато улюблених мереж');

  const strategy = f.chargingStrategy ?? 'balanced';
  if (typeof strategy !== 'string' || !STRATEGIES.includes(strategy as ChargingStrategy)) {
    throw new ValidationError(`Невідома стратегія зарядки: ${String(strategy)}`);
  }

  return {
    preferredNetworkIds: preferredRaw.map((id, i) =>
      num(id, `filters.preferredNetworkIds[${i}]`, 0, 1e9),
    ),
    chargingStrategy: strategy as ChargingStrategy,
    connectors: connectorList(f.connectors, 'filters.connectors'),
    excludedNetworkIds: excludedRaw.map((id, i) =>
      num(id, `filters.excludedNetworkIds[${i}]`, 0, 1e9),
    ),
    freeOnly: f.freeOnly === true,
    // Нижня межа 2 кВт — щоб можна було шукати побутові розетки 220 В.
    minPowerKw: num(f.minPowerKw ?? 22, 'filters.minPowerKw', 2, 400),
    reserveSocPct: num(f.reserveSocPct ?? 10, 'filters.reserveSocPct', 0, 50),
    maxDetourKm: num(f.maxDetourKm ?? 5, 'filters.maxDetourKm', 0.5, 30),
    avoidTolls: f.avoidTolls === true,
    temperatureC: num(f.temperatureC ?? 15, 'filters.temperatureC', -40, 55),
    useLiveWeather: f.useLiveWeather !== false,
  };
}

export function parsePlanRequest(body: unknown): PlanRequest {
  if (!isRecord(body)) throw new ValidationError('Порожній запит');

  const wpRaw = body.waypoints;
  if (!Array.isArray(wpRaw) || wpRaw.length < 2) {
    throw new ValidationError('Потрібні щонайменше старт і фініш');
  }
  if (wpRaw.length > 10) throw new ValidationError('Забагато точок маршруту (максимум 10)');

  const startSocPct = num(body.startSocPct ?? 90, 'startSocPct', 1, 100);
  const targetSocPct = num(body.targetSocPct ?? 10, 'targetSocPct', 0, 100);

  const forcedRaw = Array.isArray(body.forcedStationIds) ? body.forcedStationIds : [];
  if (forcedRaw.length > 20) throw new ValidationError('Забагато обраних вручну зупинок');

  return {
    waypoints: wpRaw.map(parseWaypoint),
    vehicle: parseVehicle(body.vehicle),
    startSocPct,
    targetSocPct,
    filters: parseFilters(body.filters),
    forcedStationIds: forcedRaw.map((id, i) => num(id, `forcedStationIds[${i}]`, 1, 1e12)),
  };
}

export interface UserPrefs {
  vehicle: Vehicle | null;
  startSocPct: number;
  targetSocPct: number;
  filters: PlanFilters;
}

/**
 * Налаштування користувача. Проходять ті самі парсери, що й запит на планування:
 * у БД не має лежати те, що потім не розпланується.
 */
export function parseUserPrefs(body: unknown): UserPrefs {
  if (!isRecord(body)) throw new ValidationError('Порожній запит');
  return {
    vehicle: body.vehicle === null || body.vehicle === undefined ? null : parseVehicle(body.vehicle),
    startSocPct: num(body.startSocPct ?? 90, 'startSocPct', 1, 100),
    targetSocPct: num(body.targetSocPct ?? 10, 'targetSocPct', 0, 100),
    filters: parseFilters(body.filters),
  };
}

export function parseCredentials(body: unknown): { email: string; password: string } {
  if (!isRecord(body)) throw new ValidationError('Порожній запит');
  const email = str(body.email, 'email', 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ValidationError('Некоректна email-адреса');
  }
  const password = str(body.password, 'password', 200);
  if (password.length < 8) throw new ValidationError('Пароль має бути не коротшим за 8 символів');
  return { email, password };
}
