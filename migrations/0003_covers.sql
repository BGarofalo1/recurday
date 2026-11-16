-- A tradition may have one cover picture. It can be a photo uploaded just
-- for the cover, or a photo already kept with one of the tradition's years.
ALTER TABLE traditions ADD COLUMN cover_media_id TEXT;
ALTER TABLE traditions ADD COLUMN cover_r2_key TEXT;
ALTER TABLE traditions ADD COLUMN cover_mime TEXT;
ALTER TABLE traditions ADD COLUMN cover_byte_size INTEGER;
ALTER TABLE traditions ADD COLUMN cover_thumb_r2_key TEXT;
ALTER TABLE traditions ADD COLUMN cover_thumb_mime TEXT;
ALTER TABLE traditions ADD COLUMN cover_thumb_byte_size INTEGER;
