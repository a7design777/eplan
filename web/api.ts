import type { PlanRequest, PlanResponse, Station, Vehicle, Waypoint } from '../src/types';

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
    throw new ApiError(`Некоректна відповідь сервера (${res.status})`);
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

export const api = {
  vehicles: () => request<Vehicle[]>('/vehicles'),
  networks: () => request<NetworkInfo[]>('/networks'),

  geocode: (q: string) => request<Waypoint[]>(`/geocode?q=${encodeURIComponent(q)}`),

  reverse: (lat: number, lon: number) => request<Waypoint>(`/reverse?lat=${lat}&lon=${lon}`),

  stations: (b: Bbox, networkIds: number[], minPowerKw: number) =>
    request<Station[]>(
      `/stations?minLat=${b.minLat}&maxLat=${b.maxLat}&minLon=${b.minLon}&maxLon=${b.maxLon}` +
        `&networks=${networkIds.join(',')}&minPowerKw=${minPowerKw}`,
    ),

  plan: (body: PlanRequest) =>
    request<PlanResponse>('/plan', { method: 'POST', body: JSON.stringify(body) }),

  me: () => request<AuthUser>('/auth/me'),
  register: (email: string, password: string) =>
    request<AuthUser>('/auth/register', { method: 'POST', body: JSON.stringify({ email, password }) }),
  login: (email: string, password: string) =>
    request<AuthUser>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  logout: () => request<{ ok: true }>('/auth/logout', { method: 'POST' }),

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
  deleteRoute: (id: string) => request<{ ok: true }>(`/routes/${id}`, { method: 'DELETE' }),
};
