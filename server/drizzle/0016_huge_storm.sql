CREATE TABLE "message_bottles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"username" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_bottles_content_length" CHECK (char_length("message_bottles"."content") between 1 and 1000)
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "username" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "username_key" text;--> statement-breakpoint
ALTER TABLE "message_bottles" ADD CONSTRAINT "message_bottles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "message_bottles_created_idx" ON "message_bottles" USING btree ("created_at","id");--> statement-breakpoint
CREATE INDEX "message_bottles_user_created_idx" ON "message_bottles" USING btree ("user_id","created_at");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_username_key_unique" UNIQUE("username_key");