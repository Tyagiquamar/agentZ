CREATE TABLE "device_codes" (
  "id" text PRIMARY KEY,
  "device_code" text NOT NULL UNIQUE,
  "user_code" text NOT NULL UNIQUE,
  "user_id" text,
  "expires_at" timestamp NOT NULL,
  "status" text NOT NULL,
  "last_polled_at" timestamp,
  "polling_interval" integer,
  "client_id" text,
  "scope" text,
  "resources" text[],
  "oauth_client_id" text,
  "reference_id" text REFERENCES "delegation_grants"("id") ON DELETE CASCADE,
  "session_id" text REFERENCES "sessions"("id") ON DELETE CASCADE
);
