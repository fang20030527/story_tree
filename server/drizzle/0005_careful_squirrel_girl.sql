CREATE TABLE "vocabulary_words" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"normalized_term" text NOT NULL,
	"review_state" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "word_review_events" (
	"word_id" uuid NOT NULL,
	"practice_id" uuid NOT NULL,
	"vocabulary_item_id" uuid NOT NULL,
	"outcome" text NOT NULL,
	"was_assisted" boolean NOT NULL,
	"reviewed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "word_review_outcome_check" CHECK ("word_review_events"."outcome" in ('independent', 'failed', 'translated'))
);
--> statement-breakpoint
ALTER TABLE "vocabulary_items" ADD COLUMN "word_id" uuid;--> statement-breakpoint
ALTER TABLE "vocabulary_words" ADD CONSTRAINT "vocabulary_words_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "word_review_events" ADD CONSTRAINT "word_review_events_word_id_vocabulary_words_id_fk" FOREIGN KEY ("word_id") REFERENCES "public"."vocabulary_words"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "word_review_events" ADD CONSTRAINT "word_review_events_practice_id_practice_sessions_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practice_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "word_review_events" ADD CONSTRAINT "word_review_events_vocabulary_item_id_vocabulary_items_id_fk" FOREIGN KEY ("vocabulary_item_id") REFERENCES "public"."vocabulary_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "vocabulary_word_user_term_unique" ON "vocabulary_words" USING btree ("user_id","normalized_term");--> statement-breakpoint
CREATE UNIQUE INDEX "word_review_practice_unique" ON "word_review_events" USING btree ("word_id","practice_id");--> statement-breakpoint
ALTER TABLE "vocabulary_items" ADD CONSTRAINT "vocabulary_items_word_id_vocabulary_words_id_fk" FOREIGN KEY ("word_id") REFERENCES "public"."vocabulary_words"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
INSERT INTO "vocabulary_words" ("user_id", "normalized_term", "created_at")
SELECT "user_id", "normalized_term", min("created_at") FROM "vocabulary_items"
GROUP BY "user_id", "normalized_term"
ON CONFLICT ("user_id", "normalized_term") DO NOTHING;
--> statement-breakpoint
UPDATE "vocabulary_items" AS context SET "word_id" = word."id"
FROM "vocabulary_words" AS word
WHERE context."user_id" = word."user_id" AND context."normalized_term" = word."normalized_term";
