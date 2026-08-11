import { describe, expect, it } from 'vitest';
import {
  cumulativeEnergyKwh,
  elevationEnergyKwh,
  energyAtDistanceKwh,
  segmentEnergyKwh,
  speedFactor,
  temperatureFactor,
} from '../src/routing/consumption';
import type { RoutePoint, Vehicle } from '../src/types';

const vehicle: Vehicle = {
  id: 'test',
  make: 'Test',
  model: 'Car',
  batteryKwh: 75,
  baseConsumptionWhPerKm: 160,
  maxDcPowerKw: 150,
  maxAcPowerKw: 11,
  connectors: ['ccs'],
  chargeCurve: [
    { socPct: 0, powerKw: 120 },
    { socPct: 50, powerKw: 100 },
    { socPct: 80, powerKw: 50 },
    { socPct: 100, powerKw: 10 },
  ],
};

const point = (distanceKm: number, speedKph = 90, elevationM: number | null = 0): RoutePoint => ({
  lat: 50,
  lon: 10,
  distanceKm,
  speedKph,
  elevationM,
});

describe('speedFactor', () => {
  it('дорівнює 1 на еталонних 90 км/год', () => {
    expect(speedFactor(90)).toBeCloseTo(1, 5);
  });

  it('росте зі швидкістю', () => {
    expect(speedFactor(130)).toBeGreaterThan(speedFactor(110));
    expect(speedFactor(110)).toBeGreaterThan(speedFactor(90));
  });

  it('на 130 км/год дає приблизно +50 % відносно 90', () => {
    const ratio = speedFactor(130) / speedFactor(90);
    expect(ratio).toBeGreaterThan(1.4);
    expect(ratio).toBeLessThan(1.6);
  });

  it('обмежує екстремальні значення', () => {
    expect(speedFactor(500)).toBe(speedFactor(180));
    expect(Number.isFinite(speedFactor(0))).toBe(true);
  });
});

describe('temperatureFactor', () => {
  it('дорівнює 1 при 20 °C', () => {
    expect(temperatureFactor(20)).toBeCloseTo(1, 5);
  });

  it('на морозі споживання суттєво зростає', () => {
    expect(temperatureFactor(-10)).toBeGreaterThan(1.2);
    expect(temperatureFactor(-10)).toBeLessThan(1.4);
    expect(temperatureFactor(-20)).toBeGreaterThan(temperatureFactor(-10));
  });

  it('спека дорожча за еталон, але дешевша за мороз', () => {
    expect(temperatureFactor(35)).toBeGreaterThan(1);
    expect(temperatureFactor(35)).toBeLessThan(temperatureFactor(-10));
  });
});

describe('elevationEnergyKwh', () => {
  it('підйом на 1000 м для 2 т коштує близько 6 кВт·год', () => {
    const kwh = elevationEnergyKwh(1000, 2000);
    expect(kwh).toBeGreaterThan(5);
    expect(kwh).toBeLessThan(7);
  });

  it('спуск повертає енергію, але менше ніж забрав підйом', () => {
    const up = elevationEnergyKwh(500, 2000);
    const down = elevationEnergyKwh(-500, 2000);
    expect(down).toBeLessThan(0);
    expect(Math.abs(down)).toBeLessThan(up);
  });
});

describe('segmentEnergyKwh', () => {
  it('на рівній ділянці 100 км при 90 км/год і 20 °C дає паспортне споживання', () => {
    const { energyKwh } = segmentEnergyKwh(point(0), point(100), vehicle, { temperatureC: 20 });
    expect(energyKwh).toBeCloseTo(16, 1);
  });

  it('на довгому спуску не опускається нижче витрат допоміжних систем', () => {
    const { energyKwh } = segmentEnergyKwh(
      point(0, 90, 2000),
      point(10, 90, 0),
      vehicle,
      { temperatureC: 20 },
    );
    expect(energyKwh).toBeGreaterThan(0);
    expect(energyKwh).toBeCloseTo(0.4, 1);
  });

  it('нульова довжина дає нульову енергію', () => {
    expect(segmentEnergyKwh(point(5), point(5), vehicle, { temperatureC: 20 }).energyKwh).toBe(0);
  });
});

describe('cumulativeEnergyKwh / energyAtDistanceKwh', () => {
  const points = [point(0), point(50), point(100), point(150)];

  it('монотонно зростає і починається з нуля', () => {
    const cum = cumulativeEnergyKwh(points, vehicle, { temperatureC: 20 });
    expect(cum[0]).toBe(0);
    for (let i = 1; i < cum.length; i++) {
      expect(cum[i]!).toBeGreaterThan(cum[i - 1]!);
    }
  });

  it('інтерполює всередині сегмента', () => {
    const cum = cumulativeEnergyKwh(points, vehicle, { temperatureC: 20 });
    const mid = energyAtDistanceKwh(points, cum, 75);
    expect(mid).toBeGreaterThan(cum[1]!);
    expect(mid).toBeLessThan(cum[2]!);
    expect(mid).toBeCloseTo((cum[1]! + cum[2]!) / 2, 5);
  });

  it('за межами маршруту повертає крайні значення', () => {
    const cum = cumulativeEnergyKwh(points, vehicle, { temperatureC: 20 });
    expect(energyAtDistanceKwh(points, cum, -10)).toBe(cum[0]);
    expect(energyAtDistanceKwh(points, cum, 999)).toBe(cum[cum.length - 1]);
  });
});
