-- Деталі станції для картки вибору: порти, спосіб оплати, робочий стан.
--
-- `connections` — JSON зі списком портів: тип, потужність, кількість. Раніше
-- ми зводили все до CSV типів і максимальної потужності, і з картки не було
-- видно, скільки саме портів і яких.
--
-- Прапорці оплати беруться з UsageType OCM: там окремо позначено оплату на
-- місці, потребу в членстві та в ключі-картці (RFID). Одного `access_type`
-- для відповіді «карта, застосунок чи лише RFID» замало.
--
-- `status_operational`: 0 — станція не працює (демонтована, планована, зламана).
-- Живої зайнятості («вільна зараз») OCM не дає, тому такого поля тут немає
-- і в інтерфейсі ми його не вигадуємо.
ALTER TABLE stations ADD COLUMN connections TEXT;
ALTER TABLE stations ADD COLUMN status_operational INTEGER;
ALTER TABLE stations ADD COLUMN pay_at_location INTEGER;
ALTER TABLE stations ADD COLUMN membership_required INTEGER;
ALTER TABLE stations ADD COLUMN access_key_required INTEGER;
