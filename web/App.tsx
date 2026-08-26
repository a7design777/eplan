import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  api,
  type AuthUser,
  type Bbox,
  type NetworkInfo,
  type PlanStage,
  type SavedRouteSummary,
} from './api';
import { MapView } from './components/MapView';
import { WaypointInput } from './components/WaypointInput';
import { PlanSummary } from './components/PlanSummary';
import { Filters } from './components/Filters';
import { VehiclePicker } from './components/VehiclePicker';
import { AuthDialog } from './components/AuthDialog';
import { StationLayer } from './components/StationLayer';
import { StationDetails } from './components/StationDetails';
import {
  loadLocalPrefs,
  loadMapNetworks,
  saveLocalPrefs,
  saveMapNetworks,
} from './lib/prefs';
import { clearRouteLink, decodeRouteLink, encodeRouteLink } from './lib/share';
import type {
  PlanFilters,
  PlanRequest,
  PlanResponse,
  RoutePlan as RoutePlanView,
  Station,
  Vehicle,
  Waypoint,
} from '../src/types';

/** Що саме зараз робить сервер. Етапи справжні, не вигаданий відсоток. */
const STAGE_LABELS: Record<PlanStage, string> = {
  route: 'Шукаю дорогу…',
  stations: 'Підбираю зарядки…',
  alternatives: 'Рахую інші варіанти…',
  tollFree: 'Шукаю обхід платних…',
  cached: 'Готую збережений розрахунок…',
};

const DEFAULT_FILTERS: PlanFilters = {
  connectors: [],
  excludedNetworkIds: [],
  preferredNetworkIds: [],
  chargingStrategy: 'balanced',
  freeOnly: false,
  minPowerKw: 22,
  reserveSocPct: 10,
  maxDetourKm: 5,
  avoidTolls: false,
  useLiveWeather: true,
  temperatureC: 15,
};

