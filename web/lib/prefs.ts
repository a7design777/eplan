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

export function saveLocalPrefs(prefs: UserPrefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Приватний режим — не привід ламати застосунок.
  }
}
