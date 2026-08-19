-- Squashed baseline schema for ghl-telegram.
-- Server access uses the database connection; no public Supabase Data API
-- access is intended for these tables.
CREATE SCHEMA IF NOT EXISTS "public";

CREATE TYPE "MessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');
CREATE TYPE "MessageStatus" AS ENUM ('SENT', 'FAILED');

CREATE TABLE "sessions" (
    "location_id" TEXT NOT NULL,
    "access_token" TEXT NOT NULL,
    "refresh_token" TEXT NOT NULL,
    "expires_at" BIGINT NOT NULL,
    "user_id" TEXT,
    "company_id" TEXT,
    "uses_agency_token" BOOLEAN NOT NULL DEFAULT false,
    "location_name" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "city" TEXT,
    "country" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "sessions_pkey" PRIMARY KEY ("location_id")
);

CREATE TABLE "telegram_bots" (
    "id" TEXT NOT NULL,
    "location_id" TEXT NOT NULL,
    "bot_token" TEXT NOT NULL,
    "telegram_bot_id" TEXT NOT NULL,
    "bot_username" TEXT NOT NULL,
    "display_name" TEXT,
    "webhook_secret" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "telegram_bots_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "contact_mappings" (
    "id" TEXT NOT NULL,
    "bot_id" TEXT NOT NULL,
    "location_id" TEXT NOT NULL,
    "telegram_chat_id" TEXT NOT NULL,
    "telegram_user_id" TEXT,
    "telegram_username" TEXT,
    "telegram_name" TEXT,
    "ghl_contact_id" TEXT NOT NULL,
    "ghl_conversation_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "contact_mappings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "message_logs" (
    "id" TEXT NOT NULL,
    "bot_id" TEXT NOT NULL,
    "location_id" TEXT NOT NULL,
    "contact_mapping_id" TEXT,
    "direction" "MessageDirection" NOT NULL,
    "content_type" TEXT NOT NULL,
    "text_content" TEXT,
    "media_url" TEXT,
    "telegram_message_id" TEXT,
    "ghl_message_id" TEXT,
    "status" "MessageStatus" NOT NULL,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "message_logs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "telegram_phone_accounts" (
    "id" TEXT NOT NULL,
    "location_id" TEXT NOT NULL,
    "phone_number" TEXT NOT NULL,
    "session_string" TEXT NOT NULL,
    "telegram_user_id" TEXT NOT NULL,
    "telegram_username" TEXT,
    "display_name" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "needs_attention" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "telegram_phone_accounts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "phone_contact_mappings" (
    "id" TEXT NOT NULL,
    "phone_account_id" TEXT NOT NULL,
    "location_id" TEXT NOT NULL,
    "telegram_chat_id" TEXT NOT NULL,
    "telegram_chat_type" TEXT NOT NULL,
    "telegram_chat_name" TEXT,
    "ghl_contact_id" TEXT NOT NULL,
    "ghl_conversation_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "phone_contact_mappings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "phone_message_logs" (
    "id" TEXT NOT NULL,
    "phone_account_id" TEXT NOT NULL,
    "location_id" TEXT NOT NULL,
    "contact_mapping_id" TEXT,
    "direction" "MessageDirection" NOT NULL,
    "content_type" TEXT NOT NULL,
    "text_content" TEXT,
    "media_url" TEXT,
    "telegram_message_id" TEXT,
    "ghl_message_id" TEXT,
    "status" "MessageStatus" NOT NULL,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "phone_message_logs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "telegram_bots_webhook_secret_key" ON "telegram_bots"("webhook_secret");
CREATE INDEX "telegram_bots_location_id_idx" ON "telegram_bots"("location_id");
CREATE INDEX "contact_mappings_location_id_idx" ON "contact_mappings"("location_id");
CREATE UNIQUE INDEX "contact_mappings_bot_id_telegram_chat_id_key" ON "contact_mappings"("bot_id", "telegram_chat_id");
CREATE INDEX "message_logs_location_id_idx" ON "message_logs"("location_id");
CREATE INDEX "message_logs_bot_id_created_at_idx" ON "message_logs"("bot_id", "created_at");
CREATE INDEX "message_logs_bot_id_telegram_message_id_idx" ON "message_logs"("bot_id", "telegram_message_id");
CREATE INDEX "message_logs_created_at_idx" ON "message_logs"("created_at");
CREATE INDEX "telegram_phone_accounts_location_id_idx" ON "telegram_phone_accounts"("location_id");
CREATE INDEX "phone_contact_mappings_location_id_idx" ON "phone_contact_mappings"("location_id");
CREATE UNIQUE INDEX "phone_contact_mappings_phone_account_id_telegram_chat_id_key" ON "phone_contact_mappings"("phone_account_id", "telegram_chat_id");
CREATE INDEX "phone_message_logs_location_id_idx" ON "phone_message_logs"("location_id");
CREATE INDEX "phone_message_logs_phone_account_id_created_at_idx" ON "phone_message_logs"("phone_account_id", "created_at");
CREATE INDEX "phone_message_logs_phone_account_id_telegram_message_id_idx" ON "phone_message_logs"("phone_account_id", "telegram_message_id");
CREATE INDEX "phone_message_logs_created_at_idx" ON "phone_message_logs"("created_at");

ALTER TABLE "contact_mappings" ADD CONSTRAINT "contact_mappings_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "telegram_bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "message_logs" ADD CONSTRAINT "message_logs_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "telegram_bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "message_logs" ADD CONSTRAINT "message_logs_contact_mapping_id_fkey" FOREIGN KEY ("contact_mapping_id") REFERENCES "contact_mappings"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "phone_contact_mappings" ADD CONSTRAINT "phone_contact_mappings_phone_account_id_fkey" FOREIGN KEY ("phone_account_id") REFERENCES "telegram_phone_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "phone_message_logs" ADD CONSTRAINT "phone_message_logs_phone_account_id_fkey" FOREIGN KEY ("phone_account_id") REFERENCES "telegram_phone_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "phone_message_logs" ADD CONSTRAINT "phone_message_logs_contact_mapping_id_fkey" FOREIGN KEY ("contact_mapping_id") REFERENCES "phone_contact_mappings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "telegram_bots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contact_mappings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "message_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "telegram_phone_accounts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "phone_contact_mappings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "phone_message_logs" ENABLE ROW LEVEL SECURITY;
