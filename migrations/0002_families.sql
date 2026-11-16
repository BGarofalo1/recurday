CREATE TABLE IF NOT EXISTS families (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL UNIQUE,
  passcode_salt TEXT NOT NULL,
  passcode_hash TEXT NOT NULL,
  passcode_iters INTEGER NOT NULL,
  session_version INTEGER NOT NULL DEFAULT 1,
  calendar_token_hash TEXT NOT NULL UNIQUE,
  calendar_token_enc TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS login_attempts (
  key TEXT PRIMARY KEY,
  fail_count INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_families_name_key ON families (name_key);

ALTER TABLE traditions ADD COLUMN family_id TEXT;
ALTER TABLE traditions ADD COLUMN recur_type TEXT NOT NULL DEFAULT '';
ALTER TABLE traditions ADD COLUMN recur_month INTEGER;
ALTER TABLE traditions ADD COLUMN recur_day INTEGER;
ALTER TABLE traditions ADD COLUMN recur_nth INTEGER;
ALTER TABLE traditions ADD COLUMN recur_weekday INTEGER;

CREATE INDEX IF NOT EXISTS idx_traditions_family ON traditions (family_id);
