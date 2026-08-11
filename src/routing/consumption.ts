import type { RoutePoint, Vehicle } from '../types';

/** Швидкість, при якій паспортне споживання авто вважається базовим. */
const REFERENCE_SPEED_KPH = 90;

/**
 * Множник споживання від швидкості.
 *
 * Опір повітря росте квадратично, тому левова частка різниці між 90 і 130 км/год —
 * саме він. Кочення й допоміжні системи майже не залежать від швидкості, тому
 * розділяємо базове споживання на постійну і аеродинамічну складові.
 */
export function speedFactor(speedKph: number): number {
  const v = Math.max(15, Math.min(180, speedKph));
  // Частка, що не залежить від швидкості (кочення, допоміжні системи). Підібрана так,
  // щоб перехід 90 → 130 км/год давав близько +48 % — це те, що показують заміри на трасі.
  const constantShare = 0.55;
  const aeroShare = 1 - constantShare;
  const aero = (v / REFERENCE_SPEED_KPH) ** 2;
  // На дуже низькій швидкості допоміжні системи розмазуються на менший пробіг.
  const lowSpeedPenalty = v < 40 ? 1 + (40 - v) / 90 : 1;
  return (constantShare + aeroShare * aero) * lowSpeedPenalty;
}

/**
 * Множник споживання від температури повітря.
 *
 * Холод б'є двічі: гірша хімія батареї і обігрів салону. Тепло — лише кондиціонер,
 * тому крива несиметрична. 20 °C — еталон.
 */
export function temperatureFactor(temperatureC: number): number {
  const t = Math.max(-25, Math.min(45, temperatureC));
  if (t >= 20) return 1 + (t - 20) * 0.006;
  // -10 °C дає близько +31 %, -20 °C — близько +46 %: узгоджується зі спостереженнями
  // зимових пробігів на трасі.
  return 1 + Math.pow((20 - t) / 20, 1.35) * 0.18;
}

/**
 * Енергія на подолання перепаду висот, кВт·год.
 *
 * Підйом бере потенційну енергію з ККД трансмісії, спуск повертає частину через
 * рекуперацію. Маса — усереднений електромобіль з пасажирами.
 */
export function elevationEnergyKwh(deltaElevationM: number, massKg = 2000): number {
  const potentialKwh = (massKg * 9.81 * deltaElevationM) / 3_600_000;
  if (deltaElevationM >= 0) return potentialKwh / 0.9;
  return potentialKwh * 0.65;
}

export interface ConsumptionOptions {
  temperatureC: number;
  /** Маса авто з пасажирами, кг. */
  massKg?: number;
}

export interface SegmentEnergy {
  distanceKm: number;
  energyKwh: number;
}

/**
 * Енергія на одному сегменті маршруту, кВт·год.
 * Чиста функція — жодної мережі, тестується напряму.
 */
export function segmentEnergyKwh(
  from: RoutePoint,
  to: RoutePoint,
  vehicle: Vehicle,
  opts: ConsumptionOptions,
): SegmentEnergy {
  const distanceKm = Math.max(0, to.distanceKm - from.distanceKm);
  if (distanceKm === 0) return { distanceKm: 0, energyKwh: 0 };

  const speedKph = to.speedKph > 0 ? to.speedKph : REFERENCE_SPEED_KPH;
  const whPerKm =
    vehicle.baseConsumptionWhPerKm * speedFactor(speedKph) * temperatureFactor(opts.temperatureC);
  let energyKwh = (whPerKm * distanceKm) / 1000;

  if (from.elevationM !== null && to.elevationM !== null) {
    energyKwh += elevationEnergyKwh(to.elevationM - from.elevationM, opts.massKg ?? 2000);
  }

  // Навіть на довгому спуску авто споживає енергію на допоміжні системи.
  const floorKwh = (vehicle.baseConsumptionWhPerKm * 0.25 * distanceKm) / 1000;
  return { distanceKm, energyKwh: Math.max(floorKwh, energyKwh) };
}

/**
 * Накопичена витрата енергії у кожній точці маршруту, кВт·год від старту.
 * Довжина результату дорівнює довжині points; перший елемент завжди 0.
 */
export function cumulativeEnergyKwh(
  points: RoutePoint[],
  vehicle: Vehicle,
  opts: ConsumptionOptions,
): number[] {
  const out: number[] = new Array(points.length).fill(0);
  for (let i = 1; i < points.length; i++) {
    const seg = segmentEnergyKwh(points[i - 1]!, points[i]!, vehicle, opts);
    out[i] = out[i - 1]! + seg.energyKwh;
  }
  return out;
}

/** Лінійна інтерполяція накопиченої енергії на довільній дистанції від старту. */
export function energyAtDistanceKwh(
  points: RoutePoint[],
  cumulative: number[],
  distanceKm: number,
): number {
  if (points.length === 0) return 0;
  if (distanceKm <= points[0]!.distanceKm) return cumulative[0]!;
  const last = points.length - 1;
  if (distanceKm >= points[last]!.distanceKm) return cumulative[last]!;

  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid]!.distanceKm <= distanceKm) lo = mid;
    else hi = mid;
  }
  const span = points[hi]!.distanceKm - points[lo]!.distanceKm;
  if (span <= 0) return cumulative[lo]!;
  const t = (distanceKm - points[lo]!.distanceKm) / span;
  return cumulative[lo]! + t * (cumulative[hi]! - cumulative[lo]!);
}
