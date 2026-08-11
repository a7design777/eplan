-- Іспанія: коридор Мадрид → Барселона (A-2). geohash5 обчислено кодом.
INSERT OR REPLACE INTO networks (id, name) VALUES (3396,'Iberdrola'),(3373,'Zunder'),(3260,'Endesa X');
INSERT OR REPLACE INTO stations
  (id, name, lat, lon, geohash5, max_power_kw, connectors, network_id, is_free, port_count, country_code, address, updated_at)
VALUES
  (910001, 'Tesla Supercharger Madrid Norte', 40.5230, -3.6270, 'ezjqt', 150, 'ccs,type2,tesla', 3536, 0, 10, 'ES', 'A-1 Madrid', 1754870400),
  (910002, 'IONITY Alcalá de Henares', 40.4820, -3.3650, 'ezjw7', 350, 'ccs', 23, 0, 6, 'ES', 'A-2 Alcalá', 1754870400),
  (910003, 'Iberdrola Guadalajara', 40.6300, -3.1650, 'ezjxp', 150, 'ccs,type2', 3396, 0, 4, 'ES', 'A-2 Guadalajara', 1754870400),
  (910004, 'Tesla Supercharger Medinaceli', 41.1730, -2.4300, 'ezq60', 150, 'ccs,type2,tesla', 3536, 0, 8, 'ES', 'A-2 Medinaceli', 1754870400),
  (910005, 'Zunder Calatayud', 41.3540, -1.6430, 'ezqg6', 180, 'ccs', 3373, 0, 4, 'ES', 'A-2 Calatayud', 1754870400),
  (910006, 'IONITY Zaragoza', 41.6500, -0.9400, 'ezrkf', 350, 'ccs', 23, 0, 6, 'ES', 'A-2 Zaragoza', 1754870400),
  (910007, 'Tesla Supercharger Zaragoza', 41.6620, -0.8800, 'ezrm5', 150, 'ccs,type2,tesla', 3536, 0, 12, 'ES', 'Zaragoza', 1754870400),
  (910008, 'Endesa X Bujaraloz', 41.4970, -0.1500, 'ezruh', 100, 'ccs,type2', 3260, 0, 2, 'ES', 'A-2 Bujaraloz', 1754870400),
  (910009, 'Zunder Lleida', 41.6150, 0.6200, 'sp2kw', 180, 'ccs', 3373, 0, 6, 'ES', 'A-2 Lleida', 1754870400),
  (910010, 'IONITY Cervera', 41.6700, 1.2700, 'sp2vh', 350, 'ccs', 23, 0, 6, 'ES', 'A-2 Cervera', 1754870400),
  (910011, 'Tesla Supercharger Martorell', 41.4740, 1.9100, 'sp37g', 150, 'ccs,type2,tesla', 3536, 0, 8, 'ES', 'AP-7 Martorell', 1754870400),
  (910012, 'Endesa X Barcelona Nord', 41.4360, 2.1900, 'sp3e9', 150, 'ccs,type2', 3260, 0, 4, 'ES', 'Barcelona', 1754870400),
  (910013, 'Punto libre Igualada', 41.5800, 1.6170, 'sp3hs', 50, 'ccs,type2', NULL, 1, 2, 'ES', 'A-2 Igualada', 1754870400);
