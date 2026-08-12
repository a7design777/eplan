import type { Station } from '../types';

/**
 * Ціна за кВт·год, витягнута з вільного тексту OCM.
 *
 * `UsageCost` заповнюють люди в довільній формі: «0,59 €/kWh», «£0.79/kWh»,
 * «0.45 EUR per kWh; parking extra». Тому розбір свідомо консервативний:
 * беремо число лише коли поруч однозначно стоїть одиниця «за кВт·год».
 * Усе, у чому не впевнені, повертаємо як null — краще не показати ціну,
 * ніж показати вигадану.
 */
export interface UnitPrice {
  perKwh: number;
  currency: string;
}

const CURRENCY_BY_SYMBOL: Record<string, string> = {
  '€': 'EUR',
  '£': 'GBP',
  $: 'USD',
  '₴': 'UAH',
  zł: 'PLN',
  kr: 'SEK',
  Kč: 'CZK',
};

const CURRENCY_WORDS = ['eur', 'gbp', 'usd', 'uah', 'pln', 'sek', 'nok', 'dkk', 'czk', 'huf', 'chf'];

/** Тарифи за хвилину, за сеанс чи за паркування нам не підходять. */
const PER_KWH = /(kwh|кВт[·.\s]*год|kw\/h)/i;

export function parseUnitPrice(raw: string | null | undefined): UnitPrice | null {
  if (!raw) return null;
  const text = raw.trim();
  if (text.length === 0 || text.length > 200) return null;
  if (!PER_KWH.test(text)) return null;

  // Число з комою або крапкою, до двох знаків до роздільника — ціни за кВт·год
  // не бувають тризначними, а от «0.30-0.79» трапляється: беремо перше.
  const numberMatch = text.match(/(\d{1,2}[.,]\d{1,3})|(\d{1,2})(?=\s*(€|£|\$|₴|eur|gbp))/i);
  if (!numberMatch) return null;

  const value = Number(numberMatch[0].replace(',', '.'));
  if (!Number.isFinite(value) || value <= 0 || value > 5) return null;

  const lower = text.toLowerCase();
  let currency = '';
  for (const [symbol, code] of Object.entries(CURRENCY_BY_SYMBOL)) {
    if (text.includes(symbol)) {
      currency = code;
      break;
    }
  }
  if (!currency) {
    currency = CURRENCY_WORDS.find((c) => lower.includes(c))?.toUpperCase() ?? '';
  }
  if (!currency) return null;

  return { perKwh: value, currency };
}

export interface StopCost {
  amount: number;
  currency: string;
}

/** Вартість однієї зупинки. null — ціна станції невідома або не за кВт·год. */
export function stopCost(station: Station, energyKwh: number): StopCost | null {
  if (station.isFree) return { amount: 0, currency: '' };
  const price = parseUnitPrice(station.usageCost);
  if (!price) return null;
  return { amount: price.perKwh * energyKwh, currency: price.currency };
}

export interface TripCost {
  /** Сума по зупинках, де ціна відома. */
  total: number;
  currency: string;
  /** Скільки зупинок лишились без ціни — щоб чесно сказати «щонайменше». */
  unknownStops: number;
}

/**
 * Загальна вартість. Валюти не конвертуємо: курсів у нас немає, а вигадувати
 * їх на око гірше, ніж чесно показати підсумок лише в найчастішій валюті.
 */
export function tripCost(costs: (StopCost | null)[]): TripCost | null {
  const byCurrency = new Map<string, number>();
  let unknownStops = 0;

  for (const c of costs) {
    if (!c) {
      unknownStops++;
      continue;
    }
    // Безкоштовні зупинки додають нуль і не тягнуть за собою валюту.
    if (c.currency === '') continue;
    byCurrency.set(c.currency, (byCurrency.get(c.currency) ?? 0) + c.amount);
  }

  if (byCurrency.size === 0) return unknownStops > 0 ? null : { total: 0, currency: '', unknownStops };

  const [currency, total] = [...byCurrency.entries()].sort((a, b) => b[1] - a[1])[0]!;
  // Інші валюти в підсумок не звалюємо — вони підуть у «невідомі».
  const otherCurrencyStops = costs.filter(
    (c) => c && c.currency !== '' && c.currency !== currency,
  ).length;

  return {
    total: Math.round(total * 100) / 100,
    currency,
    unknownStops: unknownStops + otherCurrencyStops,
  };
}
