ALTER TABLE "practice_sessions" ADD COLUMN "topic_group_id" uuid;--> statement-breakpoint
ALTER TABLE "practice_sessions" ADD COLUMN "topic" text;--> statement-breakpoint
ALTER TABLE "practice_sessions" ADD COLUMN "topic_position" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "practice_group_position_idx" ON "practice_sessions" USING btree ("topic_group_id","topic_position");--> statement-breakpoint
CREATE UNIQUE INDEX "practice_group_topic_idx" ON "practice_sessions" USING btree ("topic_group_id","topic");