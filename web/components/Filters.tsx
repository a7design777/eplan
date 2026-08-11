import type { ConnectorType, PlanFilters } from '../../src/types';
import type { NetworkInfo } from '../api';

const CONNECTOR_LABELS: Record<ConnectorType, string> = {
  ccs: 'CCS',
  chademo: 'CHAdeMO',
  type2: 'Type 2',
  tesla: 'Tesla',
};

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
    onChange({ excludedNetworkIds: next });
  };

  return (
    <details className="filters">
      <summary>Фільтри та умови</summary>
      <div>
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
              min={3}
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
            <label htmlFor="f-temp">Температура, °C</label>
            <input
              id="f-temp"
              type="number"
              min={-40}
              max={55}
              step={1}
              value={filters.temperatureC}
              onChange={(e) => onChange({ temperatureC: Number(e.target.value) })}
            />
          </div>
        </div>

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
              Не використовувати мережі
              {filters.excludedNetworkIds.length > 0 && ` (${filters.excludedNetworkIds.length})`}
            </label>
            <div className="network-list">
              {networks.map((n) => (
                <label className="check" key={n.id}>
                  <input
                    type="checkbox"
                    checked={filters.excludedNetworkIds.includes(n.id)}
                    onChange={() => toggleNetwork(n.id)}
                  />
                  {n.name}
                  <span className="count">{n.station_count}</span>
                </label>
              ))}
            </div>
          </div>
        )}
      </div>
    </details>
  );
}
