CREATE TYPE "public"."answer_kind" AS ENUM('option', 'dont_know');--> statement-breakpoint
CREATE TYPE "public"."assistance_kind" AS ENUM('word_hint', 'paragraph_translation', 'full_translation');--> statement-breakpoint
CREATE TYPE "public"."exam_path" AS ENUM('ielts');--> statement-breakpoint
CREATE TYPE "public"."job_kind" AS ENUM('practice_generation', 'translation');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('queued', 'running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."ledger_kind" AS ENUM('reserve', 'commit', 'release');--> statement-breakpoint
CREATE TYPE "public"."practice_status" AS ENUM('queued', 'generating', 'validating', 'ready', 'in_progress', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."translation_scope" AS ENUM('paragraph', 'full');--> statement-breakpoint
CREATE TYPE "public"."translation_status" AS ENUM('queued', 'generating', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."user_kind" AS ENUM('guest', 'registered');--> statement-breakpoint
CREATE TYPE "public"."vocabulary_status" AS ENUM('pending', 'reviewing', 'mastered', 'self_reported');--> statement-breakpoint
CREATE TABLE "answer_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"practice_session_id" uuid NOT NULL,
	"practice_question_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"answer_kind" "answer_kind" NOT NULL,
	"selected_option_id" uuid,
	"is_correct" boolean NOT NULL,
	"was_assisted" boolean NOT NULL,
	"elapsed_ms" integer NOT NULL,
	"idempotency_key" text NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "answer_kind_shape_check" CHECK (("answer_attempts"."answer_kind" = 'dont_know' and "answer_attempts"."selected_option_id" is null and "answer_attempts"."is_correct" = false) or ("answer_attempts"."answer_kind" = 'option' and "answer_attempts"."selected_option_id" is not null)),
	CONSTRAINT "answer_elapsed_check" CHECK ("answer_attempts"."elapsed_ms" >= 0)
);
--> statement-breakpoint
CREATE TABLE "assistance_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"practice_session_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "assistance_kind" NOT NULL,
	"practice_target_id" uuid,
	"paragraph_id" uuid,
	"idempotency_key" text NOT NULL,
	"shown_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assistance_kind_shape_check" CHECK ((
        "assistance_events"."kind" = 'word_hint' and
        "assistance_events"."practice_target_id" is not null and
        "assistance_events"."paragraph_id" is null
      ) or (
        "assistance_events"."kind" = 'paragraph_translation' and
        "assistance_events"."practice_target_id" is null and
        "assistance_events"."paragraph_id" is not null
      ) or (
        "assistance_events"."kind" = 'full_translation' and
        "assistance_events"."practice_target_id" is null and
        "assistance_events"."paragraph_id" is null
      ))
);
--> statement-breakpoint
CREATE TABLE "idempotency_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"operation" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "installations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "job_kind" NOT NULL,
	"resource_id" uuid NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"lease_expires_at" timestamp with time zone,
	"locked_by" text,
	"deadline_at" timestamp with time zone NOT NULL,
	"last_error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "jobs_attempts_check" CHECK ("jobs"."attempt_count" >= 0 and "jobs"."max_attempts" > 0)
);
--> statement-breakpoint
CREATE TABLE "learning_progress" (
	"vocabulary_item_id" uuid PRIMARY KEY NOT NULL,
	"practice_count" integer DEFAULT 0 NOT NULL,
	"first_try_correct_count" integer DEFAULT 0 NOT NULL,
	"assisted_count" integer DEFAULT 0 NOT NULL,
	"last_practiced_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "learning_progress_nonnegative_check" CHECK ("learning_progress"."practice_count" >= 0 and "learning_progress"."first_try_correct_count" >= 0 and "learning_progress"."assisted_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "practice_paragraphs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"practice_session_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"plain_text" text NOT NULL,
	CONSTRAINT "practice_paragraph_position_unique" UNIQUE("practice_session_id","position"),
	CONSTRAINT "practice_paragraph_position_check" CHECK ("practice_paragraphs"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "practice_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"practice_target_id" uuid NOT NULL,
	"prompt" text NOT NULL,
	"options_json" jsonb NOT NULL,
	"correct_option_id" uuid NOT NULL,
	"meaning_en" text NOT NULL,
	"explanation_zh" text NOT NULL,
	"option_explanations_json" jsonb NOT NULL,
	CONSTRAINT "practice_question_target_unique" UNIQUE("practice_target_id")
);
--> statement-breakpoint
CREATE TABLE "practice_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"exam_path" "exam_path" DEFAULT 'ielts' NOT NULL,
	"status" "practice_status" DEFAULT 'queued' NOT NULL,
	"article_title" text,
	"article_word_count" integer,
	"model_name" text,
	"prompt_version" text,
	"failure_code" text,
	"failure_message_public" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ready_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "practice_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"practice_session_id" uuid NOT NULL,
	"vocabulary_item_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"paragraph_id" uuid,
	"surface_form" text,
	"start_offset" integer,
	"end_offset" integer,
	CONSTRAINT "practice_target_position_unique" UNIQUE("practice_session_id","position"),
	CONSTRAINT "practice_target_position_check" CHECK ("practice_targets"."position" >= 0),
	CONSTRAINT "practice_target_generated_shape_check" CHECK ((
        "practice_targets"."paragraph_id" is null and
        "practice_targets"."surface_form" is null and
        "practice_targets"."start_offset" is null and
        "practice_targets"."end_offset" is null
      ) or (
        "practice_targets"."paragraph_id" is not null and
        "practice_targets"."surface_form" is not null and
        "practice_targets"."start_offset" >= 0 and
        "practice_targets"."end_offset" > "practice_targets"."start_offset"
      ))
);
--> statement-breakpoint
CREATE TABLE "translations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"practice_session_id" uuid NOT NULL,
	"scope" "translation_scope" NOT NULL,
	"paragraph_id" uuid,
	"source_hash" text NOT NULL,
	"status" "translation_status" DEFAULT 'queued' NOT NULL,
	"translated_text_zh" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ready_at" timestamp with time zone,
	CONSTRAINT "translation_cache_unique" UNIQUE NULLS NOT DISTINCT("practice_session_id","scope","paragraph_id","source_hash"),
	CONSTRAINT "translation_scope_shape_check" CHECK (("translations"."scope" = 'full' and "translations"."paragraph_id" is null) or ("translations"."scope" = 'paragraph' and "translations"."paragraph_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "usage_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"practice_session_id" uuid NOT NULL,
	"kind" "ledger_kind" NOT NULL,
	"amount" integer NOT NULL,
	"operation_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usage_kind_amount_check" CHECK (("usage_ledger"."kind" = 'reserve' and "usage_ledger"."amount" = -1) or ("usage_ledger"."kind" = 'commit' and "usage_ledger"."amount" = 0) or ("usage_ledger"."kind" = 'release' and "usage_ledger"."amount" = 1))
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "user_kind" DEFAULT 'guest' NOT NULL,
	"age_confirmed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "vocabulary_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"term" text NOT NULL,
	"normalized_term" text NOT NULL,
	"meaning_zh" text NOT NULL,
	"normalized_meaning_zh" text NOT NULL,
	"source_sentence" text,
	"fingerprint" text NOT NULL,
	"status" "vocabulary_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "answer_attempts" ADD CONSTRAINT "answer_attempts_practice_session_id_practice_sessions_id_fk" FOREIGN KEY ("practice_session_id") REFERENCES "public"."practice_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answer_attempts" ADD CONSTRAINT "answer_attempts_practice_question_id_practice_questions_id_fk" FOREIGN KEY ("practice_question_id") REFERENCES "public"."practice_questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answer_attempts" ADD CONSTRAINT "answer_attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistance_events" ADD CONSTRAINT "assistance_events_practice_session_id_practice_sessions_id_fk" FOREIGN KEY ("practice_session_id") REFERENCES "public"."practice_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistance_events" ADD CONSTRAINT "assistance_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistance_events" ADD CONSTRAINT "assistance_events_practice_target_id_practice_targets_id_fk" FOREIGN KEY ("practice_target_id") REFERENCES "public"."practice_targets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistance_events" ADD CONSTRAINT "assistance_events_paragraph_id_practice_paragraphs_id_fk" FOREIGN KEY ("paragraph_id") REFERENCES "public"."practice_paragraphs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installations" ADD CONSTRAINT "installations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_progress" ADD CONSTRAINT "learning_progress_vocabulary_item_id_vocabulary_items_id_fk" FOREIGN KEY ("vocabulary_item_id") REFERENCES "public"."vocabulary_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_paragraphs" ADD CONSTRAINT "practice_paragraphs_practice_session_id_practice_sessions_id_fk" FOREIGN KEY ("practice_session_id") REFERENCES "public"."practice_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_questions" ADD CONSTRAINT "practice_questions_practice_target_id_practice_targets_id_fk" FOREIGN KEY ("practice_target_id") REFERENCES "public"."practice_targets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_sessions" ADD CONSTRAINT "practice_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_targets" ADD CONSTRAINT "practice_targets_practice_session_id_practice_sessions_id_fk" FOREIGN KEY ("practice_session_id") REFERENCES "public"."practice_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_targets" ADD CONSTRAINT "practice_targets_vocabulary_item_id_vocabulary_items_id_fk" FOREIGN KEY ("vocabulary_item_id") REFERENCES "public"."vocabulary_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_targets" ADD CONSTRAINT "practice_targets_paragraph_id_practice_paragraphs_id_fk" FOREIGN KEY ("paragraph_id") REFERENCES "public"."practice_paragraphs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "translations" ADD CONSTRAINT "translations_practice_session_id_practice_sessions_id_fk" FOREIGN KEY ("practice_session_id") REFERENCES "public"."practice_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "translations" ADD CONSTRAINT "translations_paragraph_id_practice_paragraphs_id_fk" FOREIGN KEY ("paragraph_id") REFERENCES "public"."practice_paragraphs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_ledger" ADD CONSTRAINT "usage_ledger_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_ledger" ADD CONSTRAINT "usage_ledger_practice_session_id_practice_sessions_id_fk" FOREIGN KEY ("practice_session_id") REFERENCES "public"."practice_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vocabulary_items" ADD CONSTRAINT "vocabulary_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "answer_first_attempt_unique" ON "answer_attempts" USING btree ("user_id","practice_question_id");--> statement-breakpoint
CREATE UNIQUE INDEX "answer_idempotency_unique" ON "answer_attempts" USING btree ("user_id","practice_session_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "assistance_idempotency_unique" ON "assistance_events" USING btree ("user_id","practice_session_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_operation_key_unique" ON "idempotency_records" USING btree ("user_id","operation","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "installations_token_hash_unique" ON "installations" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "installations_user_idx" ON "installations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "jobs_claimable_idx" ON "jobs" USING btree ("status","available_at","lease_expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_active_resource_unique" ON "jobs" USING btree ("kind","resource_id") WHERE "jobs"."status" in ('queued', 'running');--> statement-breakpoint
CREATE INDEX "practice_user_created_idx" ON "practice_sessions" USING btree ("user_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "practice_target_item_unique" ON "practice_targets" USING btree ("practice_session_id","vocabulary_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "usage_operation_unique" ON "usage_ledger" USING btree ("operation_key");--> statement-breakpoint
CREATE INDEX "usage_user_idx" ON "usage_ledger" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "active_vocabulary_fingerprint_unique" ON "vocabulary_items" USING btree ("user_id","fingerprint") WHERE "vocabulary_items"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "vocabulary_user_created_idx" ON "vocabulary_items" USING btree ("user_id","created_at","id");