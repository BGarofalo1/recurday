-- Bump a per-tradition counter whenever anything shown on its link page changes.
-- The Worker uses it in the edge-cache key for shared-link pages, so an edit
-- makes every Cloudflare location fetch a fresh copy (no stale pages, no purge API).
ALTER TABLE traditions ADD COLUMN page_version INTEGER NOT NULL DEFAULT 0;

CREATE TRIGGER IF NOT EXISTS trg_traditions_page_version
AFTER UPDATE ON traditions
WHEN NEW.page_version = OLD.page_version
BEGIN
  UPDATE traditions SET page_version = OLD.page_version + 1 WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_days_insert_page_version
AFTER INSERT ON days
BEGIN
  UPDATE traditions SET page_version = page_version + 1 WHERE id = NEW.tradition_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_days_update_page_version
AFTER UPDATE ON days
BEGIN
  UPDATE traditions SET page_version = page_version + 1 WHERE id = NEW.tradition_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_days_delete_page_version
AFTER DELETE ON days
BEGIN
  UPDATE traditions SET page_version = page_version + 1 WHERE id = OLD.tradition_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_media_insert_page_version
AFTER INSERT ON media
BEGIN
  UPDATE traditions SET page_version = page_version + 1
  WHERE id = (SELECT tradition_id FROM days WHERE id = NEW.day_id);
END;

CREATE TRIGGER IF NOT EXISTS trg_media_delete_page_version
AFTER DELETE ON media
BEGIN
  UPDATE traditions SET page_version = page_version + 1
  WHERE id = (SELECT tradition_id FROM days WHERE id = OLD.day_id);
END;
