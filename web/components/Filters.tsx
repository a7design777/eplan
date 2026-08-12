import type { ChargingStrategy, ConnectorType, PlanFilters } from '../../src/types';
import type { NetworkInfo } from '../api';
import { CONNECTOR_LABELS } from '../lib/connectors';

const STRATEGIES: { id: ChargingStrategy; label: string; hint: string }[] = [
  { id: 'fewest_stops', label: 'Менше зупинок', hint: 'Їхати якнайдалі, заряджатись до 95 %' },
  { id: 'balanced', label: 'Збалансовано', hint: 'Компроміс між кількістю зупинок і часом' },
  { id: 'short_stops', label: 'Часті короткі', hint: 'Кожні ~130 км до 70 % — найшвидша частина кривої' },
];

interface Props {
  filters: PlanFilters;
  networks: NetworkInfo[];
  vehicleConnectors: ConnectorType[];
  onChange: (patch: Partial<PlanFilters>) => void;
}

export function Filters({ filters, networks, vehicleConnectors, onChange }: Props) {
  const toggleConnector = (c: ConnectorType) => {
    const next = filters.connectors.includes(c)
      ? filters.connectors.filter((x) => x !== c)
      : [...filters.connectors, c];
    onChange({ connectors: next });
  };

  const toggleNetwork = (id: number) => {
    const next = filters.excludedNetworkIds.includes(id)
      ? filters.excludedNetworkIds.filter((x) => x !== id)
      : [...filters.excludedNetworkIds, id];
    // Не можна одночасно любити мережу і виключати її.
    onChange({
      excludedNetworkIds: next,
      preferredNetworkIds: filters.preferredNetworkIds.filter((x) => !next.includes(x)),
    });
  };

  const toggleFavourite = (id: number) => {
    const next = filters.preferredNetworkIds.includes(id)
      ? filters.preferredNetworkIds.filter((x) => x !== id)
      : [...filters.preferredNetworkIds, id];
    onChange({
      preferredNetworkIds: next,
      excludedNetworkIds: filters.excludedNetworkIds.filter((x) => !next.includes(x)),
    });
  };

  return (
    <details className="filters">
      <summary>Фільтри та умови</summary>
      <div>
        <div className="field">
          <label>Як їхати</label>
          <div className="chips">
            {STRATEGIES.map((s) => (
              <button
                key={s.id}
                type="button"
                className="chip"
                title={s.hint}
                aria-pressed={filters.chargingStrategy === s.id}
                onClick={() => onChange({ chargingStrategy: s.id })}
              >
                {s.label}
              </button>
            ))}
          </div>
          <span className="muted">
            {STRATEGIES.find((s) => s.id === filters.chargingStrategy)?.hint}
          </span>
        </div>

        <div className="field">
          <label>Конектори {filters.connectors.length === 0 && '(усі доступні авто)'}</label>
          <div className="chips">
            {vehicleConnectors.map((c) => (
              <button
                key={c}
                type="button"
                className="chip"
                aria-pressed={filters.connectors.includes(c)}
                onClick={() => toggleConnector(c)}
              >
                {CONNECTOR_LABELS[c]}
              </button>
            ))}
          </div>
        </div>

        <div className="row">
          <div className="field">
            <label htmlFor="f-power">Мін. потужність, кВт</label>
            <input
              id="f-power"
              type="number"
              min={2}
              max={400}
              step={1}
              value={filters.minPowerKw}
              onChange={(e) => onChange({ minPowerKw: Number(e.target.value) })}
            />
          </div>
          <div className="field">
            <label htmlFor="f-detour">Макс. об'їзд, км</label>
            <input
              id="f-detour"
              type="number"
              min={0.5}
              max={30}
              step={0.5}
              value={filters.maxDetourKm}
              onChange={(e) => onChange({ maxDetourKm: Number(e.target.value) })}
            />
          </div>
        </div>

        <div className="row">
          <div className="field">
            <label htmlFor="f-reserve">Резерв заряду, %</label>
            <input
              id="f-reserve"
              type="number"
              min={0}
              max={50}
              step={1}
              value={filters.reserveSocPct}
              onChange={(e) => onChange({ reserveSocPct: Number(e.target.value) })}
            />
          </div>
          <div className="field">
            <label htmlFor="f-temp">
              Температура, °C {filters.useLiveWeather && '(з прогнозу)'}
            </label>
            <input
              id="f-temp"
              type="number"
              min={-40}
              max={55}
              step={1}
              disabled={filters.useLiveWeather}
              value={filters.temperatureC}
              onChange={(e) => onChange({ temperatureC: Number(e.target.value) })}
            />
          </div>
        </div>

        <label className="check">
          <input
            type="checkbox"
            checked={filters.useLiveWeather}
            onChange={(e) => onChange({ useLiveWeather: e.target.checked })}
          />
          Брати температуру з прогнозу
        </label>

        <label className="check">
          <input
            type="checkbox"
            checked={filters.freeOnly}
            onChange={(e) => onChange({ freeOnly: e.target.checked })}
          />
          Тільки безкоштовні зарядки
        </label>

        <label className="check">
          <input
            type="checkbox"
            checked={filters.avoidTolls}
            onChange={(e) => onChange({ avoidTolls: e.target.checked })}
          />
          Уникати платних доріг
        </label>

        {networks.length > 0 && (
          <div className="field">
            <label>
              Мережі — ★ улюблені, ✓ виключити
              {filters.preferredNetworkIds.length > 0 &&
                ` · улюблених ${filters.preferredNetworkIds.length}`}
              {filters.excludedNetworkIds.length > 0 &&
                ` · виключено ${filters.excludedNetworkIds.length}`}
            </label>
            <div className="network-list">
              {networks.map((n) => (
                <div className="network-row" key={n.id}>
                  <button
                    type="button"
                    className="star"
                    title={
                      filters.preferredNetworkIds.includes(n.id)
                        ? 'Прибрати з улюблених'
                        : 'Віддавати перевагу цій мережі'
                    }
                    aria-pressed={filters.preferredNetworkIds.includes(n.id)}
                    onClick={() => toggleFavourite(n.id)}
                  >
                    {filters.preferredNetworkIds.includes(n.id) ? '★' : '☆'}
                  </button>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={filters.excludedNetworkIds.includes(n.id)}
                      onChange={() => toggleNetwork(n.id)}
                    />
                    {n.name}
                    <span className="count">{n.station_count}</span>
                  </label>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </details>
  );
}
