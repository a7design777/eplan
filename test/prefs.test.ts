import { describe, expect, it } from 'vitest';
import { parseUserPrefs, ValidationError } from '../src/api/validate';

const vehicle = {
  id: 'tesla-model-s-70d-2015',
  make: 'Tesla',
  model: 'Model S 70D (2015)',
  batteryKwh: 68,
  baseConsumptionWhPerKm: 200,
  maxDcPowerKw: 120,
  maxAcPowerKw: 11,
  connectors: ['ccs', 'tesla', 'type2', 'schuko'],
  chargeCurve: [
    { socPct: 0, powerKw: 110 },
    { socPct: 100, powerKw: 8 },
  ],
};

describe('parseUserPrefs', () => {
  it('зберігає обране авто', () => {
    const p = parseUserPrefs({ vehicle, startSocPct: 80, targetSocPct: 20, filters: {} });
    expect(p.vehicle?.id).toBe('tesla-model-s-70d-2015');
    expect(p.vehicle?.batteryKwh).toBe(68);
    expect(p.startSocPct).toBe(80);
  });

  it('порожні налаштування дають робочі значення за замовчуванням', () => {
    const p = parseUserPrefs({});
    expect(p.vehicle).toBeNull();
    expect(p.startSocPct).toBe(90);
    expect(p.filters.chargingStrategy).toBe('balanced');
    expect(p.filters.preferredNetworkIds).toEqual([]);
  });

  it('зберігає улюблені мережі й стратегію', () => {
    const p = parseUserPrefs({
      vehicle: null,
      filters: { preferredNetworkIds: [3489, 3324], chargingStrategy: 'short_stops' },
    });
    expect(p.filters.preferredNetworkIds).toEqual([3489, 3324]);
    expect(p.filters.chargingStrategy).toBe('short_stops');
  });

  it('відхиляє непридатне авто, щоб у БД не лягло те, що не розпланується', () => {
    expect(() => parseUserPrefs({ vehicle: { ...vehicle, batteryKwh: -5 } })).toThrow(
      ValidationError,
    );
    expect(() => parseUserPrefs({ vehicle: { ...vehicle, connectors: ['вигадка'] } })).toThrow(
      ValidationError,
    );
  });

  it('відхиляє невідому стратегію', () => {
    expect(() => parseUserPrefs({ filters: { chargingStrategy: 'наздогад' } })).toThrow(
      ValidationError,
    );
  });

  it('відхиляє заряд поза межами', () => {
    expect(() => parseUserPrefs({ startSocPct: 500 })).toThrow(ValidationError);
  });
});
