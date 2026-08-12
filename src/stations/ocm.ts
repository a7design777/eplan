import type { AccessType, ConnectorType } from '../types';
// Розширення .ts обов'язкове: цей модуль тягне і бандлер Worker'а, і чистий Node
// у scripts/fetch-stations.ts, а Node без розширення шлях не резолвить.
import { geohashEncode } from '../lib/geo.ts';

export const OCM_API = 'https://api.openchargemap.io/v3';

/**
 * ConnectionTypeID з OpenChargeMap → наші типи конекторів.
 * Все, чого немає в мапі, ігноруємо: побутові розетки для планування траси марні.
 */
const CONNECTION_TYPE_MAP: Record<number, ConnectorType> = {
  2: 'chademo',
  25: 'type2',
  1036: 'type2',
  32: 'ccs',
  33: 'ccs',
  8: 'tesla',
  27: 'tesla',
  30: 'tesla',
  // Побутові розетки, поширені в Європі: E (FR), J (CH), G (UK), H, C, F (Schuko), L (IT), K (DK).
  3: 'schuko',
  7: 'schuko',
  9: 'schuko',
  22: 'schuko',
  23: 'schuko',
  28: 'schuko',
  29: 'schuko',
  34: 'schuko',
};

export interface OcmConnection {
  ConnectionTypeID?: number;
  PowerKW?: number | null;
  Quantity?: number | null;
  StatusTypeID?: number | null;
}

export interface OcmPoi {
  ID: number;
  OperatorID?: number | null;
  UsageCost?: string | null;
  UsageTypeID?: number | null;
  StatusTypeID?: number | null;
  NumberOfPoints?: number | null;
  DateLastVerified?: string | null;
  DateLastStatusUpdate?: string | null;
  AddressInfo?: {
    Title?: string | null;
    Latitude?: number;
    Longitude?: number;
    AddressLine1?: string | null;
    Town?: string | null;
    CountryID?: number | null;
  } | null;
  Connections?: OcmConnection[] | null;
}

/** UsageTypeID з OpenChargeMap → спосіб доступу й оплати. */
const USAGE_TYPE_MAP: Record<number, AccessType> = {
  1: 'public',
  2: 'restricted',
  3: 'notice_required',
  4: 'membership',
  5: 'pay_at_location',
  6: 'customers_only',
  7: 'notice_required',
};

export interface StationRow {
  id: number;
  name: string;
  lat: number;
  lon: number;
  geohash5: string;
  maxPowerKw: number;
  connectors: string;
  networkId: number | null;
  isFree: number;
  portCount: number;
  countryCode: string | null;
  address: string | null;
  usageCost: string | null;
  accessType: AccessType | null;
  lastVerified: number | null;
}

/** StatusTypeID, які означають «станція не працює» — такі не імпортуємо. */
const DEAD_STATUS_IDS = new Set([100, 200, 210]);

const FREE_COST_RE = /^\s*(free|безкоштов|kostenlos|gratis|darmow|бесплат|0(\.0+)?\s*(€|eur)?)\s*$/i;

function isFree(poi: OcmPoi): boolean {
  const cost = poi.UsageCost?.trim();
  if (!cost) return false;
  return FREE_COST_RE.test(cost);
}

/**
 * Приводить POI з OCM до рядка нашої таблиці.
 * Повертає null, якщо станція не годиться для планування маршруту.
 */
export function toStationRow(
  poi: OcmPoi,
  countryCode: string | null,
  minPowerKw: number,
): StationRow | null {
  const lat = poi.AddressInfo?.Latitude;
  const lon = poi.AddressInfo?.Longitude;
  if (typeof lat !== 'number' || typeof lon !== 'number') return null;
  if (poi.StatusTypeID != null && DEAD_STATUS_IDS.has(poi.StatusTypeID)) return null;

  const connectors = new Set<ConnectorType>();
  let maxPowerKw = 0;
  let portCount = 0;

  for (const c of poi.Connections ?? []) {
    if (c.StatusTypeID != null && DEAD_STATUS_IDS.has(c.StatusTypeID)) continue;
    const type = c.ConnectionTypeID != null ? CONNECTION_TYPE_MAP[c.ConnectionTypeID] : undefined;
    if (!type) continue;
    const power = c.PowerKW ?? 0;
    if (power > maxPowerKw) maxPowerKw = power;
    connectors.add(type);
    portCount += c.Quantity ?? 1;
  }

  if (connectors.size === 0) return null;
  if (maxPowerKw < minPowerKw) return null;

  const address = [poi.AddressInfo?.AddressLine1, poi.AddressInfo?.Town]
    .filter(Boolean)
    .join(', ');

  return {
    id: poi.ID,
    name: poi.AddressInfo?.Title?.trim() || `Станція #${poi.ID}`,
    lat,
    lon,
    geohash5: geohashEncode(lat, lon, 5),
    maxPowerKw,
    connectors: [...connectors].join(','),
    networkId: poi.OperatorID ?? null,
    isFree: isFree(poi) ? 1 : 0,
    portCount: Math.max(portCount, poi.NumberOfPoints ?? 1),
    countryCode,
    address: address || null,
    usageCost: poi.UsageCost?.trim() || null,
    accessType: poi.UsageTypeID != null ? (USAGE_TYPE_MAP[poi.UsageTypeID] ?? null) : null,
    lastVerified: parseOcmDate(poi.DateLastVerified ?? poi.DateLastStatusUpdate),
  };
}

/** Дата OCM (ISO) → unix-час. Битий рядок трактуємо як «невідомо». */
function parseOcmDate(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

/** Країни Європи, які імпортуємо (ISO 3166-1 alpha-2). */
export const EUROPE_COUNTRIES = [
  'AL', 'AD', 'AT', 'BA', 'BE', 'BG', 'BY', 'CH', 'CY', 'CZ', 'DE', 'DK', 'EE',
  'ES', 'FI', 'FR', 'GB', 'GR', 'HR', 'HU', 'IE', 'IS', 'IT', 'LI', 'LT', 'LU',
  'LV', 'MC', 'MD', 'ME', 'MK', 'MT', 'NL', 'NO', 'PL', 'PT', 'RO', 'RS', 'SE',
  'SI', 'SK', 'SM', 'UA', 'XK',
];
