import type { LatLon, RoutePlan } from '../../src/types';
import { googleMapsPointLink, googleMapsRouteLinks, wazeLink } from '../lib/links';
import { paymentHint, priceLabel } from '../lib/payment';

const fmtDuration = (min: number): string => {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h > 0 ? `${h} год ${m} хв` : `${m} хв`;
};

export function PlanSummary({ plan }: { plan: RoutePlan }) {
  const routePoints: LatLon[] = [
    plan.waypoints[0]!,
    ...plan.stops.map((s) => ({ lat: s.station.lat, lon: s.station.lon })),
    plan.waypoints[plan.waypoints.length - 1]!,
  ];
  const gmapsLinks = googleMapsRouteLinks(routePoints);

  return (
    <>
      <div className="summary">
        <div className="summary-grid">
          <div className="stat">
            <div className="value">{fmtDuration(plan.totalDurationMin)}</div>
            <div className="label">Загальний час</div>
          </div>
          <div className="stat">
            <div className="value">{Math.round(plan.totalDistanceKm)} км</div>
            <div className="label">Відстань</div>
          </div>
          <div className="stat">
            <div className="value">{plan.stops.length}</div>
            <div className="label">
              {plan.stops.length === 1 ? 'зупинка' : 'зупинок'} · {fmtDuration(plan.chargingDurationMin)}
            </div>
          </div>
          <div className="stat">
            <div className="value">
              {plan.arrivalSocPct === null ? '—' : `${Math.round(plan.arrivalSocPct)} %`}
            </div>
            <div className="label">Заряд на фініші</div>
          </div>
        </div>

        <div className="stop-links">
          {gmapsLinks.map((href, i) => (
            <a key={href} className="link-btn" href={href} target="_blank" rel="noreferrer">
              Google Maps{gmapsLinks.length > 1 ? ` (${i + 1}/${gmapsLinks.length})` : ''}
            </a>
          ))}
        </div>
        {gmapsLinks.length > 1 && (
          <div className="muted">
            Google Maps тримає максимум 9 проміжних точок, тому маршрут розбито на частини.
          </div>
        )}
      </div>

      {plan.unreachable && (
        <div className="banner banner-error">
          Маршрут не вдалося прокласти повністю — не вистачає зарядок під заданими фільтрами.
        </div>
      )}

      {plan.tolls.hasTolls && (
        <div className="banner banner-warn">
          Маршрут проходить платними дорогами
          {plan.tolls.tollDistanceKm > 0 && ` (≈ ${Math.round(plan.tolls.tollDistanceKm)} км)`}.
        </div>
      )}

      {plan.warnings.map((w) => (
        <div key={w} className="banner banner-warn">
          {w}
        </div>
      ))}

      {plan.stops.length > 0 && (
        <div className="section">
          <h2>Зупинки на зарядку</h2>
          {plan.stops.map((s, i) => (
            <div className="stop" key={`${s.station.id}-${i}`}>
              <div className="stop-head">
                <span className="stop-index">{i + 1}</span>
                <span className="stop-name" title={s.station.name}>
                  {s.station.name}
                </span>
                <span className="stop-time">{s.totalStopMin} хв</span>
              </div>
              <div className="stop-meta">
                <span>
                  {Math.round(s.arrivalSocPct)} → {Math.round(s.departureSocPct)} %
                </span>
                <span>{Math.round(s.station.maxPowerKw)} кВт</span>
                <span>{s.energyAddedKwh} кВт·год</span>
                <span>{Math.round(s.distanceKm)} км від старту</span>
                {s.detourKm >= 0.3 && <span>об'їзд {s.detourKm} км</span>}
                {s.station.networkName && <span>{s.station.networkName}</span>}
              </div>
              <div className="stop-pay">
                <span className={s.station.isFree ? 'pay-free' : ''}>{paymentHint(s.station)}</span>
                {priceLabel(s.station) && <span className="price">{priceLabel(s.station)}</span>}
              </div>
              <div className="stop-links">
                <a
                  className="link-btn"
                  href={wazeLink(s.station)}
                  target="_blank"
                  rel="noreferrer"
                >
                  Waze
                </a>
                <a
                  className="link-btn"
                  href={googleMapsPointLink(s.station)}
                  target="_blank"
                  rel="noreferrer"
                >
                  Google Maps
                </a>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
