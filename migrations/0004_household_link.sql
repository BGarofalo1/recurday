-- Keep a recoverable family link so "Text this to family" works
-- without making a new link every time.
ALTER TABLE traditions ADD COLUMN household_token_enc TEXT;
