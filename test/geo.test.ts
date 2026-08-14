import { describe, expect, it } from 'vitest';
import {
  buildSegmentIndex,
  corridorGeohashes,
  decodePolyline,
  distanceToIndexedLine,
  simplifyLine,
  distanceToPolylineKm,
  geohashEncode,
  haversineKm,
} from '../src/lib/geo';

describe('haversineKm', () => {
  it('Берлін — Мюнхен приблизно 504 км по прямій', () => {
    const d = haversineKm({ lat: 52.52, lon: 13.405 }, { lat: 48.137, lon: 11.575 });
    expect(d).toBeGreaterThan(495);
    expect(d).toBeLessThan(515);
  });

  it('нульова відстань до себе', () => {
    expect(haversineKm({ lat: 50, lon: 10 }, { lat: 50, lon: 10 })).toBe(0);
  });
});

describe('decodePolyline', () => {
  it('декодує precision 5 (формат Google)', () => {
    const pts = decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@', 5);
    expect(pts).toHaveLength(3);
    expect(pts[0]![0]).toBeCloseTo(38.5, 4);
    expect(pts[0]![1]).toBeCloseTo(-120.2, 4);
    expect(pts[2]![0]).toBeCloseTo(43.252, 3);
  });

  it('порожній рядок дає порожній результат', () => {
    expect(decodePolyline('', 6)).toEqual([]);
  });
});

describe('geohashEncode', () => {
  // Канонічний приклад із специфікації geohash.
  it('відтворює еталонний geohash', () => {
    expect(geohashEncode(57.64911, 10.40744, 11)).toBe('u4pruydqqvj');
  });

  it('близькі точки потрапляють в одну комірку', () => {
    expect(geohashEncode(52.52, 13.405, 5)).toBe(geohashEncode(52.521, 13.406, 5));
  });

  it('поважає задану довжину', () => {
    expect(geohashEncode(52.52, 13.405, 7)).toHaveLength(7);
  });
});

describe('corridorGeohashes', () => {
  const line = Array.from({ length: 20 }, (_, i) => ({ lat: 50 + i * 0.05, lon: 10 }));

  it('покриває комірку кожної точки маршруту', () => {
    const cells = new Set(corridorGeohashes(line, 5, 5));
    for (const p of line) {
      expect(cells.has(geohashEncode(p.lat, p.lon, 5))).toBe(true);
    }
  });

  it('ширший коридор дає не менше комірок', () => {
    const narrow = corridorGeohashes(line, 2, 5).length;
    const wide = corridorGeohashes(line, 10, 5).length;
    expect(wide).toBeGreaterThan(narrow);
  });

  it('порожній вхід дає порожній вихід', () => {
    expect(corridorGeohashes([], 5, 5)).toEqual([]);
  });
});

describe('simplifyLine', () => {
  it('пряму лінію зводить до кінців', () => {
    const straight: [number, number][] = Array.from({ length: 500 }, (_, i) => [10, 45 + i * 0.01]);
    expect(simplifyLine(straight, 0.03)).toHaveLength(2);
  });

  it('зберігає кінці й форму кривої', () => {
    const curve: [number, number][] = Array.from({ length: 2000 }, (_, i) => [
      5 + Math.sin(i / 100) * 0.5,
      45 + i * 0.002,
    ]);
    const out = simplifyLine(curve, 0.03);

    expect(out.length).toBeLessThan(curve.length / 3);
    expect(out[0]).toEqual(curve[0]);
    expect(out[out.length - 1]).toEqual(curve[curve.length - 1]);

    // Кожна викинута точка має лежати близько до спрощеної лінії.
    const asLatLon = out.map(([lon, lat]) => ({ lat, lon }));
    for (const [lon, lat] of curve) {
      expect(distanceToPolylineKm({ lat, lon }, asLatLon).distanceKm).toBeLessThan(0.05);
    }
  });

  it('короткі лінії лишає як є', () => {
    const two: [number, number][] = [
      [10, 45],
      [11, 46],
    ];
    expect(simplifyLine(two, 0.03)).toEqual(two);
  });
});

describe('індексований пошук по полілінії', () => {
  // Ламана з поворотом — щоб індекс не «випрямляв» задачу.
  const line = Array.from({ length: 400 }, (_, i) => ({
    lat: 45 + i * 0.01,
    lon: 5 + Math.sin(i / 40) * 0.3,
  }));
  const index = buildSegmentIndex(line, 5);

  it('у межах комірки збігається з повним перебором', () => {
    // Контракт індексу: точний результат для точок ближчих за cellKm до лінії.
    // Далі він може знайти не найкращий сегмент — але такі точки все одно
    // відсіюються за maxDetourKm, тож на планування це не впливає.
    for (let i = 3; i < line.length; i += 29) {
      const p = { lat: line[i]!.lat + 0.005, lon: line[i]!.lon + 0.005 };
      const full = distanceToPolylineKm(p, line);
      if (full.distanceKm > 5) continue;

      const fast = distanceToIndexedLine(p, line, index);
      expect(fast).not.toBeNull();
      expect(fast!.distanceKm).toBeCloseTo(full.distanceKm, 6);
      expect(fast!.index).toBe(full.index);
    }
  });

  it('ніколи не занижує відстань — фільтр за об’їздом лишається безпечним', () => {
    for (const p of [
      { lat: 46.0, lon: 5.1 },
      { lat: 47.5, lon: 5.0 },
      { lat: 45.2, lon: 5.25 },
      { lat: 48.9, lon: 4.8 },
    ]) {
      const fast = distanceToIndexedLine(p, line, index);
      if (!fast) continue;
      expect(fast.distanceKm).toBeGreaterThanOrEqual(distanceToPolylineKm(p, line).distanceKm - 1e-9);
    }
  });

  it('точка далеко від маршруту не має сусідніх сегментів', () => {
    expect(distanceToIndexedLine({ lat: 20, lon: 20 }, line, index)).toBeNull();
  });

  it('знаходить усе, що лежить у межах коридору', () => {
    // Беремо реальні точки лінії, зсунуті вбік менше ніж на комірку.
    for (let i = 5; i < line.length; i += 37) {
      const p = { lat: line[i]!.lat + 0.01, lon: line[i]!.lon + 0.01 };
      const fast = distanceToIndexedLine(p, line, index);
      expect(fast).not.toBeNull();
      expect(fast!.distanceKm).toBeCloseTo(distanceToPolylineKm(p, line).distanceKm, 6);
    }
  });
});

describe('distanceToPolylineKm', () => {
  const line = [
    { lat: 50, lon: 10 },
    { lat: 51, lon: 10 },
    { lat: 52, lon: 10 },
  ];

  it('точка на лінії дає майже нуль', () => {
    expect(distanceToPolylineKm({ lat: 50.5, lon: 10 }, line).distanceKm).toBeLessThan(0.1);
  });

  it('відхилення вбік вимірюється правильно', () => {
    // 0.1° довготи на широті 50° ≈ 7.15 км.
    const { distanceKm } = distanceToPolylineKm({ lat: 50.5, lon: 10.1 }, line);
    expect(distanceKm).toBeGreaterThan(6);
    expect(distanceKm).toBeLessThan(8);
  });

  it('повертає індекс найближчого сегмента', () => {
    expect(distanceToPolylineKm({ lat: 51.8, lon: 10 }, line).index).toBe(1);
  });
});
