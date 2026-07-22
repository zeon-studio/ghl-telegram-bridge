-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('SENT', 'FAILED');

-- CreateTable
CREATE TABLE "sessions" (
    "location_id" TEXT NOT NULL,
    "access_token" TEXT NOT NULL,
    "refresh_token" TEXT NOT NULL,
    "expires_at" BIGINT NOT NULL,
    "user_id" TEXT,
    "company_id" TEXT,
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

-- CreateTable
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

-- CreateTable
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

-- CreateTable
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

-- CreateIndex
CREATE UNIQUE INDEX "telegram_bots_webhook_secret_key" ON "telegram_bots"("webhook_secret");

-- CreateIndex
CREATE INDEX "telegram_bots_location_id_idx" ON "telegram_bots"("location_id");

-- CreateIndex
CREATE INDEX "contact_mappings_location_id_idx" ON "contact_mappings"("location_id");

-- CreateIndex
CREATE UNIQUE INDEX "contact_mappings_bot_id_telegram_chat_id_key" ON "contact_mappings"("bot_id", "telegram_chat_id");

-- CreateIndex
CREATE INDEX "message_logs_location_id_idx" ON "message_logs"("location_id");

-- CreateIndex
CREATE INDEX "message_logs_bot_id_created_at_idx" ON "message_logs"("bot_id", "created_at");

-- AddForeignKey
ALTER TABLE "contact_mappings" ADD CONSTRAINT "contact_mappings_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "telegram_bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_logs" ADD CONSTRAINT "message_logs_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "telegram_bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_logs" ADD CONSTRAINT "message_logs_contact_mapping_id_fkey" FOREIGN KEY ("contact_mapping_id") REFERENCES "contact_mappings"("id") ON DELETE SET NULL ON UPDATE CASCADE;
