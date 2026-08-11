import type { ConnectorType, Vehicle } from '../../src/types';

const CUSTOM_ID = '__custom__';

/**
 * Узагальнена крива для авто, введеного вручну: плато до 40 % і плавний спад далі.
 * Точна крива конкретної моделі невідома, тому беремо консервативну форму —
 * краще недооцінити швидкість зарядки, ніж пообіцяти нездійсненний час.
 */
export function customCurve(maxDcPowerKw: number): Vehicle['chargeCurve'] {
  return [
    { socPct: 0, powerKw: maxDcPowerKw * 0.8 },
    { socPct: 15, powerKw: maxDcPowerKw },
    { socPct: 40, powerKw: maxDcPowerKw * 0.85 },
    { socPct: 60, powerKw: maxDcPowerKw * 0.6 },
    { socPct: 80, powerKw: maxDcPowerKw * 0.33 },
    { socPct: 100, powerKw: maxDcPowerKw * 0.07 },
  ];
}

export function makeCustomVehicle(base?: Partial<Vehicle>): Vehicle {
  const maxDcPowerKw = base?.maxDcPowerKw ?? 100;
  return {
    id: CUSTOM_ID,
    make: 'Своє',
    model: 'авто',
    batteryKwh: base?.batteryKwh ?? 60,
    baseConsumptionWhPerKm: base?.baseConsumptionWhPerKm ?? 175,
    maxDcPowerKw,
    maxAcPowerKw: 11,
    connectors: base?.connectors ?? ['ccs', 'type2'],
    chargeCurve: customCurve(maxDcPowerKw),
  };
}

const ALL_CONNECTORS: ConnectorType[] = ['ccs', 'chademo', 'type2', 'tesla'];

interface Props {
  vehicles: Vehicle[];
  value: Vehicle;
  onChange: (v: Vehicle) => void;
}

export function VehiclePicker({ vehicles, value, onChange }: Props) {
  const isCustom = value.id === CUSTOM_ID;

  const patchCustom = (patch: Partial<Vehicle>) => {
    const next = makeCustomVehicle({ ...value, ...patch });
    onChange(next);
  };

  return (
    <div className="section">
      <h2>Авто</h2>
      <select
        value={value.id}
        aria-label="Модель авто"
        onChange={(e) => {
          if (e.target.value === CUSTOM_ID) {
            onChange(makeCustomVehicle(value));
            return;
          }
          const picked = vehicles.find((v) => v.id === e.target.value);
          if (picked) onChange(picked);
        }}
      >
        {vehicles.map((v) => (
          <option key={v.id} value={v.id}>
            {v.make} {v.model} · {v.batteryKwh} кВт·год
          </option>
        ))}
        <option value={CUSTOM_ID}>Своє авто (ввести вручну)</option>
      </select>

      {isCustom ? (
        <>
          <div className="row">
            <div className="field">
              <label htmlFor="v-battery">Батарея, кВт·год</label>
              <input
                id="v-battery"
                type="number"
                min={5}
                max={300}
                step={0.5}
                value={value.batteryKwh}
                onChange={(e) => patchCustom({ batteryKwh: Number(e.target.value) })}
              />
            </div>
            <div className="field">
              <label htmlFor="v-cons">Споживання, Вт·год/км</label>
              <input
                id="v-cons"
                type="number"
                min={60}
                max={500}
                step={1}
                value={value.baseConsumptionWhPerKm}
                onChange={(e) => patchCustom({ baseConsumptionWhPerKm: Number(e.target.value) })}
              />
            </div>
          </div>
          <div className="field">
            <label htmlFor="v-dc">Макс. потужність DC, кВт</label>
            <input
              id="v-dc"
              type="number"
              min={3}
              max={1000}
              step={1}
              value={value.maxDcPowerKw}
              onChange={(e) => patchCustom({ maxDcPowerKw: Number(e.target.value) })}
            />
          </div>
          <div className="field">
            <label>Конектори</label>
            <div className="chips">
              {ALL_CONNECTORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className="chip"
                  aria-pressed={value.connectors.includes(c)}
                  onClick={() => {
                    const next = value.connectors.includes(c)
                      ? value.connectors.filter((x) => x !== c)
                      : [...value.connectors, c];
                    // Без жодного конектора планувати нічого — лишаємо останній.
                    if (next.length > 0) patchCustom({ connectors: next });
                  }}
                >
                  {c === 'ccs' ? 'CCS' : c === 'chademo' ? 'CHAdeMO' : c === 'type2' ? 'Type 2' : 'Tesla'}
                </button>
              ))}
            </div>
          </div>
          <span className="muted">
            Крива зарядки для власного авто береться усереднена — час зупинок буде приблизним.
          </span>
        </>
      ) : (
        <span className="muted">
          {value.baseConsumptionWhPerKm} Вт·год/км · до {value.maxDcPowerKw} кВт ·{' '}
          {value.connectors.join(', ').toUpperCase()}
        </span>
      )}
    </div>
  );
}
