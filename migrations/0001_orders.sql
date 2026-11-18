CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY NOT NULL,
  method TEXT NOT NULL,
  currency TEXT NOT NULL,
  total INTEGER NOT NULL CHECK (total > 0),
  items TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','complete')),
  provider_id TEXT UNIQUE,
  approval_url TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
