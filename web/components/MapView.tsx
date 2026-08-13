import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { Map as MlMap, Marker } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { NearbyStation, RoutePlan, Station, Waypoint } from '../../src/types';
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
  /** Інші зарядки вздовж маршруту — варіанти заміни. */
  alternatives: NearbyStation[];
  /** Станції, які користувач призначив обов'язковими зупинками. */
  forcedStationIds: number[];
  onToggleForced: (stationId: number) => void;
  /** Чи ввімкнено режим постановки точок кліком. */
  pickMode: boolean;
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
  alternatives,
  forcedStationIds,
  onToggleForced,
  pickMode,
  onPickPoint,
  onMovePoint,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const [style, setStyle] = useState<MapStyle>(loadMapStyle);
  const [mapError, setMapError] = useState<string | null>(null);
  const [stylesOpen, setStylesOpen] = useState(false);

  // Колбеки міняються на кожен рендер, а слухач мапи вішається раз — тримаємо
  // їх у ref, щоб не перепідписуватись і не пересоздавати мапу.
  const handlersRef = useRef({ onPickPoint, onMovePoint, onViewportChange, pickMode });
  handlersRef.current = { onPickPoint, onMovePoint, onViewportChange, pickMode };

  const browseMarkersRef = useRef<Marker[]>([]);

  const styleRef = useRef(style);
  styleRef.current = style;

  // Остання версія малювання — щоб її можна було викликати з ефекту зміни стилю.
  const renderRef = useRef<() => void>(() => {});
  /** Який маршрут камера вже показала — щоб не смикати її на кожен перемальовок. */
  const fittedKeyRef = useRef('');

  useEffect(() => {
    const container = containerRef.current;
    if (!container || mapRef.current) return;

    let map: MlMap;
    try {
      map = new maplibregl.Map({
        container,
        style: styleRef.current.makeStyle(),
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
      // Точка ставиться лише уввімкненому режимі: інакше кожен клік по мапі,
      // зроблений щоб її просто роздивитись, псував би маршрут.
      if (!handlersRef.current.pickMode) return;
      // Кліки по маркерах сюди не доходять — maplibre зупиняє їх на елементі маркера.
      handlersRef.current.onPickPoint(e.lngLat.lat, e.lngLat.lng);
    };
    map.on('click', onClick);

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
      // Джерело `route` описане в самому стилі, тож окремо створювати нічого.
      // Поки стиль не застосувався, його ще немає — тоді просто чекаємо ретраю.
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

      /*
       * Камеру переставляємо тільки коли маршрут справді змінився, і без анімації.
       *
       * Анімований fitBounds крутиться через requestAnimationFrame, а той у фоновій
       * чи пригальмованій вкладці не викликається — камера лишалась на старому місці,
       * і користувач бачив порожню мапу замість щойно прокладеного маршруту.
       * Заразом перевірка на зміну не дає перестрибувати назад, коли людина
       * сама відсунула мапу, а render перезапустився через styledata.
       */
      const fitKey = coordinates.length
        ? `${coordinates.length}:${coordinates[0]}:${coordinates[coordinates.length - 1]}`
        : waypoints.map((w) => `${w.lat},${w.lon}`).join('|');

      if (fitKey && fitKey !== fittedKeyRef.current) {
        fittedKeyRef.current = fitKey;
        if (coordinates.length > 1) {
          const bounds = coordinates.reduce(
            (b, c) => b.extend(c),
            new maplibregl.LngLatBounds(coordinates[0], coordinates[0]),
          );
          map.fitBounds(bounds, { padding: 60, duration: 0 });
        } else if (waypoints.length > 0) {
          map.jumpTo({ center: [waypoints[0]!.lon, waypoints[0]!.lat], zoom: 9 });
        }
      }
    };

    renderRef.current = render;
    render();

    /*
     * Поки стиль не застосувався, джерела `route` ще немає і малювати нема куди.
     * Подія `styledata` як сигнал готовності ненадійна: у пригальмованій
     * вкладці вона просто не приходить, і маршрут не з’являвся ніколи.
     * Тому коротко переопитуємо, поки джерело не з’явиться.
     */
    let timer: ReturnType<typeof setInterval> | undefined;
    if (!map.getSource('route')) {
      let attempts = 0;
      timer = setInterval(() => {
        const m = mapRef.current;
        if (!m) {
          clearInterval(timer);
          return;
        }
        if (attempts++ > 50) {
          clearInterval(timer);
          // Мовчазний порожній прямокутник — найгірше, що можна показати.
          // Якщо за 10 секунд стиль так і не піднявся, кажемо про це прямо.
          if (!m.getSource('route')) {
            setMapError(
              'Мапа не змогла завантажити стиль — маршрут порахований, але намалювати його ніде. ' +
                'Перевірте, чи не блокує розширення браузера запити до server.arcgisonline.com.',
            );
          }
          return;
        }
        renderRef.current();
        if (m.getSource('route')) {
          clearInterval(timer);
          setMapError(null);
        }
      }, 200);
    }

    map.on('styledata', render);
    return () => {
      if (timer) clearInterval(timer);
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

  // Курсор має підказувати, що зараз робить клік по мапі.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.getCanvas().style.cursor = pickMode ? 'crosshair' : '';
  }, [pickMode]);

  /*
   * Альтернативні зарядки. Клік по маркеру робить станцію обов'язковою зупинкою
   * (або знімає позначку) — далі App перепрокладе маршрут. Окремий шар від
   * «показати мережі»: тут лише те, що справді лежить уздовж цього маршруту.
   */
  const altMarkersRef = useRef<Marker[]>([]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    for (const m of altMarkersRef.current) m.remove();
    altMarkersRef.current = alternatives.map((a) => {
      const forced = forcedStationIds.includes(a.station.id);
      const el = document.createElement('div');
      el.className = `alt-dot${forced ? ' forced' : ''}`;
      el.title = `${a.station.name} · ${Math.round(a.station.maxPowerKw)} кВт`;
      el.textContent = forced ? '★' : '';
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        onToggleForced(a.station.id);
      });

      const price = priceLabel(a.station);
      return new maplibregl.Marker({ element: el })
        .setLngLat([a.station.lon, a.station.lat])
        .setPopup(
          new maplibregl.Popup({ offset: 12, closeButton: false }).setHTML(
            `<strong>${escapeHtml(a.station.name)}</strong><br/>` +
              `${Math.round(a.station.maxPowerKw)} кВт · ${Math.round(a.distanceKm)} км від старту` +
              (a.detourKm >= 0.3 ? ` · об'їзд ${a.detourKm} км` : '') +
              (a.station.networkName ? `<br/>${escapeHtml(a.station.networkName)}` : '') +
              (price ? `<br/><strong>${escapeHtml(price)}</strong>` : '') +
              `<br/><em>${forced ? 'Натисніть, щоб прибрати зупинку' : 'Натисніть, щоб зробити зупинкою'}</em>`,
          ),
        )
        .addTo(map);
    });

    return () => {
      for (const m of altMarkersRef.current) m.remove();
      altMarkersRef.current = [];
    };
  }, [alternatives, forcedStationIds, onToggleForced]);

  const appliedStyleRef = useRef(style.id);
  useEffect(() => {
    const map = mapRef.current;
    // Мапа вже створена з початковим стилем — перевстановлювати його не треба.
    if (!map || appliedStyleRef.current === style.id) return;
    appliedStyleRef.current = style.id;
    map.setStyle(style.makeStyle());
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
      {/* Згорнутий стан показує лише активний стиль — решта екрана лишається мапою. */}
      <div className={`map-styles${stylesOpen ? ' open' : ''}`}>
        {stylesOpen ? (
          MAP_STYLES.map((s) => (
            <button
              key={s.id}
              type="button"
              aria-pressed={s.id === style.id}
              onClick={() => {
                setStyle(s);
                setStylesOpen(false);
              }}
            >
              {s.label}
            </button>
          ))
        ) : (
          <button type="button" onClick={() => setStylesOpen(true)} title="Змінити вигляд мапи">
            {style.label} ▾
          </button>
        )}
      </div>
    </>
  );
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
