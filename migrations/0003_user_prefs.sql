-- Налаштування користувача: обране авто, рівні заряду, фільтри.
--
-- Одним JSON, а не колонками: набір полів ще змінюватиметься разом з UI, і
-- ганяти міграцію на кожне нове поле фільтра невиправдано. Валідація —
-- на вході в API, тими самими парсерами, що й для планування.
CREATE TABLE user_prefs (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  prefs_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
