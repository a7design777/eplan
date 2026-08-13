import { describe, expect, it } from 'vitest';
import { toStationRow, type OcmPoi } from '../src/stations/ocm';

const poi = (overrides: Partial<OcmPoi> = {}): OcmPoi => ({
  ID: 1,
  AddressInfo: { Title: 'Тест', Latitude: 50, Longitude: 10 },
  Connections: [{ ConnectionTypeID: 33, PowerKW: 150, Quantity: 2 }],
  ...overrides,
});

describe('порти станції', () => {
  it('зберігає тип, потужність і кількість', () => {
    const row = toStationRow(poi(), 'DE', 3)!;
    expect(JSON.parse(row.connections)).toEqual([{ type: 'ccs', powerKw: 150, count: 2 }]);
  });

  it('зливає однакові порти в один рядок', () => {
    const row = toStationRow(
      poi({
        Connections: [
          { ConnectionTypeID: 33, PowerKW: 150, Quantity: 2 },
          { ConnectionTypeID: 33, PowerKW: 150, Quantity: 4 },
        ],
      }),
      'DE',
      3,
    )!;
    expect(JSON.parse(row.connections)).toEqual([{ type: 'ccs', powerKw: 150, count: 6 }]);
    expect(row.portCount).toBe(6);
  });

  it('різні потужності лишаються окремо і йдуть від потужнішої', () => {
    const row = toStationRow(
      poi({
        Connections: [
          { ConnectionTypeID: 25, PowerKW: 22, Quantity: 1 },
          { ConnectionTypeID: 33, PowerKW: 150, Quantity: 2 },
        ],
      }),
      'DE',
      3,
    )!;
    expect(JSON.parse(row.connections)).toEqual([
      { type: 'ccs', powerKw: 150, count: 2 },
      { type: 'type2', powerKw: 22, count: 1 },
    ]);
  });
});

describe('спосіб оплати з UsageType', () => {
  it('оплата на місці', () => {
    const row = toStationRow(poi({ UsageTypeID: 5 }), 'DE', 3)!;
    expect(row.payAtLocation).toBe(1);
    expect(row.accessKeyRequired).toBe(0);
  });

  it('членство з RFID-карткою', () => {
    const row = toStationRow(poi({ UsageTypeID: 4 }), 'DE', 3)!;
    expect(row.membershipRequired).toBe(1);
    expect(row.accessKeyRequired).toBe(1);
    expect(row.payAtLocation).toBe(0);
  });

  it('для «Public» прапорців немає — OCM їх не заповнює', () => {
    const row = toStationRow(poi({ UsageTypeID: 1 }), 'DE', 3)!;
    expect(row.payAtLocation).toBeNull();
    expect(row.membershipRequired).toBeNull();
  });

  it('без UsageTypeID теж null, а не вигаданий нуль', () => {
    const row = toStationRow(poi(), 'DE', 3)!;
    expect(row.payAtLocation).toBeNull();
  });
});

describe('робочий стан станції', () => {
  it('«Operational» вважається робочою', () => {
    expect(toStationRow(poi({ StatusTypeID: 50 }), 'DE', 3)!.statusOperational).toBe(1);
  });

  it('автоматичні статуси «вільна» і «зайнята» — теж робоча', () => {
    expect(toStationRow(poi({ StatusTypeID: 10 }), 'DE', 3)!.statusOperational).toBe(1);
    expect(toStationRow(poi({ StatusTypeID: 20 }), 'DE', 3)!.statusOperational).toBe(1);
  });

  it('демонтовані станції не імпортуються взагалі', () => {
    expect(toStationRow(poi({ StatusTypeID: 200 }), 'DE', 3)).toBeNull();
    expect(toStationRow(poi({ StatusTypeID: 100 }), 'DE', 3)).toBeNull();
  });

  it('«планована на майбутнє» позначається як неробоча', () => {
    expect(toStationRow(poi({ StatusTypeID: 150 }), 'DE', 3)!.statusOperational).toBe(0);
  });

  it('невідомий статус не вважаємо поломкою', () => {
    expect(toStationRow(poi({ StatusTypeID: 0 }), 'DE', 3)!.statusOperational).toBe(1);
    expect(toStationRow(poi(), 'DE', 3)!.statusOperational).toBe(1);
  });
});
