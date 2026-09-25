ALTER TABLE "article_imports" ADD COLUMN "preview_media_json" jsonb;--> statement-breakpoint
ALTER TABLE "imported_articles" ADD COLUMN "media_json" jsonb;