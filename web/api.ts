import type { PlanRequest, PlanResponse, Station, Vehicle, Waypoint } from '../src/types';
import type { UserPrefs } from './lib/prefs';

export interface Bbox {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

export interface AuthUser {
  id: string;
  email: string;
}

export interface NetworkInfo {
  id: number;
  name: string;
  station_count: number;
}

export interface SavedRouteSummary {
  id: string;
  name: string;
  created_at: number;
  updated_at: number;
}

export class ApiError extends Error {}

/**
 * Розшифровує відповіді, які повернув не наш Worker, а платформа.
 *
 * Найважливіший випадок — 1102: Worker вичерпав процесорний час. Користувач
 * бачив просто «503», з чого неможливо зрозуміти ні причину, ні що робити.
 */
function describeGatewayError(status: number, body: string): string {
  if (body.includes('1102')) {
    return (
      'Розрахунок виявився заважким і його перервано на сервері. ' +
      'Спробуйте коротший маршрут або зменшіть «макс. об’їзд» у фільтрах.'
    );
  }
  if (body.includes('1101')) {
    return 'Сервер обробки маршруту завершився з помилкою. Спробуйте ще раз.';
  }
  if (status === 502 || status === 503 || status === 504) {
    return `Сервер тимчасово недоступний (${status}). Спробуйте за хвилину.`;
  }
  return `Некоректна відповідь сервера (${status})`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });

  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // Не JSON — це сторінка помилки Cloudflare, тобто запит не дійшов до
    // нашого коду і пояснити його нікому. Розшифровуємо самі.
    throw new ApiError(describeGatewayError(res.status, text));
  }

  if (!res.ok) {
    const message =
      body && typeof body === 'object' && 'error' in body
        ? String((body as { error: unknown }).error)
        : `Помилка ${res.status}`;
    throw new ApiError(message);
  }
  return body as T;
}

export type PlanStage = 'route' | 'stations' | 'alternatives' | 'tollFree' | 'cached';

/**
 * Планування з етапами.
 *
 * Читаємо SSE вручну, а не через EventSource: той уміє лише GET, а запит на
 * планування великий і йде тілом POST. Якщо стрім недоступний — тихо падаємо
 * на звичайний /api/plan, щоб маршрут усе одно порахувався.
 */
async function planWithProgress(
  body: PlanRequest,
  onStage: (stage: PlanStage) => void,
): Promise<PlanResponse> {
  let res: Response;
  try {
    res = await fetch('/api/plan/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    return api.plan(body);
  }

  if (!res.ok || !res.body) {
    // Помилку зі звичайного шляху вже вміє пояснювати request().
    return api.plan(body);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result: PlanResponse | null = null;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // Події SSE розділені порожнім рядком; останній шматок може бути неповним.
    const parts = buffer.split('\n\n');
    buffer = parts.pop() ?? '';

    for (const part of parts) {
      const line = part.split('\n').find((l) => l.startsWith('data: '));
      if (!line) continue;
      const payload = JSON.parse(line.slice(6)) as {
        stage?: PlanStage;
        result?: PlanResponse;
        error?: string;
      };
      if (payload.error) throw new ApiError(payload.error);
      if (payload.stage) onStage(payload.stage);
      if (payload.result) result = payload.result;
    }
  }

  if (!result) throw new ApiError('Сервер не повернув маршрут');
  return result;
}

export const api = {
  vehicles: () => request<Vehicle[]>('/vehicles'),
  networks: () => request<NetworkInfo[]>('/networks'),

  geocode: (q: string) => request<Waypoint[]>(`/geocode?q=${encodeURIComponent(q)}`),

  reverse: (lat: number, lon: number) => request<Waypoint>(`/reverse?lat=${lat}&lon=${lon}`),

  stations: (b: Bbox, networkIds: number[], minPowerKw: number, freeOnly = false) =>
    request<{ stations: Station[]; truncated: boolean; limit: number }>(
      `/stations?minLat=${b.minLat}&maxLat=${b.maxLat}&minLon=${b.minLon}&maxLon=${b.maxLon}` +
        `&networks=${networkIds.join(',')}&minPowerKw=${minPowerKw}` +
        (freeOnly ? '&freeOnly=1' : ''),
    ),

  plan: (body: PlanRequest) =>
    request<PlanResponse>('/plan', { method: 'POST', body: JSON.stringify(body) }),

  planWithProgress: planWithProgress,

  me: () => request<AuthUser>('/auth/me'),
  register: (email: string, password: string, inviteCode: string) =>
    request<AuthUser>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, inviteCode }),
    }),
  login: (email: string, password: string) =>
    request<AuthUser>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  logout: () => request<{ ok: true }>('/auth/logout', { method: 'POST' }),

  prefs: () => request<UserPrefs | null>('/prefs'),
  savePrefs: (prefs: UserPrefs) =>
    request<{ ok: true }>('/prefs', { method: 'PUT', body: JSON.stringify(prefs) }),

  savedRoutes: () => request<SavedRouteSummary[]>('/routes'),
  savedRoute: (id: string) =>
    request<{ id: string; name: string; request: PlanRequest; plan: PlanResponse | null }>(
      `/routes/${id}`,
    ),
  saveRoute: (name: string, req: PlanRequest, plan: PlanResponse | null) =>
    request<{ id: string; name: string }>('/routes', {
      method: 'POST',
      body: JSON.stringify({ name, request: req, plan }),
    }),
  renameRoute: (id: string, name: string) =>
    request<{ ok: true; name: string }>(`/routes/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    }),

  deleteRoute: (id: string) => request<{ ok: true }>(`/routes/${id}`, { method: 'DELETE' }),
};
