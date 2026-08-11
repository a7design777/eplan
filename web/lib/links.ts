import type { LatLon } from '../../src/types';

/** Google Maps приймає максимум 9 проміжних точок в одному посиланні. */
const GMAPS_MAX_WAYPOINTS = 9;

const coord = (p: LatLon): string => `${p.lat.toFixed(6)},${p.lon.toFixed(6)}`;

/** Навігація до однієї точки. Waze не вміє multi-stop, тому лише одна ціль. */
export function wazeLink(p: LatLon): string {
  return `https://waze.com/ul?ll=${coord(p)}&navigate=yes`;
}

export function googleMapsPointLink(p: LatLon): string {
  return `https://www.google.com/maps/search/?api=1&query=${coord(p)}`;
}

/**
 * Розбиває маршрут на стільки посилань Google Maps, скільки потрібно:
 * ліміт у 9 проміжних точок легко перевищити на маршруті з багатьма зарядками.
 */
export function googleMapsRouteLinks(points: LatLon[]): string[] {
  if (points.length < 2) return [];

  const links: string[] = [];
  let start = 0;

  while (start < points.length - 1) {
    const end = Math.min(points.length - 1, start + GMAPS_MAX_WAYPOINTS + 1);
    const chunk = points.slice(start, end + 1);
    const origin = coord(chunk[0]!);
    const destination = coord(chunk[chunk.length - 1]!);
    const via = chunk.slice(1, -1).map(coord).join('|');

    links.push(
      `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}` +
        (via ? `&waypoints=${encodeURIComponent(via)}` : '') +
        '&travelmode=driving',
    );
    // Наступний відрізок починається з тієї ж точки, де закінчився попередній.
    start = end;
  }

  return links;
}
