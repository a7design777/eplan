import type { Vehicle } from '../types';

/** Втрати на зарядці: до батареї доходить менше, ніж видає станція. */
const CHARGING_EFFICIENCY = 0.92;

/**
 * Множник потужності зарядки від температури батареї.
 *
 * Холодний акумулятор фізично не приймає струм: літій не встигає інтеркалюватись,
 * і BMS ріже потужність, щоб не осаджувати метал на аноді. На морозі це найбільша
 * похибка планування — обіцяєш 20 хв, а реально стоїш 40.
 *
 * Числа орієнтовні: без преконденціонування при 0 °C авто бере приблизно половину
 * від паспортної потужності, при -15 °C — близько чверті. Спека теж ріже, але значно
 * менше і лише на високих SoC.
 */
export function batteryTemperatureFactor(temperatureC: number): number {
  const t = Math.max(-30, Math.min(50, temperatureC));
  if (t >= 15 && t <= 35) return 1;
  if (t > 35) return 1 - (t - 35) * 0.012;

  // Від 15 до -20 °C падіння приблизно лінійне, далі виходить на поличку.
  const factor = 1 - (15 - t) * 0.026;
  return Math.max(0.2, factor);
}

/**
 * Потужність, яку авто прийме при заданому SoC, кВт.
 * Лінійна інтерполяція між точками кривої, обмежена потужністю станції.
 */
export function powerAtSoc(
  vehicle: Vehicle,
  socPct: number,
  stationPowerKw: number,
  temperatureC = 20,
): number {
  const curve = vehicle.chargeCurve;
  if (curve.length === 0) return Math.min(vehicle.maxDcPowerKw, stationPowerKw);

  const soc = Math.max(0, Math.min(100, socPct));
  let vehiclePowerKw: number;

  if (soc <= curve[0]!.socPct) {
    vehiclePowerKw = curve[0]!.powerKw;
  } else if (soc >= curve[curve.length - 1]!.socPct) {
    vehiclePowerKw = curve[curve.length - 1]!.powerKw;
  } else {
    vehiclePowerKw = curve[curve.length - 1]!.powerKw;
    for (let i = 1; i < curve.length; i++) {
      const prev = curve[i - 1]!;
      const cur = curve[i]!;
      if (soc <= cur.socPct) {
        const span = cur.socPct - prev.socPct;
        const t = span <= 0 ? 0 : (soc - prev.socPct) / span;
        vehiclePowerKw = prev.powerKw + t * (cur.powerKw - prev.powerKw);
        break;
      }
    }
  }

  // Температура ріже саме те, що приймає авто; станція від холоду не слабшає.
  const coldLimited = vehiclePowerKw * batteryTemperatureFactor(temperatureC);
  return Math.max(0, Math.min(coldLimited, vehicle.maxDcPowerKw, stationPowerKw));
}

export interface ChargeResult {
  durationMin: number;
  energyAddedKwh: number;
  averagePowerKw: number;
  /** Фактичний кінцевий SoC — може бути нижчим за цільовий, якщо впертись у ліміт часу. */
  endSocPct: number;
}

/**
 * Час зарядки від fromSoc до toSoc, хв.
 *
 * Інтегруємо криву чисельно з кроком 0.5 % — потужність падає нелінійно, тому
 * ділити енергію на «середню потужність» не можна: на високих SoC помилка кратна.
 */
export function chargeTime(
  vehicle: Vehicle,
  fromSocPct: number,
  toSocPct: number,
  stationPowerKw: number,
  maxDurationMin = Infinity,
  temperatureC = 20,
): ChargeResult {
  const from = Math.max(0, Math.min(100, fromSocPct));
  const to = Math.max(0, Math.min(100, toSocPct));
  if (to <= from) {
    return { durationMin: 0, energyAddedKwh: 0, averagePowerKw: 0, endSocPct: from };
  }

  const stepPct = 0.5;
  const energyPerStepKwh = (vehicle.batteryKwh * stepPct) / 100;
  let durationMin = 0;
  let soc = from;

  while (soc < to) {
    const stepEnd = Math.min(to, soc + stepPct);
    const fraction = (stepEnd - soc) / stepPct;
    const powerKw = powerAtSoc(vehicle, soc + (stepEnd - soc) / 2, stationPowerKw, temperatureC);
    if (powerKw <= 0.1) break;

    const stepMin = ((energyPerStepKwh * fraction) / (powerKw * CHARGING_EFFICIENCY)) * 60;
    if (durationMin + stepMin > maxDurationMin) {
      const remainingMin = maxDurationMin - durationMin;
      const partial = remainingMin / stepMin;
      soc += (stepEnd - soc) * partial;
      durationMin = maxDurationMin;
      break;
    }
    durationMin += stepMin;
    soc = stepEnd;
  }

  const energyAddedKwh = (vehicle.batteryKwh * (soc - from)) / 100;
  const averagePowerKw = durationMin > 0 ? (energyAddedKwh / (durationMin / 60)) : 0;
  return { durationMin, energyAddedKwh, averagePowerKw, endSocPct: soc };
}

/**
 * SoC, до якого варто заряджатись, щоб доїхати з потрібним запасом.
 * Округлюємо вгору до 1 %, бо планувати «до 43.7 %» безглуздо.
 */
export function requiredSocPct(
  vehicle: Vehicle,
  energyNeededKwh: number,
  reserveSocPct: number,
): number {
  const needPct = (energyNeededKwh / vehicle.batteryKwh) * 100;
  return Math.min(100, Math.ceil(needPct + reserveSocPct));
}
