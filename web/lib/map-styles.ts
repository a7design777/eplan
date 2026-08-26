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
  /**
   * Фабрика, а не готовий об'єкт: maplibre нормалізує передану специфікацію
   * під себе і тримає на неї посилання. Спільний об'єкт, відданий і при
   * створенні мапи, і потім у setStyle, після першого ж використання вже не
   * той, яким його описали.
   */
  makeStyle: () => StyleSpecification;
  /** Темний фон — під нього підбирається колір лінії маршруту. */
  dark: boolean;
}

/**
 * Шари маршруту вбудовані в сам стиль, а не додаються потім через addLayer.
 *
 * Імперативне додавання вимагає, щоб стиль уже «догрузився», інакше maplibre
 * кидає «Style is not done loading». Ловити цей момент по подіях виявилось
 * ненадійно — у пригальмованій вкладці подія не приходить, і маршрут не
 * з'являвся взагалі. Коли шари є в стилі від початку, ловити нічого не треба,
 * і при зміні стилю вони не зникають.
 */
function routeLayers(dark: boolean): Pick<StyleSpecification, 'sources' | 'layers'> {
  return {
    sources: {
      route: {
        type: 'geojson',
        data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] } },
      },
      'route-gaps': {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      },
    },
    layers: [
      {
        id: 'route-casing',
        type: 'line',
        source: 'route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': dark ? '#0b2a18' : '#0b3d21',
          'line-width': 9,
          'line-opacity': 0.55,
        },
      },
      {
        id: 'route-line',
        type: 'line',
        source: 'route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': dark ? '#3ddc84' : '#22a35f', 'line-width': 5 },
      },
      {
        // Ділянки без зарядок поруч — поверх основної лінії, щоб виділялись,
        // а не ховались під нею.
        id: 'route-gaps-line',
        type: 'line',
        source: 'route-gaps',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': dark ? '#ff8a3d' : '#e0651a',
          'line-width': 5,
          'line-dasharray': [0.2, 1.6],
        },
      },
    ],
  };
}

/** Растровий стиль з одного набору тайлів. */
function rasterStyle(
  tiles: string,
  attribution: string,
  dark: boolean,
  maxzoom = 19,
): StyleSpecification {
  const route = routeLayers(dark);
  return {
    version: 8,
    sources: {
      base: { type: 'raster', tiles: [tiles], tileSize: 256, attribution, maxzoom },
      ...route.sources,
    },
    layers: [{ id: 'base', type: 'raster', source: 'base' }, ...route.layers],
  };
}

/**
 * Супутник із накладеними підписами. На чистому супутнику немає жодної назви,
 * тож знайти потрібний з'їзд практично неможливо — цей шар це виправляє.
 */
function hybridStyle(imagery: string, labels: string, attribution: string): StyleSpecification {
  const route = routeLayers(true);
  return {
    version: 8,
    sources: {
      base: { type: 'raster', tiles: [imagery], tileSize: 256, attribution, maxzoom: 19 },
      labels: { type: 'raster', tiles: [labels], tileSize: 256, maxzoom: 19 },
      ...route.sources,
    },
    layers: [
      { id: 'base', type: 'raster', source: 'base' },
      { id: 'labels', type: 'raster', source: 'labels' },
      ...route.layers,
    ],
  };
}

const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services';

export const MAP_STYLES: MapStyle[] = [
  {
    id: 'terrain',
    label: 'Рельєф',
    makeStyle: () =>
      rasterStyle(`${ESRI}/World_Topo_Map/MapServer/tile/{z}/{y}/{x}`, 'Esri, USGS, NOAA', false),
    dark: false,
  },
  {
    id: 'satellite',
    label: 'Супутник',
    makeStyle: () =>
      rasterStyle(
        `${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`,
        'Esri, Maxar, Earthstar Geographics',
        true,
      ),
    dark: true,
  },
  {
    id: 'hybrid',
    label: 'Гібрид',
    makeStyle: () =>
      hybridStyle(
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
