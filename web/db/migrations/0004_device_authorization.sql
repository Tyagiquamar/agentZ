CREATE TABLE "device_codes" (
	"id" text PRIMARY KEY NOT NULL,
	"device_code" text NOT NULL,
	"user_code" text NOT NULL,
	"user_id" text,
	"expires_at" timestamp NOT NULL,
	"status" text NOT NULL,
	"last_polled_at" timestamp,
	"polling_interval" integer,
	"client_id" text,
	"scope" text,
	"resources" text[],
	"oauth_client_id" text,
	"reference_id" text,
	"session_id" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX "deviceCodes_deviceCode_uidx" ON "device_codes" USING btree ("device_code");--> statement-breakpoint
CREATE UNIQUE INDEX "deviceCodes_userCode_uidx" ON "device_codes" USING btree ("user_code");