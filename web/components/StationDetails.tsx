import type { Station } from '../../src/types';
import { CONNECTOR_LABELS } from '../lib/connectors';
import { priceLabel } from '../lib/payment';
import { googleMapsPointLink, wazeLink } from '../lib/links';

interface Props {
  station: Station;
  /** Чи вже додана до маршруту як обов'язкова зупинка. */
  forced: boolean;
  onToggleForced: (id: number) => void;
  onClose: () => void;
}

/**
 * Способи оплати, які реально відомі з OCM.
 *
 * OCM розрізняє оплату на місці, потребу в членстві та потребу у фізичній
 * картці-ключі. Звідси й формулювання: «лише RFID-картка» кажемо тільки коли
 * ключ потрібен, а оплати на місці немає.
 */
function paymentLines(s: Station): string[] {
  if (s.isFree) return ['Безкоштовно'];

  const out: string[] = [];
  if (s.payAtLocation) out.push('Картою або терміналом на місці');
  if (s.accessKeyRequired) {
    out.push(
      s.payAtLocation
        ? 'Приймає також RFID-картку мережі'
        : 'Потрібна RFID-картка мережі — без неї не запустити',
    );
  }
  if (s.membershipRequired && !s.accessKeyRequired) {
    out.push('Потрібен акаунт або застосунок мережі');
  }

  if (out.length === 0) {
    out.push(
      s.networkName
        ? `Спосіб оплати не вказано — найімовірніше застосунок ${s.networkName}`
        : 'Спосіб оплати не вказано',
    );
  }
  return out;
}

function verifiedLabel(s: Station): string {
  if (s.lastVerified === null) return 'Дані ніколи не підтверджували';
  const days = Math.floor((Date.now() / 1000 - s.lastVerified) / 86400);
  if (days < 60) return `Дані підтверджено ${days} дн. тому`;
  const months = Math.floor(days / 30);
  if (months < 24) return `Дані підтверджено ${months} міс. тому`;
  return `Дані підтверджено ${Math.floor(days / 365)} р. тому`;
}

export function StationDetails({ station, forced, onToggleForced, onClose }: Props) {
  const price = priceLabel(station);

  return (
    <div className="station-details">
      <div className="station-details-head">
        <strong title={station.name}>{station.name}</strong>
        <button className="btn-plain" onClick={onClose} title="Закрити">
          ✕
        </button>
      </div>

      {!station.statusOperational && (
        <div className="banner banner-error">Станція позначена як непрацююча</div>
      )}

      <div className="station-facts">
        <span className="fact-power">{Math.round(station.maxPowerKw)} кВт</span>
        <span>{station.portCount} портів</span>
        {station.networkName && <span>{station.networkName}</span>}
      </div>

      {station.ports.length > 0 && (
        <div className="station-ports">
          {station.ports.map((p) => (
            <div className="port" key={`${p.type}-${p.powerKw}`}>
              <span className="port-type">{CONNECTOR_LABELS[p.type]}</span>
              <span className="port-power">{Math.round(p.powerKw)} кВт</span>
              <span className="port-count">×{p.count}</span>
            </div>
          ))}
        </div>
      )}

      <div className="station-section">
        <span className="station-label">Ціна</span>
        {price ? <span className="price">{price}</span> : <span className="muted">не вказана</span>}
      </div>

      <div className="station-section">
        <span className="station-label">Як платити</span>
        {paymentLines(station).map((line) => (
          <span key={line}>{line}</span>
        ))}
      </div>

      {/*
        OCM не має даних про зайнятість у реальному часі — жодне безкоштовне
        джерело їх не дає. Краще сказати прямо, ніж лишити користувача гадати,
        чому такого поля немає.
      */}
      <div className="station-section">
        <span className="station-label">Зайнятість</span>
        <span className="muted">
          Невідома — джерело даних не показує, скільки портів вільно зараз
        </span>
      </div>

      {station.address && <div className="muted">{station.address}</div>}
      <div className="muted">{verifiedLabel(station)}</div>

      <button
        className={`btn ${forced ? '' : 'btn-primary'} btn-block`}
        onClick={() => onToggleForced(station.id)}
      >
        {forced ? '✕ Прибрати з маршруту' : '＋ Додати до маршруту'}
      </button>

      <div className="stop-links">
        <a className="link-btn" href={wazeLink(station)} target="_blank" rel="noreferrer">
          Waze
        </a>
        <a
          className="link-btn"
          href={googleMapsPointLink(station)}
          target="_blank"
          rel="noreferrer"
        >
          Google Maps
        </a>
      </div>
    </div>
  );
}
