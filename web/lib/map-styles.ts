/**
 * Стилі мапи. Усі з OpenFreeMap — без ключів і лімітів, як вимагає стек проєкту.
 * Супутника серед них немає: безкоштовних супутникових тайлів без ключа й
 * обмежень на комерційне використання не існує.
 */
export interface MapStyle {
  id: string;
  label: string;
  url: string;
  /** Темний фон — під нього підбирається колір лінії маршруту. */
  dark: boolean;
}

export const MAP_STYLES: MapStyle[] = [
  {
    id: 'liberty',
    label: 'Звичайна',
    url: 'https://tiles.openfreemap.org/styles/liberty',
    dark: false,
  },
  {
    id: 'bright',
    label: 'Яскрава',
    url: 'https://tiles.openfreemap.org/styles/bright',
    dark: false,
  },
  {
    id: 'positron',
    label: 'Спокійна',
    url: 'https://tiles.openfreemap.org/styles/positron',
    dark: false,
  },
  {
    id: 'dark',
    label: 'Темна',
    url: 'https://tiles.openfreemap.org/styles/dark',
    dark: true,
  },
  {
    id: 'fiord',
    label: 'Контрастна',
    url: 'https://tiles.openfreemap.org/styles/fiord',
    dark: true,
  },
];

const STORAGE_KEY = 'eplan.mapStyle';

export function loadMapStyle(): MapStyle {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return MAP_STYLES.find((s) => s.id === saved) ?? MAP_STYLES[0]!;
  } catch {
    // Приватний режим блокує localStorage — не привід падати.
    return MAP_STYLES[0]!;
  }
}

export function saveMapStyle(id: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Не збереглось — переживемо.
  }
}
