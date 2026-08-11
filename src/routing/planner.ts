import type {
  ChargeStop,
  Env,
  PlanRequest,
  RoutePlan,
  RoutePoint,
  Station,
  Vehicle,
} from '../types';
import { distanceToPolylineKm } from '../lib/geo';
import { stationsAlongRoute } from '../stations/query';
import { chargeTime, requiredSocPct } from './charge-curve';
import { cumulativeEnergyKwh, energyAtDistanceKwh } from './consumption';
import type { RouteResult, RoutingProvider } from './provider';

/** Понад цей SoC зарядка стає настільки повільною, що вигідніше зупинитись ще раз. */
const CHARGE_CEILING_PCT = 85;
/** Під'їзд, підключення, оплата — фіксована накладна на кожну зупинку. */
const STOP_OVERHEAD_MIN = 5;
/** Мінімальний крок між зупинками, щоб не ставити дві зарядки поруч. */
const MIN_LEG_KM = 25;
/** Крок профілю висот у запиті до рушія, м. */
const ELEVATION_INTERVAL_M = 100;

interface Candidate {
  station: Station;
  /** Позиція проєкції станції на маршрут, км від старту. */
  distanceKm: number;
  detourKm: number;
}

/** Проєктує станції на маршрут і відкидає ті, що далі за дозволений об'їзд. */
export function projectStations(
  stations: Station[],
  points: RoutePoint[],
  maxDetourKm: number,
): Candidate[] {
  const out: Candidate[] = [];
  for (const station of stations) {
    const { distanceKm: detourKm, index, t } = distanceToPolylineKm(station, points);
    if (detourKm > maxDetourKm) continue;
    const from = points[index]!;
    const to = points[index + 1] ?? from;
    const distanceKm = from.distanceKm + t * (to.distanceKm - from.distanceKm);
    out.push({ station, distanceKm, detourKm });
  }
  out.sort((a, b) => a.distanceKm - b.distanceKm);
  return out;
}

/**
 * Оцінка кандидата. Головне — просування вперед: зупинка на 20 км раніше за
 * потрібне коштує зайвого часу на всьому маршруті. Далі йде потужність, бо саме
 * вона визначає час стоянки. Об'їзд штрафується подвійно — туди й назад.
 */
function score(c: Candidate, windowStartKm: number, windowEndKm: number): number {
  const span = Math.max(1, windowEndKm - windowStartKm);
  const progress = (c.distanceKm - windowStartKm) / span;
  const power = Math.min(1, c.station.maxPowerKw / 200);
  const detourPenalty = c.detourKm / 5;
  const freeBonus = c.station.isFree ? 0.15 : 0;
  const portBonus = Math.min(0.1, c.station.portCount / 80);
  return progress * 1.6 + power * 0.9 + freeBonus + portBonus - detourPenalty * 0.7;
}

interface SelectedStop {
  candidate: Candidate;
  arrivalSocPct: number;
}

/** Енергія, витрачена на об'їзд до станції і назад, кВт·год. */
function detourEnergyKwh(vehicle: Vehicle, detourKm: number): number {
  return (vehicle.baseConsumptionWhPerKm * 2 * detourKm) / 1000;
}

