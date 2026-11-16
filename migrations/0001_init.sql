CREATE TABLE IF NOT EXISTS traditions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  timing_note TEXT NOT NULL DEFAULT '',
  practice_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  household_token_hash TEXT NOT NULL UNIQUE,
  admin_token_hash TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS days (
  id TEXT PRIMARY KEY,
  tradition_id TEXT NOT NULL,
  year INTEGER NOT NULL,
  observed_on TEXT,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  UNIQUE (tradition_id, year),
  FOREIGN KEY (tradition_id) REFERENCES traditions(id)
);

CREATE TABLE IF NOT EXISTS media (
  id TEXT PRIMARY KEY,
  day_id TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  mime TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (day_id) REFERENCES days(id)
);

CREATE TABLE IF NOT EXISTS shares (
  id TEXT PRIMARY KEY,
  tradition_id TEXT NOT NULL,
  label TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  years_policy TEXT NOT NULL DEFAULT 'all',
  created_at TEXT NOT NULL,
  accepted_at TEXT,
  revoked_at TEXT,
  FOREIGN KEY (tradition_id) REFERENCES traditions(id)
);

CREATE TABLE IF NOT EXISTS copies (
  new_tradition_id TEXT NOT NULL,
  source_tradition_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_days_tradition_year ON days (tradition_id, year);
CREATE INDEX IF NOT EXISTS idx_media_day ON media (day_id);
CREATE INDEX IF NOT EXISTS idx_shares_tradition ON shares (tradition_id);
