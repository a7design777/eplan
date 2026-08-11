-- Користувачі та сесії
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

-- Збережені маршрути (запит користувача + останній розрахований план)
CREATE TABLE saved_routes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  request_json TEXT NOT NULL,
  plan_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_saved_routes_user ON saved_routes(user_id, updated_at DESC);

-- Мережі зарядних станцій (операторы з OpenChargeMap)
CREATE TABLE networks (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL
);

-- Дзеркало станцій OpenChargeMap.
-- geohash7 — префікс geohash довжиною 7 (~150x150 м). Вибірка в коридорі маршруту
-- йде через IN по набору префіксів довжини 5 (~5x5 км), тому індекс саме на geohash5.
CREATE TABLE stations (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  geohash5 TEXT NOT NULL,
  max_power_kw REAL NOT NULL,
  -- Конектори як CSV з types.ts: ccs,chademo,type2,tesla
  connectors TEXT NOT NULL,
  network_id INTEGER REFERENCES networks(id),
  is_free INTEGER NOT NULL DEFAULT 0,
  port_count INTEGER NOT NULL DEFAULT 1,
  country_code TEXT,
  address TEXT,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_stations_geohash5 ON stations(geohash5);
CREATE INDEX idx_stations_power ON stations(max_power_kw);

-- Стан інкрементального імпорту з OCM, щоб cron продовжував з місця зупинки
CREATE TABLE import_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