export function selectStops(
  candidates: Candidate[],
  points: RoutePoint[],
  cumulative: number[],
  req: PlanRequest,
): { stops: SelectedStop[]; unreachable: boolean; warnings: string[] } {
  const { vehicle, filters } = req;
  const totalKm = points[points.length - 1]?.distanceKm ?? 0;
  const warnings: string[] = [];
  const stops: SelectedStop[] = [];

  let socPct = req.startSocPct;
  let atKm = 0;

  for (let guard = 0; guard < 40; guard++) {
    const energyAtStart = energyAtDistanceKwh(points, cumulative, atKm);
    const usableKwh = ((socPct - filters.reserveSocPct) / 100) * vehicle.batteryKwh;

    // Чи дістанемось фінішу з потрібним залишком?
    const toFinishKwh = energyAtDistanceKwh(points, cumulative, totalKm) - energyAtStart;
    const finishSocPct = socPct - (toFinishKwh / vehicle.batteryKwh) * 100;
    if (finishSocPct >= req.targetSocPct) {
      return { stops, unreachable: false, warnings };
    }

    if (usableKwh <= 0) {
      warnings.push('Стартового заряду не вистачає навіть щоб рушити із заданим резервом.');
      return { stops, unreachable: true, warnings };
    }

    // Найдальша точка, куди дотягнемось на поточному заряді.
    const reachEnergyKwh = energyAtStart + usableKwh;
    const maxReachKm = distanceForEnergy(points, cumulative, reachEnergyKwh, totalKm);

    const windowStartKm = atKm + MIN_LEG_KM;
    const inWindow = candidates.filter(
      (c) =>
        c.distanceKm > windowStartKm &&
        c.distanceKm <= maxReachKm &&
        // Об'їзд теж треба чимось проїхати.
        energyAtDistanceKwh(points, cumulative, c.distanceKm) -
          energyAtStart +
          detourEnergyKwh(vehicle, c.detourKm) <=
          usableKwh,
    );

    if (inWindow.length === 0) {
      // Пробуємо ще раз без відступу MIN_LEG_KM — на випадок дуже щільного старту.
      const relaxed = candidates.filter(
        (c) => c.distanceKm > atKm + 1 && c.distanceKm <= maxReachKm,
      );
      if (relaxed.length === 0) {
        warnings.push(
          `Немає зарядки, що підходить під фільтри, на ділянці ${Math.round(atKm)}–${Math.round(maxReachKm)} км.`,
        );
        return { stops, unreachable: true, warnings };
      }
      inWindow.push(...relaxed);
    }

    let best = inWindow[0]!;
    let bestScore = -Infinity;
    for (const c of inWindow) {
      const s = score(c, atKm, maxReachKm);
      if (s > bestScore) {
        bestScore = s;
        best = c;
      }
    }

    const spentKwh =
      energyAtDistanceKwh(points, cumulative, best.distanceKm) -
      energyAtStart +
      detourEnergyKwh(vehicle, best.detourKm);
    const arrivalSocPct = socPct - (spentKwh / vehicle.batteryKwh) * 100;

    stops.push({ candidate: best, arrivalSocPct });

    // На етапі вибору заряджаємо «зі стелею» — точні рівні порахує trimStops.
    socPct = CHARGE_CEILING_PCT;
    atKm = best.distanceKm;
  }

  warnings.push('Перевищено ліміт зупинок — маршрут занадто довгий для автоматичного планування.');
  return { stops, unreachable: true, warnings };
}

/** Дистанція, на якій накопичена витрата досягає targetKwh. */
function distanceForEnergy(
  points: RoutePoint[],
  cumulative: number[],
  targetKwh: number,
  maxKm: number,
): number {
  if (cumulative.length === 0) return 0;
  const last = cumulative.length - 1;
  if (targetKwh >= cumulative[last]!) return maxKm;

  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cumulative[mid]! <= targetKwh) lo = mid;
    else hi = mid;
  }
  const span = cumulative[hi]! - cumulative[lo]!;
  if (span <= 0) return points[lo]!.distanceKm;
  const t = (targetKwh - cumulative[lo]!) / span;
  return points[lo]!.distanceKm + t * (points[hi]!.distanceKm - points[lo]!.distanceKm);
}

/**
 * Прибирає зайву зарядку: кожна зупинка заряджається рівно стільки, скільки треба
 * щоб дістатись наступної (або фінішу з цільовим SoC) із резервом.
 *
 * Це головна економія часу — верхні відсотки заряду найповільніші, і заряджати
 * «про запас» на кожній зупинці означає втрачати десятки хвилин на маршрут.
 */
export function trimStops(
  selected: SelectedStop[],
  points: RoutePoint[],
  cumulative: number[],
  req: PlanRequest,
): { stops: ChargeStop[]; arrivalSocPct: number | null; warnings: string[] } {
  const { vehicle, filters } = req;
  const totalKm = points[points.length - 1]?.distanceKm ?? 0;
  const warnings: string[] = [];
  const stops: ChargeStop[] = [];

  let socPct = req.startSocPct;
  let atKm = 0;

  for (let i = 0; i < selected.length; i++) {
    const cur = selected[i]!;
    const spentKwh =
      energyAtDistanceKwh(points, cumulative, cur.candidate.distanceKm) -
      energyAtDistanceKwh(points, cumulative, atKm) +
      detourEnergyKwh(vehicle, cur.candidate.detourKm);
    const arrivalSocPct = socPct - (spentKwh / vehicle.batteryKwh) * 100;

    const next = selected[i + 1];
    const nextKm = next ? next.candidate.distanceKm : totalKm;
    const legKwh =
      energyAtDistanceKwh(points, cumulative, nextKm) -
      energyAtDistanceKwh(points, cumulative, cur.candidate.distanceKm) +
      (next ? detourEnergyKwh(vehicle, next.candidate.detourKm) : 0);

    // На фініші треба не резерв, а цільовий SoC користувача.
    const reserveForLeg = next ? filters.reserveSocPct : req.targetSocPct;
    let targetSoc = requiredSocPct(vehicle, legKwh, reserveForLeg);
    targetSoc = Math.min(100, Math.max(targetSoc, arrivalSocPct));

    const stationPowerKw = cur.candidate.station.maxPowerKw;
    const result = chargeTime(vehicle, arrivalSocPct, targetSoc, stationPowerKw);

    if (result.endSocPct + 0.5 < targetSoc) {
      warnings.push(
        `Станція «${cur.candidate.station.name}» не дає дозарядитись до потрібного рівня.`,
      );
    }

    stops.push({
      station: cur.candidate.station,
      distanceKm: cur.candidate.distanceKm,
      arrivalSocPct: round1(arrivalSocPct),
      departureSocPct: round1(result.endSocPct),
      chargeDurationMin: Math.round(result.durationMin),
      totalStopMin: Math.round(result.durationMin + STOP_OVERHEAD_MIN),
      energyAddedKwh: round1(result.energyAddedKwh),
      detourKm: round1(cur.candidate.detourKm),
      averagePowerKw: Math.round(result.averagePowerKw),
    });

    socPct = result.endSocPct;
    atKm = cur.candidate.distanceKm;
  }

  const tailKwh =
    energyAtDistanceKwh(points, cumulative, totalKm) - energyAtDistanceKwh(points, cumulative, atKm);
  const arrivalSocPct = socPct - (tailKwh / vehicle.batteryKwh) * 100;

  // Від'ємний заряд означає, що останній відрізок фізично не проїхати. Повертати
  // «-120 %» як заряд на фініші не можна — це виглядає як справжній результат.
  if (arrivalSocPct < 0) {
    warnings.push('Останнього відрізка не подолати: до фінішу не вистачає заряду.');
    return { stops, arrivalSocPct: null, warnings };
  }

  return { stops, arrivalSocPct: round1(arrivalSocPct), warnings };
}

