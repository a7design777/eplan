-- Невеликий набір станцій уздовж A9 Берлін — Мюнхен для локальної перевірки
-- без ключа OpenChargeMap. У продакшн не застосовувати: там дані з OCM.
-- geohash5 обчислено через src/lib/geo.ts — вручну не правити.
INSERT OR REPLACE INTO networks (id, name) VALUES
  (23, 'IONITY'), (89, 'EnBW'), (3536, 'Tesla Supercharger'), (45, 'Aral pulse');

INSERT OR REPLACE INTO stations
  (id, name, lat, lon, geohash5, max_power_kw, connectors, network_id, is_free, port_count, country_code, address, updated_at)
VALUES
  (900001, 'IONITY Michendorf',          52.2861, 13.0289, 'u3332', 350, 'ccs',        23,   0,  6, 'DE', 'A10 Michendorf',  1754870400),
  (900002, 'EnBW Brück',                 52.2000, 12.7500, 'u330f', 300, 'ccs,type2',  89,   0,  4, 'DE', 'A9 Brück',        1754870400),
  (900003, 'IONITY Köckern',             51.6167, 12.1500, 'u30ts', 350, 'ccs',        23,   0,  6, 'DE', 'A9 Köckern',      1754870400),
  (900004, 'Tesla Supercharger Leipzig', 51.3833, 12.3667, 'u30u3', 250, 'ccs,tesla',  3536, 0,  8, 'DE', 'A14 Leipzig',     1754870400),
  (900005, 'EnBW Rippachtal',            51.2333, 12.1667, 'u30ek', 300, 'ccs,type2',  89,   0,  4, 'DE', 'A9 Rippachtal',   1754870400),
  (900006, 'IONITY Hermsdorfer Kreuz',   50.8833, 11.8333, 'u303m', 350, 'ccs',        23,   0,  6, 'DE', 'A9 Hermsdorf',    1754870400),
  (900007, 'Aral pulse Schkeuditz',      51.4000, 12.2167, 'u30sm', 300, 'ccs',        45,   0,  4, 'DE', 'A9 Schkeuditz',   1754870400),
  (900008, 'EnBW Bayreuth',              49.9167, 11.5833, 'u2b5z', 300, 'ccs,type2',  89,   0,  4, 'DE', 'A9 Bayreuth',     1754870400),
  (900009, 'IONITY Pegnitz',             49.7167, 11.2500, 'u2b4b', 350, 'ccs',        23,   0,  6, 'DE', 'A9 Pegnitz',      1754870400),
  (900010, 'EnBW Nürnberg Feucht',       49.3833, 11.2167, 'u0zbz', 300, 'ccs,type2',  89,   0,  6, 'DE', 'A9 Feucht',       1754870400),
  (900011, 'IONITY Greding',             49.0500, 11.3500, 'u28p4', 350, 'ccs',        23,   0,  6, 'DE', 'A9 Greding',      1754870400),
  (900012, 'Aral pulse Ingolstadt',      48.7667, 11.4333, 'u28jk', 300, 'ccs',        45,   0,  4, 'DE', 'A9 Ingolstadt',   1754870400),
  (900013, 'EnBW Holledau',              48.5333, 11.6667, 'u28k1', 300, 'ccs,type2',  89,   0,  8, 'DE', 'A9 Holledau',     1754870400),
  (900014, 'Freier Lader Allershausen',  48.4333, 11.6000, 'u285x', 150, 'ccs,type2',  NULL, 1,  2, 'DE', 'A9 Allershausen', 1754870400),
  (900015, 'Tesla Supercharger München', 48.1833, 11.6167, 'u2860', 250, 'ccs,tesla',  3536, 0, 12, 'DE', 'München Nord',    1754870400);
