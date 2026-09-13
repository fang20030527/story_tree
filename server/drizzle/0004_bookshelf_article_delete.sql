ALTER TABLE "article_imports" DROP CONSTRAINT "article_imports_article_id_imported_articles_id_fk";
--> statement-breakpoint
ALTER TABLE "imported_articles" DROP CONSTRAINT "imported_articles_previous_version_id_imported_articles_id_fk";
--> statement-breakpoint
ALTER TABLE "article_imports" ADD CONSTRAINT "article_imports_article_id_imported_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."imported_articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imported_articles" ADD CONSTRAINT "imported_articles_previous_version_id_imported_articles_id_fk" FOREIGN KEY ("previous_version_id") REFERENCES "public"."imported_articles"("id") ON DELETE set null ON UPDATE no action;