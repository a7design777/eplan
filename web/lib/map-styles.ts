import type { StyleSpecification } from 'maplibre-gl';

/**
 * Стилі мапи.
 *
 * Векторні — з OpenFreeMap: без ключів і лімітів, як вимагає стек проєкту.
 * Супутникові й рельєфні тайли — з відкритих сервісів Esri. Ключа вони не
 * потребують, але це чужий сервіс із власними умовами: під помітне навантаження
 * або комерційне використання Esri вимагає акаунт. Якщо застосунок виросте —
 * це перше місце, яке треба буде замінити.
 */
export interface MapStyle {
  id: string;
  label: string;
  /** URL стилю або готова специфікація для растрових шарів. */
  style: string | StyleSpecification;
  /** Темний фон — під нього підбирається колір лінії маршруту. */
  dark: boolean;
}

/** Растровий стиль з одного набору тайлів. */
function rasterStyle(tiles: string, attribution: string, maxzoom = 19): StyleSpecification {
  return {
    version: 8,
    sources: {
      base: { type: 'raster', tiles: [tiles], tileSize: 256, attribution, maxzoom },
    },
    layers: [{ id: 'base', type: 'raster', source: 'base' }],
  };
}

const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services';

export const MAP_STYLES: MapStyle[] = [
  {
    id: 'liberty',
    label: 'Звичайна',
    style: 'https://tiles.openfreemap.org/styles/liberty',
    dark: false,
  },
  {
    id: 'bright',
    label: 'Яскрава',
    style: 'https://tiles.openfreemap.org/styles/bright',
    dark: false,
  },
  {
    id: 'positron',
    label: 'Спокійна',
    style: 'https://tiles.openfreemap.org/styles/positron',
    dark: false,
  },
  {
    id: 'dark',
    label: 'Темна',
    style: 'https://tiles.openfreemap.org/styles/dark',
    dark: true,
  },
  {
    id: 'satellite',
    label: 'Супутник',
    style: rasterStyle(
      `${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`,
      'Esri, Maxar, Earthstar Geographics',
    ),
    dark: true,
  },
  {
    id: 'terrain',
    label: 'Рельєф',
    style: rasterStyle(
      `${ESRI}/World_Topo_Map/MapServer/tile/{z}/{y}/{x}`,
      'Esri, USGS, NOAA',
    ),
    dark: false,
  },
];

const STORAGE_KEY = 'eplan.mapStyle';

export function loadMapStyle(): MapStyle {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return MAP_STYLES.find((s) => s.id === saved) ?? MAP_STYLES[0]!;
  } catch {
    // Приватний режим блокує localStorage — не привід падати.
    return MAP_STYLES[0]!;
  }
}

export function saveMapStyle(id: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Не збереглось — переживемо.
  }
}
