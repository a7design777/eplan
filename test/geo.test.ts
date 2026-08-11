import { describe, expect, it } from 'vitest';
import {
  corridorGeohashes,
  decodePolyline,
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
