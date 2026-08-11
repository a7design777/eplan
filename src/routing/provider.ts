import type { LatLon, RoutePoint } from '../types';

export interface RouteOptions {
  /** Жорстко виключити платні дороги. */
  excludeTolls?: boolean;
  /** Крок профілю висот, м. 0 — не запитувати висоти. */
  elevationIntervalM?: number;
  /** Скільки додаткових варіантів проїзду просити в рушія. */
  alternates?: number;
}

export interface RouteResult {
  points: RoutePoint[];
  distanceKm: number;
  durationMin: number;
  hasToll: boolean;
  /** Приблизна довжина платних ділянок, км. */
  tollDistanceKm: number;
  /** Дистанції від старту до кожної проміжної точки запиту, км. */
  waypointDistancesKm: number[];
}

/**
 * Абстракція над рушієм маршрутизації. Уся решта коду ходить тільки сюди,
 * щоб заміна Valhalla на інший бекенд була локальною зміною.
 */
export interface RoutingProvider {
  route(waypoints: LatLon[], opts?: RouteOptions): Promise<RouteResult>;
  /** Основний маршрут плюс альтернативні, якщо рушій їх дав. Перший — основний. */
  routes(waypoints: LatLon[], opts?: RouteOptions): Promise<RouteResult[]>;
}
