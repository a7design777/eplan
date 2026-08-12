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

/**
 * Супутник із накладеними підписами. На чистому супутнику немає жодної назви,
 * тож знайти потрібний з'їзд практично неможливо — цей шар це виправляє.
 */
function hybridStyle(imagery: string, labels: string, attribution: string): StyleSpecification {
  return {
    version: 8,
    sources: {
      base: { type: 'raster', tiles: [imagery], tileSize: 256, attribution, maxzoom: 19 },
      labels: { type: 'raster', tiles: [labels], tileSize: 256, maxzoom: 19 },
    },
    layers: [
      { id: 'base', type: 'raster', source: 'base' },
      { id: 'labels', type: 'raster', source: 'labels' },
    ],
  };
}

const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services';

export const MAP_STYLES: MapStyle[] = [
  {
    id: 'terrain',
    label: 'Рельєф',
    style: rasterStyle(
      `${ESRI}/World_Topo_Map/MapServer/tile/{z}/{y}/{x}`,
      'Esri, USGS, NOAA',
    ),
    dark: false,
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
    id: 'hybrid',
    label: 'Гібрид',
    style: hybridStyle(
      `${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`,
      `${ESRI}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`,
      'Esri, Maxar, Earthstar Geographics',
    ),
    dark: true,
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
