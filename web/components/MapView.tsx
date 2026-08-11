import { useEffect, useRef } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { Map as MlMap, Marker } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { RoutePlan, Waypoint } from '../../src/types';

// OpenFreeMap — безкоштовні векторні тайли без ключа й лімітів.
const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';

const EMPTY_LINE = {
  type: 'Feature',
  properties: {},
  geometry: { type: 'LineString', coordinates: [] as [number, number][] },
} as const satisfies maplibregl.GeoJSONSourceSpecification['data'];

interface Props {
  plan: RoutePlan | null;
  waypoints: Waypoint[];
  /** Клік по вільному місцю мапи — додати точку маршруту. */
  onPickPoint: (lat: number, lon: number) => void;
  /** Маркер точки перетягнули на нове місце. */
  onMovePoint: (index: number, lat: number, lon: number) => void;
}

export function MapView({ plan, waypoints, onPickPoint, onMovePoint }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const markersRef = useRef<Marker[]>([]);

  // Колбеки міняються на кожен рендер, а слухач мапи вішається раз — тримаємо
  // їх у ref, щоб не перепідписуватись і не пересоздавати мапу.
  const handlersRef = useRef({ onPickPoint, onMovePoint });
  handlersRef.current = { onPickPoint, onMovePoint };

  useEffect(() => {
    const container = containerRef.current;
    if (!container || mapRef.current) return;

    const map = new maplibregl.Map({
      container,
      style: STYLE_URL,
      center: [14, 50],
      zoom: 4,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
    mapRef.current = map;

    const onClick = (e: maplibregl.MapMouseEvent) => {
      // Кліки по маркерах сюди не доходять — maplibre зупиняє їх на елементі маркера.
      handlersRef.current.onPickPoint(e.lngLat.lat, e.lngLat.lng);
    };
    map.on('click', onClick);
    map.getCanvas().style.cursor = 'crosshair';

    // Контейнер міняє розмір разом із сайдбаром і при повороті екрана,
    // а maplibre сам за цим не стежить.
    const observer = new ResizeObserver(() => map.resize());
    observer.observe(container);

    return () => {
      observer.disconnect();
      map.off('click', onClick);
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
      if (!ensureRouteLayers(map)) return;

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
        const html =
          `<strong>${escapeHtml(s.station.name)}</strong><br/>` +
          `${s.totalStopMin} хв · ${Math.round(s.arrivalSocPct)} → ${Math.round(s.departureSocPct)} %<br/>` +
          `${Math.round(s.station.maxPowerKw)} кВт${s.station.networkName ? ` · ${escapeHtml(s.station.networkName)}` : ''}`;
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

    render();
    map.on('styledata', render);
    return () => {
      map.off('styledata', render);
    };
  }, [plan, waypoints]);

  return <div className="map" ref={containerRef} />;
}

/**
 * Створює шар маршруту, якщо його ще немає. Повертає false, поки стиль не готовий
 * прийняти джерела — тоді малювання повториться на наступному `styledata`.
 */
function ensureRouteLayers(map: MlMap): boolean {
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
        paint: { 'line-color': '#0b3d21', 'line-width': 8, 'line-opacity': 0.5 },
      });
    }
    map.addLayer({
      id: 'route-line',
      type: 'line',
      source: 'route',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#22a35f', 'line-width': 4 },
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
