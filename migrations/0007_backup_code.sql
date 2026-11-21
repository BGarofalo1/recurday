-- A one-time-shown backup code lets a family set a new passcode if they
-- forget the old one, so a lost passcode never means a lost family history.
-- Only a salted SHA-256 hash is stored. The code itself is never kept.
-- Additive only: existing families keep working and can make a code later.
ALTER TABLE families ADD COLUMN recovery_salt TEXT;
ALTER TABLE families ADD COLUMN recovery_hash TEXT;
ALTER TABLE families ADD COLUMN recovery_created_at TEXT;
