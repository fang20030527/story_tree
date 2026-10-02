CREATE TABLE "speaking_pronunciation_assessments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"material_id" text,
	"cue_id" text NOT NULL,
	"reference_text" text NOT NULL,
	"subtitle_revision" integer,
	"locale" text NOT NULL,
	"fingerprint" text NOT NULL,
	"status" text DEFAULT 'processing' NOT NULL,
	"result" jsonb,
	"error" jsonb,
	"deadline_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "speaking_pronunciation_locale_check" CHECK ("speaking_pronunciation_assessments"."locale" in ('en-us', 'en-gb')),
	CONSTRAINT "speaking_pronunciation_status_check" CHECK (("speaking_pronunciation_assessments"."status" = 'processing' and "speaking_pronunciation_assessments"."result" is null and "speaking_pronunciation_assessments"."error" is null) or ("speaking_pronunciation_assessments"."status" = 'ready' and "speaking_pronunciation_assessments"."result" is not null and "speaking_pronunciation_assessments"."error" is null) or ("speaking_pronunciation_assessments"."status" = 'failed' and "speaking_pronunciation_assessments"."result" is null and "speaking_pronunciation_assessments"."error" is not null))
);
--> statement-breakpoint
ALTER TABLE "speaking_pronunciation_assessments" ADD CONSTRAINT "speaking_pronunciation_assessments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "speaking_pronunciation_user_date_idx" ON "speaking_pronunciation_assessments" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "speaking_pronunciation_active_unique" ON "speaking_pronunciation_assessments" USING btree ("user_id","fingerprint") WHERE "speaking_pronunciation_assessments"."status" in ('processing', 'ready');