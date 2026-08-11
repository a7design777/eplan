import { describe, expect, it } from 'vitest';
import { googleMapsRouteLinks, wazeLink } from '../web/lib/links';
import type { LatLon } from '../src/types';

const pts = (n: number): LatLon[] =>
  Array.from({ length: n }, (_, i) => ({ lat: 50 + i * 0.1, lon: 10 + i * 0.1 }));

describe('wazeLink', () => {
  it('містить координати і прапорець навігації', () => {
    expect(wazeLink({ lat: 52.52, lon: 13.405 })).toBe(
      'https://waze.com/ul?ll=52.520000,13.405000&navigate=yes',
    );
  });
});

describe('googleMapsRouteLinks', () => {
  it('короткий маршрут вміщується в одне посилання', () => {
    const links = googleMapsRouteLinks(pts(5));
    expect(links).toHaveLength(1);
    expect(links[0]).toContain('origin=50.000000,10.000000');
    expect(links[0]).toContain('destination=50.400000,10.400000');
  });

  it('без проміжних точок не додає waypoints', () => {
    expect(googleMapsRouteLinks(pts(2))[0]).not.toContain('waypoints=');
  });

  it('розбиває маршрут, що перевищує ліміт у 9 проміжних точок', () => {
    const links = googleMapsRouteLinks(pts(15));
    expect(links.length).toBeGreaterThan(1);
    for (const l of links) {
      const via = new URL(l).searchParams.get('waypoints');
      const count = via ? via.split('|').length : 0;
      expect(count).toBeLessThanOrEqual(9);
    }
  });

  it('відрізки стикуються без пропусків', () => {
    const links = googleMapsRouteLinks(pts(15));
    for (let i = 1; i < links.length; i++) {
      const prevDest = new URL(links[i - 1]!).searchParams.get('destination');
      const nextOrigin = new URL(links[i]!).searchParams.get('origin');
      expect(nextOrigin).toBe(prevDest);
    }
  });

  it('менше двох точок — жодного посилання', () => {
    expect(googleMapsRouteLinks(pts(1))).toEqual([]);
    expect(googleMapsRouteLinks([])).toEqual([]);
  });
});
