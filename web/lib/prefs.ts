import type { PlanFilters, Vehicle } from '../../src/types';

export interface UserPrefs {
  vehicle: Vehicle | null;
  startSocPct: number;
  targetSocPct: number;
  filters: PlanFilters;
}

const STORAGE_KEY = 'eplan.prefs';

/**
 * Локальна копія налаштувань.
 *
 * Тримаємо її навіть для залогінених: вона підхоплюється миттєво при
 * завантаженні сторінки, поки запит за серверними налаштуваннями ще в дорозі,
 * тож вибране авто не встигає блимнути дефолтним.
 */
export function loadLocalPrefs(): Partial<UserPrefs> | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Partial<UserPrefs>) : null;
  } catch {
    // Пошкоджений запис або заблокований localStorage — просто йдемо з дефолтами.
    return null;
  }
}

const MAP_NETWORKS_KEY = 'eplan.mapNetworks';

/**
 * Мережі для шару станцій на мапі. Окремо від налаштувань акаунту: це вибір
 * «що я зараз розглядаю», а не профіль авто, і між пристроями його синхронізувати
 * ні до чого.
 */
export function loadMapNetworks(): number[] {
  try {
    const raw = localStorage.getItem(MAP_NETWORKS_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return Array.isArray(parsed) ? parsed.filter((v): v is number => typeof v === 'number') : [];
  } catch {
    return [];
  }
}

export function saveMapNetworks(ids: number[]): void {
  try {
    localStorage.setItem(MAP_NETWORKS_KEY, JSON.stringify(ids));
  } catch {
    // Приватний режим — не критично.
  }
}

export function saveLocalPrefs(prefs: UserPrefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Приватний режим — не привід ламати застосунок.
  }
}
