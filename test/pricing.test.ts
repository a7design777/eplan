import { describe, expect, it } from 'vitest';
import { parseUnitPrice, stopCost, tripCost } from '../src/routing/pricing';
import type { Station } from '../src/types';

function station(overrides: Partial<Station> = {}): Station {
  return {
    id: 1,
    name: 'Тест',
    lat: 50,
    lon: 10,
    maxPowerKw: 150,
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
    ports: [{ type: 'ccs', powerKw: 150, count: 2 }],
    statusOperational: true,
    payAtLocation: null,
    membershipRequired: null,
    accessKeyRequired: null,
    ...overrides,
  };
}

describe('parseUnitPrice', () => {
  it('розбирає поширені формати', () => {
    expect(parseUnitPrice('0,59 €/kWh')).toEqual({ perKwh: 0.59, currency: 'EUR' });
    expect(parseUnitPrice('£0.79/kWh')).toEqual({ perKwh: 0.79, currency: 'GBP' });
    expect(parseUnitPrice('0.45 EUR per kWh')).toEqual({ perKwh: 0.45, currency: 'EUR' });
  });

  it('бере першу ціну з діапазону', () => {
    expect(parseUnitPrice('0,39-0,79 €/kWh')?.perKwh).toBe(0.39);
  });

  it('ігнорує тарифи не за кВт·год', () => {
    expect(parseUnitPrice('0,10 €/min')).toBeNull();
    expect(parseUnitPrice('5 € за сеанс')).toBeNull();
    expect(parseUnitPrice('2 €/hour parking')).toBeNull();
  });

  it('без валюти ціну не вигадує', () => {
    expect(parseUnitPrice('0.45 per kWh')).toBeNull();
  });

  it('відкидає неправдоподібні значення', () => {
    expect(parseUnitPrice('99 €/kWh')).toBeNull();
    expect(parseUnitPrice('0 €/kWh')).toBeNull();
  });

  it('порожнє й сміття дають null', () => {
    expect(parseUnitPrice(null)).toBeNull();
    expect(parseUnitPrice('')).toBeNull();
    expect(parseUnitPrice('see app')).toBeNull();
    expect(parseUnitPrice('a'.repeat(300))).toBeNull();
  });
});

describe('stopCost', () => {
  it('рахує вартість зупинки', () => {
    const c = stopCost(station({ usageCost: '0,50 €/kWh' }), 40);
    expect(c?.amount).toBeCloseTo(20, 5);
    expect(c?.currency).toBe('EUR');
  });

  it('безкоштовна станція коштує нуль', () => {
    expect(stopCost(station({ isFree: true }), 40)).toEqual({ amount: 0, currency: '' });
  });

  it('без ціни повертає null, а не нуль', () => {
    expect(stopCost(station({ usageCost: 'see app' }), 40)).toBeNull();
  });
});

describe('tripCost', () => {
  it('додає зупинки однієї валюти', () => {
    const t = tripCost([
      { amount: 20, currency: 'EUR' },
      { amount: 15.5, currency: 'EUR' },
    ]);
    expect(t).toEqual({ total: 35.5, currency: 'EUR', unknownStops: 0 });
  });

  it('рахує зупинки без ціни окремо', () => {
    const t = tripCost([{ amount: 20, currency: 'EUR' }, null, null]);
    expect(t?.total).toBe(20);
    expect(t?.unknownStops).toBe(2);
  });

  it('не змішує валюти — інші йдуть у невідомі', () => {
    const t = tripCost([
      { amount: 30, currency: 'EUR' },
      { amount: 10, currency: 'GBP' },
    ]);
    expect(t?.currency).toBe('EUR');
    expect(t?.total).toBe(30);
    expect(t?.unknownStops).toBe(1);
  });

  it('безкоштовні зупинки не тягнуть валюту', () => {
    const t = tripCost([{ amount: 0, currency: '' }, { amount: 12, currency: 'EUR' }]);
    expect(t).toEqual({ total: 12, currency: 'EUR', unknownStops: 0 });
  });

  it('жодної відомої ціни — null', () => {
    expect(tripCost([null, null])).toBeNull();
  });
});
