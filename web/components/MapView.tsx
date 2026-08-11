import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { Map as MlMap, Marker } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { RoutePlan, Station, Waypoint } from '../../src/types';
import type { Bbox } from '../api';
import { loadMapStyle, MAP_STYLES, saveMapStyle, type MapStyle } from '../lib/map-styles';
import { paymentHint, priceLabel } from '../lib/payment';

const EMPTY_LINE = {
  type: 'Feature',
  properties: {},
  geometry: { type: 'LineString', coordinates: [] as [number, number][] },
} as const satisfies maplibregl.GeoJSONSourceSpecification['data'];

interface Props {
  plan: RoutePlan | null;
  waypoints: Waypoint[];
  /** Станції для окремого шару «показати мережі». Порожньо — шар вимкнено. */
  browseStations: Station[];
  /** Мапу зрушили — треба перезапитати станції під нові межі. */
  onViewportChange: (b: Bbox) => void;
  /** Клік по вільному місцю мапи — додати точку маршруту. */
  onPickPoint: (lat: number, lon: number) => void;
  /** Маркер точки перетягнули на нове місце. */
  onMovePoint: (index: number, lat: number, lon: number) => void;
}

export function MapView({
  plan,
  waypoints,
  browseStations,
  onViewportChange,
  onPickPoint,
  onMovePoint,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const [style, setStyle] = useState<MapStyle>(loadMapStyle);
  const [mapError, setMapError] = useState<string | null>(null);

  // Колбеки міняються на кожен рендер, а слухач мапи вішається раз — тримаємо
  // їх у ref, щоб не перепідписуватись і не пересоздавати мапу.
  const handlersRef = useRef({ onPickPoint, onMovePoint, onViewportChange });
  handlersRef.current = { onPickPoint, onMovePoint, onViewportChange };

  const browseMarkersRef = useRef<Marker[]>([]);

  const styleRef = useRef(style);
  styleRef.current = style;

  // Остання версія малювання — щоб її можна було викликати з ефекту зміни стилю.
  const renderRef = useRef<() => void>(() => {});

  useEffect(() => {
    const container = containerRef.current;
    if (!container || mapRef.current) return;

    let map: MlMap;
    try {
      map = new maplibregl.Map({
        container,
        style: styleRef.current.style,
        center: [14, 50],
        zoom: 4,
        attributionControl: { compact: true },
      });
    } catch (err) {
      // Найчастіше це вимкнений або недоступний WebGL. Порожній прямокутник без
      // пояснень — найгірше, що можна показати, тому кажемо прямо.
      setMapError(
        `Не вдалося запустити мапу: ${(err as Error).message}. Найімовірніша причина — вимкнений WebGL або апаратне прискорення в браузері.`,
      );
      return;
    }

    map.on('webglcontextlost', () =>
      setMapError('Браузер втратив контекст WebGL. Перезавантажте сторінку.'),
    );
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
    mapRef.current = map;

    const onClick = (e: maplibregl.MapMouseEvent) => {
      // Кліки по маркерах сюди не доходять — maplibre зупиняє їх на елементі маркера.
      handlersRef.current.onPickPoint(e.lngLat.lat, e.lngLat.lng);
    };
    map.on('click', onClick);
    map.getCanvas().style.cursor = 'crosshair';

    const onMoveEnd = () => {
      const b = map.getBounds();
      handlersRef.current.onViewportChange({
        minLat: b.getSouth(),
        maxLat: b.getNorth(),
        minLon: b.getWest(),
        maxLon: b.getEast(),
      });
    };
    map.on('moveend', onMoveEnd);

    // Контейнер міняє розмір разом із сайдбаром і при повороті екрана,
    // а maplibre сам за цим не стежить.
    const observer = new ResizeObserver(() => map.resize());
    observer.observe(container);

    return () => {
      observer.disconnect();
      map.off('click', onClick);
      map.off('moveend', onMoveEnd);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Малюємо одразу і повторюємо на кожній зміні стилю. Прив'язуватись до події
    // `load` не можна: якщо стиль дозавантажився до підписки (або взагалі не
    // догрузився), маршрут так і не з'явиться.
    const render = () => {
      if (!ensureRouteLayers(map, styleRef.current.dark)) return;

      const source = map.getSource('route') as maplibregl.GeoJSONSource | undefined;
      if (!source) return;

      const coordinates = plan?.geometry ?? [];
      source.setData({ ...EMPTY_LINE, geometry: { type: 'LineString', coordinates } });

      for (const m of markersRef.current) m.remove();
      markersRef.current = [];

      waypoints.forEach((w, i) => {
        const label = i === 0 ? 'A' : i === waypoints.length - 1 ? 'B' : String(i);
        const marker = addMarker(
          map,
          w.lon,
          w.lat,
          label,
          'marker-waypoint',
          escapeHtml(w.name ?? ''),
          true,
        );
        marker.on('dragend', () => {
          const { lat, lng } = marker.getLngLat();
          handlersRef.current.onMovePoint(i, lat, lng);
        });
        markersRef.current.push(marker);
      });

      (plan?.stops ?? []).forEach((s, i) => {
        const price = priceLabel(s.station);
        const html =
          `<strong>${escapeHtml(s.station.name)}</strong><br/>` +
          `${s.totalStopMin} хв · ${Math.round(s.arrivalSocPct)} → ${Math.round(s.departureSocPct)} %<br/>` +
          `${Math.round(s.station.maxPowerKw)} кВт${s.station.networkName ? ` · ${escapeHtml(s.station.networkName)}` : ''}<br/>` +
          `${escapeHtml(paymentHint(s.station))}` +
          (price ? `<br/><strong>${escapeHtml(price)}</strong>` : '');
        markersRef.current.push(
          addMarker(map, s.station.lon, s.station.lat, String(i + 1), 'marker-charge', html),
        );
      });

      if (coordinates.length > 1) {
        const bounds = coordinates.reduce(
          (b, c) => b.extend(c),
          new maplibregl.LngLatBounds(coordinates[0], coordinates[0]),
        );
        map.fitBounds(bounds, { padding: 60, duration: 600 });
      } else if (waypoints.length > 0) {
        map.easeTo({ center: [waypoints[0]!.lon, waypoints[0]!.lat], zoom: 9 });
      }
    };

    renderRef.current = render;
    render();
    map.on('styledata', render);
    return () => {
      map.off('styledata', render);
    };
  }, [plan, waypoints, style]);

  // Шар «показати мережі» окремий від маршруту: він змінюється при кожному русі
  // мапи, і перемальовувати через нього весь маршрут було б марно.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    for (const m of browseMarkersRef.current) m.remove();
    browseMarkersRef.current = browseStations.map((s) => {
      const el = document.createElement('div');
      el.className = 'station-dot';
      el.title = s.name;
      const price = priceLabel(s);
      return new maplibregl.Marker({ element: el })
        .setLngLat([s.lon, s.lat])
        .setPopup(
          new maplibregl.Popup({ offset: 10, closeButton: false }).setHTML(
            `<strong>${escapeHtml(s.name)}</strong><br/>` +
              `${Math.round(s.maxPowerKw)} кВт · ${s.portCount} портів` +
              (s.networkName ? `<br/>${escapeHtml(s.networkName)}` : '') +
              `<br/>${escapeHtml(paymentHint(s))}` +
              (price ? `<br/><strong>${escapeHtml(price)}</strong>` : ''),
          ),
        )
        .addTo(map);
    });

    return () => {
      for (const m of browseMarkersRef.current) m.remove();
      browseMarkersRef.current = [];
    };
  }, [browseStations]);

  const appliedStyleRef = useRef(style.id);
  useEffect(() => {
    const map = mapRef.current;
    // Мапа вже створена з початковим стилем — перевстановлювати його не треба.
    if (!map || appliedStyleRef.current === style.id) return;
    appliedStyleRef.current = style.id;
    map.setStyle(style.style);
    saveMapStyle(style.id);

    // Підміна стилю асинхронна і стирає всі наші шари. Подія `styledata` після неї
    // приходить не завжди, тому кілька секунд активно перевіряємо й повертаємо
    // маршрут на місце. Перевірка ідемпотентна: якщо шар цілий, нічого не робимо.
    let attempts = 0;
    const timer = setInterval(() => {
      const m = mapRef.current;
      if (!m || attempts++ > 24) {
        clearInterval(timer);
        return;
      }
      if (!m.getLayer('route-line')) renderRef.current();
    }, 250);

    return () => clearInterval(timer);
  }, [style]);

  return (
    <>
      <div className="map" ref={containerRef} />
      {mapError && <div className="map-error">{mapError}</div>}
      <div className="map-styles">
        {MAP_STYLES.map((s) => (
          <button
            key={s.id}
            type="button"
            aria-pressed={s.id === style.id}
            onClick={() => setStyle(s)}
          >
            {s.label}
          </button>
        ))}
      </div>
    </>
  );
}