export function App() {
  // Локальні налаштування читаємо синхронно, ще до першого рендера: інакше
  // обране авто на мить блимне дефолтним, поки їде запит за серверними.
  const local = useMemo(() => loadLocalPrefs(), []);

  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [vehicle, setVehicle] = useState<Vehicle | null>(local?.vehicle ?? null);
  const [networks, setNetworks] = useState<NetworkInfo[]>([]);

  const [slots, setSlots] = useState<(Waypoint | null)[]>([null, null]);
  const [startSocPct, setStartSocPct] = useState(local?.startSocPct ?? 90);
  const [targetSocPct, setTargetSocPct] = useState(local?.targetSocPct ?? 10);
  const [filters, setFilters] = useState<PlanFilters>({
    ...DEFAULT_FILTERS,
    ...(local?.filters ?? {}),
  });

  const [result, setResult] = useState<PlanResponse | null>(null);
  const [variant, setVariant] = useState<string>('primary');

  const [pickMode, setPickMode] = useState(false);
  /** Мобільний вигляд: мапа на весь екран замість половини під панеллю з підсумком. */
  const [mapFullscreen, setMapFullscreen] = useState(false);
  /** Станції, які користувач сам призначив зупинками на мапі. */
  const [forcedStationIds, setForcedStationIds] = useState<number[]>([]);
  const [selectedStation, setSelectedStation] = useState<Station | null>(null);

  /**
   * Додати або прибрати обов'язкову зупинку. Маршрут перебудовується не одразу:
   * користувач може обрати кілька станцій, а тоді натиснути «Прокласти».
   */
  const toggleForcedStation = useCallback((id: number) => {
    setForcedStationIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }, []);
  const [showAlternatives, setShowAlternatives] = useState(false);
  const [showStations, setShowStations] = useState(false);
  // Мережі для шару на мапі — окремо від улюблених у фільтрах.
  const [mapNetworkIds, setMapNetworkIds] = useState<number[]>(loadMapNetworks);
  const [mapFreeOnly, setMapFreeOnly] = useState(false);
  const [browseStations, setBrowseStations] = useState<Station[]>([]);
  const [bbox, setBbox] = useState<Bbox | null>(null);
  const [planning, setPlanning] = useState(false);
  const [stage, setStage] = useState<PlanStage | null>(null);
  const [stationsTruncated, setStationsTruncated] = useState(false);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [user, setUser] = useState<AuthUser | null>(null);
  const [showAuth, setShowAuth] = useState(false);
  const [saved, setSaved] = useState<SavedRouteSummary[]>([]);

  // Маршрут із посилання. Читаємо один раз: далі стан живе своїм життям.
  const shared = useMemo(() => decodeRouteLink(), []);

  useEffect(() => {
    if (!shared) return;
    setSlots(shared.waypoints);
    setVehicle(shared.vehicle);
    setStartSocPct(shared.startSocPct);
    setTargetSocPct(shared.targetSocPct);
    setFilters({ ...DEFAULT_FILTERS, ...shared.filters });
    setForcedStationIds(shared.forcedStationIds ?? []);
    clearRouteLink();
  }, [shared]);

  useEffect(() => {
    api.vehicles().then((list) => {
      setVehicles(list);
      setVehicle((cur) => cur ?? list[0] ?? null);
    }).catch((e: Error) => setError(e.message));

    api.networks().then(setNetworks).catch(() => setNetworks([]));
    api.me().then(setUser).catch(() => setUser(null));
  }, []);

  // Поки серверні налаштування не підвантажились, зберігати не можна:
  // інакше перший же рендер затре їх локальними.
  const hydratedRef = useRef(false);

  useEffect(() => {
    if (!user) {
      // Анонім працює на локальних налаштуваннях — вони вже застосовані.
      hydratedRef.current = true;
      return;
    }
    let cancelled = false;
    api
      .prefs()
      .then((p) => {
        if (cancelled || !p) return;
        // Налаштування акаунту головніші за локальні: користувач міг зайти
        // з іншого пристрою, і саме акаунт має бути джерелом правди.
        if (p.vehicle) setVehicle(p.vehicle);
        setStartSocPct(p.startSocPct);
        setTargetSocPct(p.targetSocPct);
        setFilters({ ...DEFAULT_FILTERS, ...p.filters });
      })
      .catch(() => {
        // Немає налаштувань або мережа впала — лишаємось на локальних.
      })
      .finally(() => {
        if (!cancelled) hydratedRef.current = true;
      });

    return () => {
      cancelled = true;
    };
  }, [user]);

  // Зберігаємо вибір авто, рівні заряду й фільтри. Точки маршруту не чіпаємо —
  // це разова поїздка, а не налаштування.
  useEffect(() => {
    if (!hydratedRef.current || !vehicle) return;
    const prefs = { vehicle, startSocPct, targetSocPct, filters };
    saveLocalPrefs(prefs);

    if (!user) return;
    // Повзунки заряду смикають цей ефект десятки разів — шлемо на сервер із паузою.
    const timer = setTimeout(() => {
      api.savePrefs(prefs).catch(() => {
        // Не збереглось на сервері — локальна копія все одно є.
      });
    }, 1200);

    return () => clearTimeout(timer);
  }, [vehicle, startSocPct, targetSocPct, filters, user]);

  const refreshSaved = useCallback(() => {
    if (!user) {
      setSaved([]);
      return;
    }
    api.savedRoutes().then(setSaved).catch(() => setSaved([]));
  }, [user]);

  useEffect(refreshSaved, [refreshSaved]);

  const waypoints = useMemo(() => slots.filter((s): s is Waypoint => s !== null), [slots]);

  /**
   * Шар станцій на мапі. Показуємо мережі, обрані як улюблені; якщо жодної
   * не обрано — усі, що влазять у ліміт. Запит іде на кожен рух мапи, тому
   * вимкнений шар не має коштувати нічого.
   */
  useEffect(() => {
    if (!showStations || !bbox) {
      setBrowseStations([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      api
        .stations(bbox, mapNetworkIds, mapFreeOnly ? 2 : filters.minPowerKw, mapFreeOnly)
        .then((r) => {
          if (cancelled) return;
          setBrowseStations(r.stations);
          setStationsTruncated(r.truncated);
        })
        .catch(() => {
          if (cancelled) return;
          setBrowseStations([]);
          setStationsTruncated(false);
        });
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [showStations, bbox, mapNetworkIds, mapFreeOnly, filters.minPowerKw]);

  useEffect(() => saveMapNetworks(mapNetworkIds), [mapNetworkIds]);

  /**
   * Клік по мапі заповнює перший порожній слот, а якщо порожніх немає —
   * додає проміжну точку перед фінішем. Назву тягнемо зворотним геокодуванням,
   * але точка стає на місце одразу: чекати на мережу заради підпису безглуздо.
   */
  const pickPoint = useCallback((lat: number, lon: number) => {
    const placeholder: Waypoint = { lat, lon, name: `${lat.toFixed(4)}, ${lon.toFixed(4)}` };
    let targetIndex = -1;

    setSlots((prev) => {
      const emptyIndex = prev.findIndex((s) => s === null);
      if (emptyIndex !== -1) {
        targetIndex = emptyIndex;
        return prev.map((s, i) => (i === emptyIndex ? placeholder : s));
      }
      targetIndex = prev.length - 1;
      return [...prev.slice(0, -1), placeholder, prev[prev.length - 1]!];
    });

    void api
      .reverse(lat, lon)
      .then((named) => {
        setSlots((prev) =>
          prev.map((s, i) =>
            i === targetIndex && s?.lat === lat && s?.lon === lon ? named : s,
          ),
        );
      })
      .catch(() => {
        // Назва не критична — координати вже показані.
      });
  }, []);

  /** Поставити поточне місцеположення стартовою точкою. */
  const useMyLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setError('Браузер не підтримує геолокацію');
      return;
    }
    setLocating(true);
    setError(null);

    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        const { latitude: lat, longitude: lon } = coords;
        const placeholder: Waypoint = { lat, lon, name: `${lat.toFixed(4)}, ${lon.toFixed(4)}` };
        setSlots((prev) => prev.map((s, i) => (i === 0 ? placeholder : s)));
        try {
          const named = await api.reverse(lat, lon);
          setSlots((prev) => prev.map((s, i) => (i === 0 ? named : s)));
        } catch {
          // Назва не критична — координати вже стоять.
        } finally {
          setLocating(false);
        }
      },
      (err) => {
        setLocating(false);
        setError(
          err.code === err.PERMISSION_DENIED
            ? 'Доступ до геолокації заборонено — дозвольте його в налаштуваннях браузера'
            : 'Не вдалося визначити місцеположення',
        );
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
    );
  }, []);

  const movePoint = useCallback((index: number, lat: number, lon: number) => {
    const placeholder: Waypoint = { lat, lon, name: `${lat.toFixed(4)}, ${lon.toFixed(4)}` };
    // waypoints — це slots без порожніх, тому індекс маркера треба перевести в індекс слота.
    setSlots((prev) => {
      const filledIndexes = prev.map((s, i) => (s ? i : -1)).filter((i) => i !== -1);
      const slotIndex = filledIndexes[index];
      if (slotIndex === undefined) return prev;
      return prev.map((s, i) => (i === slotIndex ? placeholder : s));
    });

    void api
      .reverse(lat, lon)
      .then((named) => {
        setSlots((prev) =>
          prev.map((s) => (s?.lat === lat && s?.lon === lon ? named : s)),
        );
      })
      .catch(() => {});
  }, []);
  const canPlan = waypoints.length >= 2 && vehicle !== null && !planning;

  const buildRequest = (): PlanRequest | null => {
    if (!vehicle || waypoints.length < 2) return null;
    return { waypoints, vehicle, startSocPct, targetSocPct, filters, forcedStationIds };
  };

  const runPlan = async () => {
    const req = buildRequest();
    if (!req) return;
    setPlanning(true);
    setStage(null);
    setError(null);
    try {
      const res = await api.planWithProgress(req, setStage);
      setResult(res);
      setVariant('primary');
    } catch (e) {
      setError((e as Error).message);
      setResult(null);
    } finally {
      setPlanning(false);
      setStage(null);
    }
  };

  const save = async () => {
    const req = buildRequest();
    if (!req) return;
    const name = window.prompt(
      'Назва маршруту',
      `${req.waypoints[0]!.name ?? 'Старт'} → ${req.waypoints[req.waypoints.length - 1]!.name ?? 'Фініш'}`,
    );
    if (!name) return;
    try {
      await api.saveRoute(name, req, result);
      refreshSaved();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const [shareLabel, setShareLabel] = useState('Поділитись');

  const share = async () => {
    const req = buildRequest();
    if (!req) return;
    const link = encodeRouteLink(req);
    const title = `${req.waypoints[0]?.name ?? 'Старт'} → ${req.waypoints[req.waypoints.length - 1]?.name ?? 'Фініш'}`;

    // На телефоні системний «поділитись» зручніший за копіювання в буфер.
    if (navigator.share) {
      try {
        await navigator.share({ title, url: link });
        return;
      } catch {
        // Користувач закрив вікно або система відмовила — падаємо на буфер.
      }
    }
    try {
      await navigator.clipboard.writeText(link);
      setShareLabel('Скопійовано ✓');
      setTimeout(() => setShareLabel('Поділитись'), 2000);
    } catch {
      setError('Не вдалося скопіювати посилання');
    }
  };

  const openSaved = async (id: string) => {
    try {
      const row = await api.savedRoute(id);
      setSlots(row.request.waypoints);
      setVehicle(row.request.vehicle);
      setStartSocPct(row.request.startSocPct);
      setTargetSocPct(row.request.targetSocPct);
      setFilters(row.request.filters);
      setResult(row.plan);
      setVariant('primary');
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const variants = useMemo(() => {
    if (!result) return [];
    const list: { id: string; label: string; plan: RoutePlanView }[] = [
      { id: 'primary', label: 'Основний', plan: result.primary },
    ];
    if (result.tollFree) {
      list.push({ id: 'tollFree', label: 'Без платних доріг', plan: result.tollFree });
    }
    result.alternatives.forEach((p, i) => {
      list.push({ id: `alt${i}`, label: `Варіант ${i + 2}`, plan: p });
    });
    return list;
  }, [result]);

  const shownPlan =
    variants.find((v) => v.id === variant)?.plan ?? result?.primary ?? null;

  return (
    <div className={`app${mapFullscreen ? ' map-fullscreen' : ''}`}>
      <aside className="sidebar">
        <div className="topbar">
          <div className="brand">
            <span>⚡</span> eplan
            <span className="version" title={`Коміт ${__COMMIT_HASH__}`}>
              v{__APP_VERSION__}+{__COMMIT_HASH__}
            </span>
          </div>
          {user ? (
            <>
              <span className="muted" title={user.email}>
                {user.email.split('@')[0]}
              </span>
              <button
                className="btn-plain"
                onClick={async () => {
                  await api.logout();
                  setUser(null);
                }}
              >
                Вийти
              </button>
            </>
          ) : (
            <button className="btn" onClick={() => setShowAuth(true)}>
              Увійти
            </button>
          )}
        </div>

        <div className="sidebar-scroll">
          <div className="section">
            <h2>Маршрут</h2>
            {slots.map((slot, i) => (
              <div className="waypoint" key={i}>
                <span className="waypoint-dot">
                  {i === 0 ? 'A' : i === slots.length - 1 ? 'B' : i}
                </span>
                <WaypointInput
                  value={slot}
                  placeholder={
                    i === 0 ? 'Звідки' : i === slots.length - 1 ? 'Куди' : 'Проміжна точка'
                  }
                  onChange={(w) =>
                    setSlots((prev) => prev.map((s, idx) => (idx === i ? w : s)))
                  }
                />
                {i === 0 && (
                  <button
                    className="btn-plain"
                    title="Моє місцеположення"
                    aria-label="Моє місцеположення"
                    disabled={locating}
                    onClick={useMyLocation}
                  >
                    {locating ? <span className="spinner" /> : '◎'}
                  </button>
                )}
                {slots.length > 2 && (
                  <button
                    className="btn-plain"
                    title="Прибрати точку"
                    onClick={() => setSlots((prev) => prev.filter((_, idx) => idx !== i))}
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
            {slots.length < 10 && (
              <button
                className="btn"
                onClick={() =>
                  // Нова точка стає передостанньою: фініш завжди лишається внизу.
                  setSlots((prev) => [...prev.slice(0, -1), null, prev[prev.length - 1]!])
                }
              >
                + Проміжна точка
              </button>
            )}
          </div>

          {vehicle && (
            <VehiclePicker vehicles={vehicles} value={vehicle} onChange={setVehicle} />
          )}

          <div className="section">
            <h2>Заряд</h2>
            <div className="field">
              <label htmlFor="soc-start">Старт: {startSocPct} %</label>
              <input
                id="soc-start"
                type="range"
                min={1}
                max={100}
                value={startSocPct}
                onChange={(e) => setStartSocPct(Number(e.target.value))}
              />
            </div>
            <div className="field">
              <label htmlFor="soc-target">Мінімум на фініші: {targetSocPct} %</label>
              <input
                id="soc-target"
                type="range"
                min={0}
                max={90}
                value={targetSocPct}
                onChange={(e) => setTargetSocPct(Number(e.target.value))}
              />
            </div>
          </div>

          {vehicle && (
            <Filters
              filters={filters}
              networks={networks}
              vehicleConnectors={vehicle.connectors}
              onChange={(patch) => setFilters((f) => ({ ...f, ...patch }))}
            />
          )}

          <button className="btn btn-primary btn-block" disabled={!canPlan} onClick={runPlan}>
            {planning ? (
              <>
                <span className="spinner" />
                <span className="stage-label">{STAGE_LABELS[stage ?? 'route']}</span>
              </>
            ) : (
              'Прокласти маршрут'
            )}
          </button>

          {error && <div className="banner banner-error">{error}</div>}

          {variants.length > 1 && (
            <div className="tabs">
              {variants.map((v) => (
                <button
                  key={v.id}
                  aria-selected={variant === v.id}
                  title={`${Math.round(v.plan.totalDurationMin / 60)} год · ${Math.round(v.plan.totalDistanceKm)} км`}
                  onClick={() => setVariant(v.id)}
                >
                  {v.label}
                </button>
              ))}
            </div>
          )}

          {shownPlan && <PlanSummary plan={shownPlan} />}

          {shownPlan && (
            <div className="row">
              <button className="btn" onClick={share}>
                {shareLabel}
              </button>
              {user && (
                <button className="btn" onClick={save}>
                  Зберегти маршрут
                </button>
              )}
            </div>
          )}

          {user && saved.length > 0 && (
            <details className="section collapsible">
              <summary>Збережені маршрути ({saved.length})</summary>
              {saved.map((r) => (
                <div className="saved-item" key={r.id}>
                  <button className="name" onClick={() => openSaved(r.id)} title={r.name}>
                    {r.name}
                  </button>
                  <button
                    className="btn-plain"
                    title="Перейменувати"
                    onClick={async () => {
                      const name = window.prompt('Нова назва маршруту', r.name);
                      if (!name || name.trim() === r.name) return;
                      try {
                        await api.renameRoute(r.id, name);
                        refreshSaved();
                      } catch (e) {
                        setError((e as Error).message);
                      }
                    }}
                  >
                    ✎
                  </button>
                  <button
                    className="btn-plain"
                    title="Видалити"
                    onClick={async () => {
                      if (!window.confirm(`Видалити «${r.name}»?`)) return;
                      await api.deleteRoute(r.id);
                      refreshSaved();
                    }}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </details>
          )}
        </div>
      </aside>

      <div className="map-wrap">
        <MapView
          plan={shownPlan}
          waypoints={waypoints}
          browseStations={browseStations}
          onViewportChange={setBbox}
          alternatives={showAlternatives ? shownPlan?.nearbyStations ?? [] : []}
          forcedStationIds={forcedStationIds}
          onSelectStation={setSelectedStation}
          pickMode={pickMode}
          onPickPoint={pickPoint}
          onMovePoint={movePoint}
        />

        {selectedStation && (
          <StationDetails
            station={selectedStation}
            forced={forcedStationIds.includes(selectedStation.id)}
            onToggleForced={toggleForcedStation}
            onClose={() => setSelectedStation(null)}
          />
        )}

        {pickMode && (
          <div className="map-hint">Торкніться мапи, щоб поставити точку маршруту</div>
        )}

        <div className="map-toggles">
          {shownPlan && (
            <button
              className={`map-toggle map-fullscreen-toggle${mapFullscreen ? ' on' : ''}`}
              onClick={() => setMapFullscreen((v) => !v)}
              title="Мапа на весь екран"
            >
              {mapFullscreen ? '✕ Закрити' : '⛶ На весь екран'}
            </button>
          )}
          <button
            className={`map-toggle${pickMode ? ' on' : ''}`}
            onClick={() => setPickMode((v) => !v)}
          >
            {pickMode ? '✓ Ставлю точки' : '＋ Точка на мапі'}
          </button>
          <button
            className={`map-toggle${showStations ? ' on' : ''}`}
            onClick={() => setShowStations((v) => !v)}
            title="Показати станції на мапі та обрати мережі"
          >
            {showStations ? '✓ Станції' : '○ Станції'}
            {showStations && mapNetworkIds.length > 0 && ` · ${mapNetworkIds.length} мереж`}
          </button>

          {shownPlan && (
            <button
              className={`map-toggle${showAlternatives ? ' on' : ''}`}
              onClick={() => setShowAlternatives((v) => !v)}
              title="Інші зарядки вздовж маршруту — можна зробити зупинкою"
            >
              {showAlternatives ? '✓ Альтернативи' : '○ Альтернативи'}
              {showAlternatives && ` · ${shownPlan.nearbyStations.length}`}
            </button>
          )}

          {forcedStationIds.length > 0 && (
            <button
              className="map-toggle on"
              onClick={() => setForcedStationIds([])}
              title="Прибрати всі зупинки, обрані вручну"
            >
              ★ Мої зупинки · {forcedStationIds.length} ✕
            </button>
          )}
        </div>

        {showStations && (
          <StationLayer
            networks={networks}
            selected={mapNetworkIds}
            count={browseStations.length}
            truncated={stationsTruncated}
            freeOnly={mapFreeOnly}
            onChange={setMapNetworkIds}
            onFreeOnlyChange={setMapFreeOnly}
            onClose={() => setShowStations(false)}
          />
        )}
      </div>

      {showAuth && (
        <AuthDialog
          onClose={() => setShowAuth(false)}
          onAuth={(u) => setUser(u)}
        />
      )}
    </div>
  );
}
