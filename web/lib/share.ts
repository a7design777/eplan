import type { PlanRequest } from '../../src/types';

/**
 * Маршрут у посиланні.
 *
 * Кодуємо сам запит, а не порахований план: план великий (полілінія на тисячі
 * точок) і швидко застаріває — ціни й станції змінюються. Той, хто відкриє
 * посилання, отримає свіжий розрахунок того самого маршруту.
 *
 * base64url від JSON: посилання виходить довге, але не потребує ні бази,
 * ні реєстрації — саме те, чого бракувало.
 */
const PARAM = 'r';

function toBase64Url(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): string {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function encodeRouteLink(req: PlanRequest): string {
  // Авто цілком тягне за собою криву зарядки — це найбільша частина посилання,
  // але без неї на іншому пристрої маршрут порахується для чужої машини.
  const payload = {
    w: req.waypoints.map((p) => [Number(p.lat.toFixed(5)), Number(p.lon.toFixed(5)), p.name ?? '']),
    v: req.vehicle,
    s: req.startSocPct,
    t: req.targetSocPct,
    f: req.filters,
  };
  const url = new URL(window.location.href);
  url.hash = '';
  url.search = `?${PARAM}=${toBase64Url(JSON.stringify(payload))}`;
  return url.toString();
}

/** Читає маршрут з адреси. null — у посиланні його немає або воно зіпсоване. */
export function decodeRouteLink(): PlanRequest | null {
  try {
    const raw = new URLSearchParams(window.location.search).get(PARAM);
    if (!raw) return null;

    const p = JSON.parse(fromBase64Url(raw)) as {
      w: [number, number, string][];
      v: PlanRequest['vehicle'];
      s: number;
      t: number;
      f: PlanRequest['filters'];
    };
    if (!Array.isArray(p.w) || p.w.length < 2 || !p.v) return null;

    return {
      waypoints: p.w.map(([lat, lon, name]) => ({ lat, lon, name: name || undefined })),
      vehicle: p.v,
      startSocPct: p.s,
      targetSocPct: p.t,
      filters: p.f,
    };
  } catch {
    // Обрізане чи підправлене посилання — просто відкриваємо порожній планувальник.
    return null;
  }
}

/** Прибирає маршрут з адреси, щоб перезавантаження не тягло старий. */
export function clearRouteLink(): void {
  const url = new URL(window.location.href);
  url.search = '';
  window.history.replaceState(null, '', url.toString());
}
