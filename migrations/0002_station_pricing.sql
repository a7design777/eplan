-- Ціна і спосіб оплати на станції.
--
-- OCM віддає ціну вільним текстом («0,59 €/kWh», «Free», «see app») — структурувати
-- її надійно неможливо, тому зберігаємо як є і показуємо користувачу дослівно.
-- А ось спосіб доступу (UsageTypeID) — то вже перелік, з нього й робимо «як платити».
ALTER TABLE stations ADD COLUMN usage_cost TEXT;
ALTER TABLE stations ADD COLUMN access_type TEXT;

CREATE INDEX idx_stations_access ON stations(access_type);