/**
 * Створює шар маршруту, якщо його ще немає. Повертає false, поки стиль не готовий
 * прийняти джерела — тоді малювання повториться на наступному `styledata`.
 */
function ensureRouteLayers(map: MlMap, dark: boolean): boolean {
  if (map.getLayer('route-line')) return true;
  try {
    if (!map.getSource('route')) {
      map.addSource('route', { type: 'geojson', data: EMPTY_LINE });
    }
    // Дві лінії: широка тьмяна підкладка робить маршрут читабельним на будь-якій мапі.
    if (!map.getLayer('route-casing')) {
      map.addLayer({
        id: 'route-casing',
        type: 'line',
        source: 'route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        // На темній мапі темна підкладка зливається з фоном — там світліша.
        paint: {
          'line-color': dark ? '#e9fff3' : '#0b3d21',
          'line-width': 8,
          'line-opacity': dark ? 0.35 : 0.5,
        },
      });
    }
    map.addLayer({
      id: 'route-line',
      type: 'line',
      source: 'route',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': dark ? '#3ddc84' : '#22a35f', 'line-width': 4 },
    });
    return true;
  } catch {
    return false;
  }
}

function addMarker(
  map: MlMap,
  lon: number,
  lat: number,
  label: string,
  className: string,
  popupHtml: string,
  draggable = false,
): Marker {
  const el = document.createElement('div');
  el.className = `marker ${className}`;
  el.textContent = label;
  if (draggable) el.title = 'Перетягніть, щоб змінити точку';

  const marker = new maplibregl.Marker({ element: el, draggable }).setLngLat([lon, lat]);
  if (popupHtml) {
    marker.setPopup(new maplibregl.Popup({ offset: 16, closeButton: false }).setHTML(popupHtml));
  }
  return marker.addTo(map);
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}
