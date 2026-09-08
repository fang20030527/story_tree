CREATE TYPE "public"."article_import_source_kind" AS ENUM('url', 'paste', 'album', 'local_file', 'computer');--> statement-breakpoint
CREATE TYPE "public"."article_import_status" AS ENUM('awaiting_upload', 'queued', 'processing', 'retryable', 'preview_ready', 'confirmed', 'failed', 'expired', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."computer_upload_status" AS ENUM('awaiting_code', 'claimed', 'uploaded', 'expired');--> statement-breakpoint
ALTER TYPE "public"."job_kind" ADD VALUE 'article_import';--> statement-breakpoint
ALTER TYPE "public"."job_kind" ADD VALUE 'article_translation';--> statement-breakpoint
CREATE TABLE "article_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"source_kind" "article_import_source_kind" NOT NULL,
	"status" "article_import_status" NOT NULL,
	"source_url" text,
	"asset_manifest_json" jsonb,
	"preview_title" text,
	"preview_text" text,
	"word_count" integer,
	"content_hash" text,
	"similarity_fingerprint" bigint,
	"failure_code" text,
	"failure_message_public" text,
	"article_id" uuid,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processing_started_at" timestamp with time zone,
	"preview_ready_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "article_import_attempt_count_check" CHECK ("article_imports"."attempt_count" >= 0),
	CONSTRAINT "article_import_preview_shape_check" CHECK ((
        "article_imports"."status" in ('preview_ready', 'confirmed') and
        "article_imports"."preview_title" is not null and
        "article_imports"."preview_text" is not null and
        "article_imports"."word_count" between 20 and 5000 and
        "article_imports"."content_hash" is not null and
        "article_imports"."similarity_fingerprint" is not null and
        "article_imports"."preview_ready_at" is not null
      ) or (
        "article_imports"."status" not in ('preview_ready', 'confirmed') and
        "article_imports"."preview_title" is null and
        "article_imports"."preview_text" is null and
        "article_imports"."word_count" is null and
        "article_imports"."content_hash" is null and
        "article_imports"."similarity_fingerprint" is null and
        "article_imports"."preview_ready_at" is null
      )),
	CONSTRAINT "article_import_failure_shape_check" CHECK ((
        "article_imports"."status" in ('retryable', 'failed') and
        "article_imports"."failure_code" is not null and
        "article_imports"."failure_message_public" is not null
      ) or (
        "article_imports"."status" not in ('retryable', 'failed') and
        "article_imports"."failure_code" is null and
        "article_imports"."failure_message_public" is null
      )),
	CONSTRAINT "article_import_article_shape_check" CHECK (("article_imports"."status" = 'confirmed' and "article_imports"."article_id" is not null and "article_imports"."confirmed_at" is not null) or ("article_imports"."status" <> 'confirmed' and "article_imports"."article_id" is null and "article_imports"."confirmed_at" is null)),
	CONSTRAINT "article_import_source_url_check" CHECK (("article_imports"."source_kind" = 'url' and "article_imports"."source_url" is not null) or ("article_imports"."source_kind" <> 'url' and "article_imports"."source_url" is null)),
	CONSTRAINT "article_import_manifest_check" CHECK (case
        when "article_imports"."source_kind" = 'album' then
          "article_imports"."asset_manifest_json" is not null and
          jsonb_typeof("article_imports"."asset_manifest_json") = 'array' and
          jsonb_array_length("article_imports"."asset_manifest_json") between 1 and 10
        when "article_imports"."source_kind" = 'local_file' then
          "article_imports"."asset_manifest_json" is not null and
          jsonb_typeof("article_imports"."asset_manifest_json") = 'array' and
          jsonb_array_length("article_imports"."asset_manifest_json") = 1
        else "article_imports"."asset_manifest_json" is null
      end)
);
--> statement-breakpoint
CREATE TABLE "article_paragraphs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"article_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"plain_text" text NOT NULL,
	CONSTRAINT "article_paragraph_position_unique" UNIQUE("article_id","position"),
	CONSTRAINT "article_paragraph_position_check" CHECK ("article_paragraphs"."position" >= 0),
	CONSTRAINT "article_paragraph_text_check" CHECK (length("article_paragraphs"."plain_text") > 0)
);
--> statement-breakpoint
CREATE TABLE "article_translations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"article_id" uuid NOT NULL,
	"scope" "translation_scope" NOT NULL,
	"paragraph_id" uuid,
	"source_hash" text NOT NULL,
	"status" "translation_status" DEFAULT 'queued' NOT NULL,
	"translated_text_zh" text,
	"failure_code" text,
	"failure_message_public" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ready_at" timestamp with time zone,
	CONSTRAINT "article_translation_cache_unique" UNIQUE NULLS NOT DISTINCT("article_id","scope","paragraph_id","source_hash"),
	CONSTRAINT "article_translation_scope_shape_check" CHECK (("article_translations"."scope" = 'full' and "article_translations"."paragraph_id" is null) or ("article_translations"."scope" = 'paragraph' and "article_translations"."paragraph_id" is not null)),
	CONSTRAINT "article_translation_result_shape_check" CHECK ((
        "article_translations"."status" in ('queued', 'generating') and
        "article_translations"."translated_text_zh" is null and
        "article_translations"."failure_code" is null and
        "article_translations"."failure_message_public" is null and
        "article_translations"."ready_at" is null
      ) or (
        "article_translations"."status" = 'ready' and
        "article_translations"."translated_text_zh" is not null and
        "article_translations"."failure_code" is null and
        "article_translations"."failure_message_public" is null and
        "article_translations"."ready_at" is not null
      ) or (
        "article_translations"."status" = 'failed' and
        "article_translations"."translated_text_zh" is null and
        "article_translations"."failure_code" is not null and
        "article_translations"."failure_message_public" is not null and
        "article_translations"."ready_at" is null
      ))
);
--> statement-breakpoint
CREATE TABLE "computer_upload_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"article_import_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"capability_token_hash" text,
	"status" "computer_upload_status" DEFAULT 'awaiting_code' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"claimed_at" timestamp with time zone,
	"uploaded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "computer_upload_sessions_article_import_id_unique" UNIQUE("article_import_id"),
	CONSTRAINT "computer_upload_sessions_code_hash_unique" UNIQUE("code_hash"),
	CONSTRAINT "computer_upload_sessions_capability_token_hash_unique" UNIQUE("capability_token_hash"),
	CONSTRAINT "computer_upload_state_shape_check" CHECK ((
        "computer_upload_sessions"."status" = 'awaiting_code' and
        "computer_upload_sessions"."capability_token_hash" is null and
        "computer_upload_sessions"."claimed_at" is null and
        "computer_upload_sessions"."uploaded_at" is null
      ) or (
        "computer_upload_sessions"."status" = 'claimed' and
        "computer_upload_sessions"."capability_token_hash" is not null and
        "computer_upload_sessions"."claimed_at" is not null and
        "computer_upload_sessions"."uploaded_at" is null
      ) or (
        "computer_upload_sessions"."status" = 'uploaded' and
        "computer_upload_sessions"."capability_token_hash" is null and
        "computer_upload_sessions"."claimed_at" is not null and
        "computer_upload_sessions"."uploaded_at" is not null
      ) or (
        "computer_upload_sessions"."status" = 'expired' and
        "computer_upload_sessions"."capability_token_hash" is null and
        "computer_upload_sessions"."uploaded_at" is null
      ))
);
--> statement-breakpoint
CREATE TABLE "import_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"article_import_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"media_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"sha256" text NOT NULL,
	"content" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_asset_position_unique" UNIQUE("article_import_id","position"),
	CONSTRAINT "import_asset_digest_unique" UNIQUE("article_import_id","sha256"),
	CONSTRAINT "import_asset_position_check" CHECK ("import_assets"."position" between 0 and 9),
	CONSTRAINT "import_asset_size_check" CHECK ("import_assets"."byte_size" between 1 and 10485760),
	CONSTRAINT "import_asset_digest_check" CHECK (length("import_assets"."sha256") = 64)
);
--> statement-breakpoint
CREATE TABLE "imported_articles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"source_kind" "article_import_source_kind" NOT NULL,
	"source_url" text,
	"title" text NOT NULL,
	"word_count" integer NOT NULL,
	"content_hash" text NOT NULL,
	"similarity_fingerprint" bigint NOT NULL,
	"previous_version_id" uuid,
	"imported_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "imported_article_word_count_check" CHECK ("imported_articles"."word_count" between 20 and 5000),
	CONSTRAINT "imported_article_source_url_check" CHECK (("imported_articles"."source_kind" = 'url' and "imported_articles"."source_url" is not null) or ("imported_articles"."source_kind" <> 'url' and "imported_articles"."source_url" is null))
);
--> statement-breakpoint
ALTER TABLE "article_imports" ADD CONSTRAINT "article_imports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_imports" ADD CONSTRAINT "article_imports_article_id_imported_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."imported_articles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_paragraphs" ADD CONSTRAINT "article_paragraphs_article_id_imported_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."imported_articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_translations" ADD CONSTRAINT "article_translations_article_id_imported_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."imported_articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_translations" ADD CONSTRAINT "article_translations_paragraph_id_article_paragraphs_id_fk" FOREIGN KEY ("paragraph_id") REFERENCES "public"."article_paragraphs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "computer_upload_sessions" ADD CONSTRAINT "computer_upload_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "computer_upload_sessions" ADD CONSTRAINT "computer_upload_sessions_article_import_id_article_imports_id_fk" FOREIGN KEY ("article_import_id") REFERENCES "public"."article_imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_assets" ADD CONSTRAINT "import_assets_article_import_id_article_imports_id_fk" FOREIGN KEY ("article_import_id") REFERENCES "public"."article_imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imported_articles" ADD CONSTRAINT "imported_articles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imported_articles" ADD CONSTRAINT "imported_articles_previous_version_id_imported_articles_id_fk" FOREIGN KEY ("previous_version_id") REFERENCES "public"."imported_articles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "article_import_user_created_idx" ON "article_imports" USING btree ("user_id","created_at","id");--> statement-breakpoint
CREATE INDEX "article_import_status_expiry_idx" ON "article_imports" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "article_import_user_hash_idx" ON "article_imports" USING btree ("user_id","content_hash");--> statement-breakpoint
CREATE INDEX "computer_upload_expiry_idx" ON "computer_upload_sessions" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "import_asset_created_idx" ON "import_assets" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "imported_article_user_hash_unique" ON "imported_articles" USING btree ("user_id","content_hash");--> statement-breakpoint
CREATE INDEX "imported_article_user_created_idx" ON "imported_articles" USING btree ("user_id","created_at","id");