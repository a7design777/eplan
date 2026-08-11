import { describe, expect, it } from 'vitest';
import { paymentHint, priceLabel } from '../web/lib/payment';
import { toStationRow, type OcmPoi } from '../src/stations/ocm';
import type { AccessType, Station } from '../src/types';

function station(overrides: Partial<Station> = {}): Station {
  return {
    id: 1,
    name: 'Тест',
    lat: 50,
    lon: 10,
    maxPowerKw: 150,
    connectors: ['ccs'],
    networkId: 23,
    networkName: 'IONITY',
    isFree: false,
    portCount: 4,
    countryCode: 'DE',
    address: null,
    usageCost: null,
    accessType: null,
    ...overrides,
  };
}

describe('paymentHint', () => {
  it('безкоштовна станція має пріоритет над усім іншим', () => {
    expect(paymentHint(station({ isFree: true, accessType: 'membership' }))).toBe('Безкоштовно');
  });

  it('оплата на місці названа прямо', () => {
    expect(paymentHint(station({ accessType: 'pay_at_location' }))).toContain('на місці');
  });

  it('членство вимагає картку або застосунок', () => {
    expect(paymentHint(station({ accessType: 'membership' }))).toContain('картка');
  });

  it('для публічної станції підказує мережу, бо «публічна» про оплату не каже', () => {
    const hint = paymentHint(station({ accessType: 'public', networkName: 'IONITY' }));
    expect(hint).toContain('IONITY');
  });

  it('публічна без мережі чесно каже, що спосіб невідомий', () => {
    expect(paymentHint(station({ accessType: 'public', networkName: null }))).toContain(
      'не вказано',
    );
  });

  it('без даних не вигадує спосіб оплати', () => {
    expect(paymentHint(station({ accessType: null }))).toContain('не вказано');
  });

  it('покриває всі типи доступу', () => {
    const types: AccessType[] = [
      'public',
      'pay_at_location',
      'membership',
      'notice_required',
      'customers_only',
      'restricted',
    ];
    for (const t of types) {
      expect(paymentHint(station({ accessType: t }))).toBeTruthy();
    }
  });
});

describe('priceLabel', () => {
  it('віддає ціну дослівно', () => {
    expect(priceLabel(station({ usageCost: '0,59 €/kWh' }))).toBe('0,59 €/kWh');
  });

  it('порожня ціна — це null, а не порожній рядок', () => {
    expect(priceLabel(station({ usageCost: '   ' }))).toBeNull();
    expect(priceLabel(station({ usageCost: null }))).toBeNull();
  });

  it('обрізає задовгий опис тарифу', () => {
    const long = 'a'.repeat(200);
    const out = priceLabel(station({ usageCost: long }))!;
    expect(out.length).toBeLessThanOrEqual(80);
    expect(out.endsWith('…')).toBe(true);
  });
});

describe('toStationRow — ціна і доступ', () => {
  const poi = (overrides: Partial<OcmPoi> = {}): OcmPoi => ({
    ID: 1,
    AddressInfo: { Title: 'Тест', Latitude: 50, Longitude: 10 },
    Connections: [{ ConnectionTypeID: 33, PowerKW: 150, Quantity: 2 }],
    ...overrides,
  });

  it('переносить ціну і тип доступу з OCM', () => {
    const row = toStationRow(poi({ UsageCost: ' 0,59 €/kWh ', UsageTypeID: 5 }), 'DE', 50);
    expect(row?.usageCost).toBe('0,59 €/kWh');
    expect(row?.accessType).toBe('pay_at_location');
  });

  it('невідомий UsageTypeID не ламає імпорт', () => {
    const row = toStationRow(poi({ UsageTypeID: 999 }), 'DE', 50);
    expect(row).not.toBeNull();
    expect(row?.accessType).toBeNull();
  });

  it('«Free» у ціні визначається як безкоштовна', () => {
    expect(toStationRow(poi({ UsageCost: 'Free' }), 'DE', 50)?.isFree).toBe(1);
    expect(toStationRow(poi({ UsageCost: '0,59 €/kWh' }), 'DE', 50)?.isFree).toBe(0);
  });

  it('побутова розетка розпізнається як schuko', () => {
    const row = toStationRow(
      poi({ Connections: [{ ConnectionTypeID: 28, PowerKW: 3.7, Quantity: 1 }] }),
      'DE',
      2,
    );
    expect(row?.connectors).toBe('schuko');
  });
});
