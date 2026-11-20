-- Ideas shared through the "Share an idea" form on /ideas.
-- They are never shown publicly from here. A person reads each one and, if it
-- fits, copies it by hand into src/ideas.js (see README "Shared ideas").
-- No internet address, family, or login is stored with a submission.
CREATE TABLE IF NOT EXISTS idea_submissions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  practice TEXT NOT NULL,
  timing TEXT NOT NULL DEFAULT '',
  season TEXT NOT NULL DEFAULT '',
  age TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending', -- pending | added | declined
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_idea_submissions_status ON idea_submissions (status, created_at);
