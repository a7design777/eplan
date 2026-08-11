import type { AccessType, Station } from '../../src/types';

const ACCESS_LABELS: Record<AccessType, string> = {
  public: 'Публічна',
  pay_at_location: 'Оплата на місці — картка або термінал',
  membership: 'Потрібна картка або застосунок мережі',
  notice_required: 'Потрібно попередити власника',
  customers_only: 'Для клієнтів закладу',
  restricted: 'Обмежений доступ',
};

/**
 * Як платити на станції.
 *
 * OCM не має структурованого поля про способи оплати — єдине надійне джерело
 * це UsageTypeID. Тому кажемо те, що справді відомо, і не вигадуємо решту.
 */
export function paymentHint(station: Station): string {
  if (station.isFree) return 'Безкоштовно';
  if (station.accessType) {
    const label = ACCESS_LABELS[station.accessType];
    // Для публічних станцій сам факт «публічна» нічого не каже про оплату.
    if (station.accessType === 'public') {
      return station.networkName
        ? `Через застосунок або картку — ${station.networkName}`
        : 'Спосіб оплати не вказано';
    }
    return label;
  }
  return 'Спосіб оплати не вказано';
}

/** Ціна дослівно з OCM або null, якщо її там немає. */
export function priceLabel(station: Station): string | null {
  const cost = station.usageCost?.trim();
  if (!cost) return null;
  // Дуже довгі описи тарифів у картку не влазять.
  return cost.length > 80 ? `${cost.slice(0, 79)}…` : cost;
}
