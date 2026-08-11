import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type AuthUser, type NetworkInfo, type SavedRouteSummary } from './api';
import { MapView } from './components/MapView';
import { WaypointInput } from './components/WaypointInput';
import { PlanSummary } from './components/PlanSummary';
import { Filters } from './components/Filters';
import { VehiclePicker } from './components/VehiclePicker';
import { AuthDialog } from './components/AuthDialog';
import type { PlanFilters, PlanRequest, PlanResponse, Vehicle, Waypoint } from '../src/types';

const DEFAULT_FILTERS: PlanFilters = {
  connectors: [],
  excludedNetworkIds: [],
  freeOnly: false,
  minPowerKw: 50,
  reserveSocPct: 10,
  maxDetourKm: 5,
  avoidTolls: false,
  temperatureC: 15,
};

export function App() {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [networks, setNetworks] = useState<NetworkInfo[]>([]);

  const [slots, setSlots] = useState<(Waypoint | null)[]>([null, null]);
  const [startSocPct, setStartSocPct] = useState(90);
  const [targetSocPct, setTargetSocPct] = useState(10);
  const [filters, setFilters] = useState<PlanFilters>(DEFAULT_FILTERS);

  const [result, setResult] = useState<PlanResponse | null>(null);
  const [variant, setVariant] = useState<'primary' | 'tollFree'>('primary');
  const [planning, setPlanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [user, setUser] = useState<AuthUser | null>(null);
  const [showAuth, setShowAuth] = useState(false);
  const [saved, setSaved] = useState<SavedRouteSummary[]>([]);

  useEffect(() => {
    api.vehicles().then((list) => {
      setVehicles(list);
      setVehicle((cur) => cur ?? list[0] ?? null);
    }).catch((e: Error) => setError(e.message));

    api.networks().then(setNetworks).catch(() => setNetworks([]));
    api.me().then(setUser).catch(() => setUser(null));
  }, []);

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
    return { waypoints, vehicle, startSocPct, targetSocPct, filters };
  };

  const runPlan = async () => {
    const req = buildRequest();
    if (!req) return;
    setPlanning(true);
    setError(null);
    try {
      const res = await api.plan(req);
      setResult(res);
      setVariant('primary');
    } catch (e) {
      setError((e as Error).message);
      setResult(null);
    } finally {
      setPlanning(false);
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

  const shownPlan =
    variant === 'tollFree' && result?.tollFree ? result.tollFree : result?.primary ?? null;

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="topbar">
          <div className="brand">
            <span>⚡</span> eplan
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
            {planning ? <span className="spinner" /> : 'Прокласти маршрут'}
          </button>

          {error && <div className="banner banner-error">{error}</div>}

          {result?.tollFree && (
            <div className="tabs">
              <button
                aria-selected={variant === 'primary'}
                onClick={() => setVariant('primary')}
              >
                Найшвидший
              </button>
              <button
                aria-selected={variant === 'tollFree'}
                onClick={() => setVariant('tollFree')}
              >
                Без платних доріг
              </button>
            </div>
          )}

          {shownPlan && <PlanSummary plan={shownPlan} />}

          {shownPlan && user && (
            <button className="btn" onClick={save}>
              Зберегти маршрут
            </button>
          )}

          {user && saved.length > 0 && (
            <div className="section">
              <h2>Збережені маршрути</h2>
              {saved.map((r) => (
                <div className="saved-item" key={r.id}>
                  <button className="name" onClick={() => openSaved(r.id)} title={r.name}>
                    {r.name}
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
            </div>
          )}
        </div>
      </aside>

      <div className="map-wrap">
        <MapView
          plan={shownPlan}
          waypoints={waypoints}
          onPickPoint={pickPoint}
          onMovePoint={movePoint}
        />
        <div className="map-hint">
          Клікніть по мапі, щоб поставити точку · маркер можна перетягнути
        </div>
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
