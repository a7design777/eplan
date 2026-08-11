import type { LatLon } from '../types';

const EARTH_RADIUS_KM = 6371.0088;

const toRad = (deg: number): number => (deg * Math.PI) / 180;

/** Відстань по великому колу, км. */
export function haversineKm(a: LatLon, b: LatLon): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Декодує encoded polyline. Valhalla віддає з precision 6, Google Maps — 5.
 * Повертає координати у порядку [lat, lon].
 */
export function decodePolyline(encoded: string, precision = 6): [number, number][] {
  const factor = 10 ** precision;
  const coords: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lon = 0;

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    shift = 0;
    result = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lon += result & 1 ? ~(result >> 1) : result >> 1;

    coords.push([lat / factor, lon / factor]);
  }
  return coords;
}

const GEOHASH_ALPHABET = '0123456789bcdefghjkmnpqrstuvwxyz';

/** Geohash-кодування. Довжина 5 ≈ комірка 5×5 км — саме те, що треба для коридору маршруту. */
export function geohashEncode(lat: number, lon: number, length = 5): string {
  let latMin = -90;
  let latMax = 90;
  let lonMin = -180;
  let lonMax = 180;
  let hash = '';
  let bits = 0;
  let bitCount = 0;
  let isLon = true;

  while (hash.length < length) {
    if (isLon) {
      const mid = (lonMin + lonMax) / 2;
      if (lon >= mid) {
        bits = (bits << 1) | 1;
        lonMin = mid;
      } else {
        bits = bits << 1;
        lonMax = mid;
      }
    } else {
      const mid = (latMin + latMax) / 2;
      if (lat >= mid) {
        bits = (bits << 1) | 1;
        latMin = mid;
      } else {
        bits = bits << 1;
        latMax = mid;
      }
    }
    isLon = !isLon;
    bitCount++;
    if (bitCount === 5) {
      hash += GEOHASH_ALPHABET[bits];
      bits = 0;
      bitCount = 0;
    }
  }
  return hash;
}

/**
 * Набір geohash-комірок, що покривають коридор радіусом radiusKm навколо полілінії.
 * Комірки беруться з кроком, меншим за їх розмір, тому дірок між ними не лишається.
 */
export function corridorGeohashes(
  points: LatLon[],
  radiusKm: number,
  precision = 5,
): string[] {
  const cells = new Set<string>();
  // Комірка geohash довжини 5 — приблизно 4.9×4.9 км; беремо половину як крок.
  const cellKm = precision >= 5 ? 4.9 : 39;
  const stepKm = cellKm / 2;
  const ringCount = Math.ceil(radiusKm / stepKm);

  let lastSampled: LatLon | null = null;
  for (const p of points) {
    if (lastSampled && haversineKm(lastSampled, p) < stepKm) continue;
    lastSampled = p;

    const latStepDeg = stepKm / 111.32;
    const lonStepDeg = stepKm / (111.32 * Math.max(0.05, Math.cos(toRad(p.lat))));
    // Кути квадратної сітки лежать далі за радіус коридору — відкидаємо їх,
    // інакше на довгому маршруті набирається вдвічі більше комірок, ніж потрібно.
    const maxOffsetKm = radiusKm + (cellKm * Math.SQRT2) / 2;

    for (let i = -ringCount; i <= ringCount; i++) {
      for (let j = -ringCount; j <= ringCount; j++) {
        if (Math.hypot(i * stepKm, j * stepKm) > maxOffsetKm) continue;
        cells.add(geohashEncode(p.lat + i * latStepDeg, p.lon + j * lonStepDeg, precision));
      }
    }
  }
  return [...cells];
}

/**
 * Найкоротша відстань від точки до полілінії, км, разом з індексом найближчого сегмента.
 * Плоска апроксимація — на масштабі кількох км похибка нехтовна.
 */
export function distanceToPolylineKm(
  point: LatLon,
  line: LatLon[],
): { distanceKm: number; index: number; t: number } {
  let best = Infinity;
  let bestIndex = 0;
  let bestT = 0;
  const kLat = 111.32;
  const kLon = 111.32 * Math.cos(toRad(point.lat));

  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i]!;
    const b = line[i + 1]!;
    const ax = (a.lon - point.lon) * kLon;
    const ay = (a.lat - point.lat) * kLat;
    const bx = (b.lon - point.lon) * kLon;
    const by = (b.lat - point.lat) * kLat;
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    let t = lenSq === 0 ? 0 : -(ax * dx + ay * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const cx = ax + t * dx;
    const cy = ay + t * dy;
    const d = Math.hypot(cx, cy);
    if (d < best) {
      best = d;
      bestIndex = i;
      bestT = t;
    }
  }
  // t — положення проєкції всередині сегмента [0..1]. Без нього прив'язка станції
  // до маршруту округлюється до початку сегмента, що на довгих сегментах дає
  // помилку в кілька кілометрів.
  return { distanceKm: best, index: bestIndex, t: bestT };
}
