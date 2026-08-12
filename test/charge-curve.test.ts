import { describe, expect, it } from 'vitest';
import {
  batteryTemperatureFactor,
  chargeTime,
  powerAtSoc,
  requiredSocPct,
} from '../src/routing/charge-curve';
import type { Vehicle } from '../src/types';

const ev6: Vehicle = {
  id: 'kia-ev6-77',
  make: 'Kia',
  model: 'EV6 77.4',
  batteryKwh: 74,
  baseConsumptionWhPerKm: 168,
  maxDcPowerKw: 233,
  maxAcPowerKw: 11,
  connectors: ['ccs'],
  chargeCurve: [
    { socPct: 0, powerKw: 180 },
    { socPct: 10, powerKw: 233 },
    { socPct: 45, powerKw: 215 },
    { socPct: 60, powerKw: 130 },
    { socPct: 75, powerKw: 85 },
    { socPct: 85, powerKw: 50 },
    { socPct: 100, powerKw: 10 },
  ],
};

describe('powerAtSoc', () => {
  it('інтерполює між точками кривої', () => {
    const p = powerAtSoc(ev6, 52.5, 350);
    expect(p).toBeGreaterThan(130);
    expect(p).toBeLessThan(215);
  });

  it('обмежується потужністю станції', () => {
    expect(powerAtSoc(ev6, 20, 50)).toBe(50);
  });

  it('обмежується максимумом авто', () => {
    expect(powerAtSoc(ev6, 20, 1000)).toBeLessThanOrEqual(ev6.maxDcPowerKw);
  });

  it('падає з ростом SoC у верхній частині кривої', () => {
    expect(powerAtSoc(ev6, 90, 350)).toBeLessThan(powerAtSoc(ev6, 60, 350));
  });
});

describe('chargeTime', () => {
  it('10→80 % на потужній станції — близько 18–25 хв', () => {
    const r = chargeTime(ev6, 10, 80, 350);
    expect(r.durationMin).toBeGreaterThan(15);
    expect(r.durationMin).toBeLessThan(28);
    expect(r.endSocPct).toBeCloseTo(80, 1);
  });

  it('верхні відсотки коштують непропорційно дорого', () => {
    const lower = chargeTime(ev6, 20, 50, 350).durationMin;
    const upper = chargeTime(ev6, 70, 100, 350).durationMin;
    expect(upper).toBeGreaterThan(lower * 2);
  });

  it('слабка станція розтягує ту саму зарядку', () => {
    const fast = chargeTime(ev6, 20, 60, 350).durationMin;
    const slow = chargeTime(ev6, 20, 60, 50).durationMin;
    expect(slow).toBeGreaterThan(fast * 2);
  });

  it('додана енергія відповідає різниці SoC', () => {
    const r = chargeTime(ev6, 20, 70, 350);
    expect(r.energyAddedKwh).toBeCloseTo((74 * 50) / 100, 1);
  });

  it('порожній діапазон не дає ні часу, ні енергії', () => {
    const r = chargeTime(ev6, 60, 60, 350);
    expect(r.durationMin).toBe(0);
    expect(r.energyAddedKwh).toBe(0);
  });

  it('спадний діапазон трактується як відсутність зарядки', () => {
    const r = chargeTime(ev6, 80, 40, 350);
    expect(r.durationMin).toBe(0);
    expect(r.endSocPct).toBe(80);
  });

  it('ліміт часу обриває зарядку на проміжному SoC', () => {
    const r = chargeTime(ev6, 10, 100, 350, 10);
    expect(r.durationMin).toBeCloseTo(10, 1);
    expect(r.endSocPct).toBeGreaterThan(10);
    expect(r.endSocPct).toBeLessThan(100);
  });

  it('середня потужність не перевищує пікову', () => {
    const r = chargeTime(ev6, 10, 80, 350);
    expect(r.averagePowerKw).toBeLessThanOrEqual(ev6.maxDcPowerKw);
    expect(r.averagePowerKw).toBeGreaterThan(50);
  });
});

describe('batteryTemperatureFactor', () => {
  it('у комфортному діапазоні не ріже потужність', () => {
    expect(batteryTemperatureFactor(20)).toBe(1);
    expect(batteryTemperatureFactor(15)).toBe(1);
    expect(batteryTemperatureFactor(35)).toBe(1);
  });

  it('на нулі приймається приблизно половина', () => {
    const f = batteryTemperatureFactor(0);
    expect(f).toBeGreaterThan(0.5);
    expect(f).toBeLessThan(0.7);
  });

  it('на сильному морозі падіння різке, але не до нуля', () => {
    expect(batteryTemperatureFactor(-15)).toBeLessThan(0.35);
    expect(batteryTemperatureFactor(-30)).toBeGreaterThanOrEqual(0.2);
  });

  it('чим холодніше, тим менше — монотонно', () => {
    for (let t = -20; t < 15; t += 5) {
      expect(batteryTemperatureFactor(t)).toBeLessThan(batteryTemperatureFactor(t + 5));
    }
  });

  it('спека ріже, але значно менше за мороз', () => {
    expect(batteryTemperatureFactor(45)).toBeLessThan(1);
    expect(batteryTemperatureFactor(45)).toBeGreaterThan(batteryTemperatureFactor(0));
  });
});

describe('зарядка на морозі', () => {
  it('та сама зупинка взимку триває помітно довше', () => {
    const тепло = chargeTime(ev6, 20, 70, 350, Infinity, 20).durationMin;
    const мороз = chargeTime(ev6, 20, 70, 350, Infinity, -10).durationMin;
    expect(мороз).toBeGreaterThan(тепло * 1.8);
  });

  it('додана енергія не залежить від температури — лише час', () => {
    const тепло = chargeTime(ev6, 20, 70, 350, Infinity, 20);
    const мороз = chargeTime(ev6, 20, 70, 350, Infinity, -10);
    expect(мороз.energyAddedKwh).toBeCloseTo(тепло.energyAddedKwh, 5);
  });

  it('потужність на морозі нижча за паспортну', () => {
    expect(powerAtSoc(ev6, 20, 350, -10)).toBeLessThan(powerAtSoc(ev6, 20, 350, 20));
  });
});

describe('requiredSocPct', () => {
  it('враховує резерв', () => {
    // 18.5 кВт·год = 25 % батареї EV6, плюс 10 % резерву.
    expect(requiredSocPct(ev6, 18.5, 10)).toBe(35);
  });

  it('не перевищує 100 %', () => {
    expect(requiredSocPct(ev6, 200, 10)).toBe(100);
  });

  it('округлює вгору — недозаряд гірший за зайву хвилину', () => {
    expect(requiredSocPct(ev6, 1, 0)).toBe(2);
  });
});