const round1 = (v: number): number => Math.round(v * 10) / 10;

/** Будує повний план для вже отриманого маршруту. */
export async function planForRoute(
  env: Env,
  route: RouteResult,
  req: PlanRequest,
): Promise<RoutePlan> {
  const { vehicle, filters } = req;
  const points = route.points;
  const cumulative = cumulativeEnergyKwh(points, vehicle, {
    temperatureC: filters.temperatureC,
  });

  const stations = await stationsAlongRoute(env, points, filters, vehicle.connectors);
  const candidates = projectStations(stations, points, filters.maxDetourKm);

  const selection = selectStops(candidates, points, cumulative, req);
  const trimmed = trimStops(selection.stops, points, cumulative, req);

  const chargingDurationMin = trimmed.stops.reduce((s, x) => s + x.totalStopMin, 0);
  const detourKm = trimmed.stops.reduce((s, x) => s + x.detourKm * 2, 0);
  const warnings = [...selection.warnings, ...trimmed.warnings];

  if (stations.length === 0) {
    warnings.push('У коридорі маршруту не знайдено жодної станції під ваші фільтри.');
  }

  return {
    waypoints: req.waypoints,
    stops: trimmed.stops,
    geometry: points.map((p) => [p.lon, p.lat] as [number, number]),
    totalDistanceKm: round1(route.distanceKm + detourKm),
    drivingDurationMin: Math.round(route.durationMin),
    chargingDurationMin,
    totalDurationMin: Math.round(route.durationMin) + chargingDurationMin,
    // Непроїзний маршрут не має достовірного заряду на фініші — краще «невідомо»,
    // ніж число, яке виглядає як справжній результат.
    arrivalSocPct: selection.unreachable ? null : trimmed.arrivalSocPct,
    totalEnergyKwh: round1(cumulative[cumulative.length - 1] ?? 0),
    tolls: {
      hasTolls: route.hasToll,
      countries: [],
      tollDistanceKm: round1(route.tollDistanceKm),
    },
    unreachable: selection.unreachable,
    warnings,
  };
}

/** Точка входу: рахує основний маршрут і, за потреби, безплатну альтернативу. */
export async function plan(
  env: Env,
  provider: RoutingProvider,
  req: PlanRequest,
): Promise<{ primary: RoutePlan; tollFree: RoutePlan | null }> {
  const route = await provider.route(req.waypoints, {
    excludeTolls: req.filters.avoidTolls,
    elevationIntervalM: ELEVATION_INTERVAL_M,
  });
  const primary = await planForRoute(env, route, req);

  // Альтернативу рахуємо лише коли є що обходити і користувач ще не попросив обхід.
  if (!primary.tolls.hasTolls || req.filters.avoidTolls) {
    return { primary, tollFree: null };
  }

  try {
    const freeRoute = await provider.route(req.waypoints, {
      excludeTolls: true,
      elevationIntervalM: ELEVATION_INTERVAL_M,
    });
    const tollFree = await planForRoute(env, freeRoute, req);
    return { primary, tollFree };
  } catch {
    // Без платних доріг маршрут може не існувати — це нормально, просто немає альтернативи.
    return { primary, tollFree: null };
  }
}
