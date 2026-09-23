ALTER TABLE "practice_sessions" ADD COLUMN "generation_progress" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
UPDATE "practice_sessions" SET "generation_progress" = 100
WHERE "status" IN ('ready', 'in_progress', 'completed');
