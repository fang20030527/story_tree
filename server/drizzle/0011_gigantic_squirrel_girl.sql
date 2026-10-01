CREATE TABLE "speaking_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"status" text DEFAULT 'awaiting_upload' NOT NULL,
	"content_type" text NOT NULL,
	"byte_size" bigint NOT NULL,
	"storage_key" text,
	"sha256" text,
	"duration" double precision DEFAULT 0 NOT NULL,
	"media_type" text,
	"attached_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "speaking_assets_size_check" CHECK ("speaking_assets"."byte_size" > 0 and "speaking_assets"."byte_size" <= 3221225472),
	CONSTRAINT "speaking_assets_duration_check" CHECK ("speaking_assets"."duration" >= 0),
	CONSTRAINT "speaking_assets_status_check" CHECK ("speaking_assets"."status" in ('awaiting_upload', 'ready')),
	CONSTRAINT "speaking_assets_purpose_check" CHECK ("speaking_assets"."purpose" in ('material', 'recording'))
);
--> statement-breakpoint
CREATE TABLE "speaking_materials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"source_kind" text NOT NULL,
	"title" text NOT NULL,
	"asset_id" uuid,
	"video_id" text,
	"media_type" text NOT NULL,
	"duration" double precision NOT NULL,
	"cues" jsonb NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "speaking_materials_source_check" CHECK (("speaking_materials"."source_kind" = 'file' and "speaking_materials"."asset_id" is not null and "speaking_materials"."video_id" is null) or ("speaking_materials"."source_kind" = 'youtube' and "speaking_materials"."asset_id" is null and "speaking_materials"."video_id" is not null)),
	CONSTRAINT "speaking_materials_revision_check" CHECK ("speaking_materials"."revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "speaking_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"material_id" text NOT NULL,
	"title" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"elapsed_ms" integer NOT NULL,
	"cue_count" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "speaking_sessions_elapsed_check" CHECK ("speaking_sessions"."elapsed_ms" >= 0 and "speaking_sessions"."elapsed_ms" <= 86400000),
	CONSTRAINT "speaking_sessions_cue_count_check" CHECK ("speaking_sessions"."cue_count" >= 0 and "speaking_sessions"."cue_count" <= 10000)
);
--> statement-breakpoint
CREATE TABLE "speaking_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"material_id" text NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"saved_cue_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"position" double precision DEFAULT 0 NOT NULL,
	"recording" jsonb,
	"custom_cues" jsonb,
	"subtitle_revision" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "speaking_states_revision_check" CHECK ("speaking_states"."revision" >= 0 and "speaking_states"."subtitle_revision" > 0),
	CONSTRAINT "speaking_states_position_check" CHECK ("speaking_states"."position" >= 0)
);
--> statement-breakpoint
ALTER TABLE "speaking_assets" ADD CONSTRAINT "speaking_assets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "speaking_materials" ADD CONSTRAINT "speaking_materials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "speaking_materials" ADD CONSTRAINT "speaking_materials_asset_id_speaking_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."speaking_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "speaking_sessions" ADD CONSTRAINT "speaking_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "speaking_states" ADD CONSTRAINT "speaking_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "speaking_assets_user_idx" ON "speaking_assets" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "speaking_assets_cleanup_idx" ON "speaking_assets" USING btree ("expires_at","attached_at");--> statement-breakpoint
CREATE INDEX "speaking_materials_user_idx" ON "speaking_materials" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "speaking_materials_asset_unique" ON "speaking_materials" USING btree ("asset_id");--> statement-breakpoint
CREATE UNIQUE INDEX "speaking_sessions_user_client_unique" ON "speaking_sessions" USING btree ("user_id","client_id");--> statement-breakpoint
CREATE INDEX "speaking_sessions_user_date_idx" ON "speaking_sessions" USING btree ("user_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "speaking_states_user_material_unique" ON "speaking_states" USING btree ("user_id","material_id");