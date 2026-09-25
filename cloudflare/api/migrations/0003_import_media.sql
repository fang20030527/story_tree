ALTER TABLE article_imports ADD COLUMN preview_media_json TEXT
  CHECK (preview_media_json IS NULL OR (json_valid(preview_media_json) AND json_type(preview_media_json) = 'array'));

ALTER TABLE imported_articles ADD COLUMN media_json TEXT
  CHECK (media_json IS NULL OR (json_valid(media_json) AND json_type(media_json) = 'array'));
