CREATE TABLE "speaking_storage_cleanup" (
	"storage_key" text PRIMARY KEY NOT NULL,
	"not_before" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "speaking_assets" ADD COLUMN "upload_lease_token" uuid;--> statement-breakpoint
ALTER TABLE "speaking_assets" ADD COLUMN "upload_lease_until" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "speaking_storage_cleanup_due_idx" ON "speaking_storage_cleanup" USING btree ("not_before");