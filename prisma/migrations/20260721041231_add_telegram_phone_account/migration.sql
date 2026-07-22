-- CreateTable
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

-- CreateTable
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

-- CreateTable
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

-- CreateIndex
CREATE INDEX "telegram_phone_accounts_location_id_idx" ON "telegram_phone_accounts"("location_id");

-- CreateIndex
CREATE INDEX "phone_contact_mappings_location_id_idx" ON "phone_contact_mappings"("location_id");

-- CreateIndex
CREATE UNIQUE INDEX "phone_contact_mappings_phone_account_id_telegram_chat_id_key" ON "phone_contact_mappings"("phone_account_id", "telegram_chat_id");

-- CreateIndex
CREATE INDEX "phone_message_logs_location_id_idx" ON "phone_message_logs"("location_id");

-- CreateIndex
CREATE INDEX "phone_message_logs_phone_account_id_created_at_idx" ON "phone_message_logs"("phone_account_id", "created_at");

-- AddForeignKey
ALTER TABLE "phone_contact_mappings" ADD CONSTRAINT "phone_contact_mappings_phone_account_id_fkey" FOREIGN KEY ("phone_account_id") REFERENCES "telegram_phone_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "phone_message_logs" ADD CONSTRAINT "phone_message_logs_phone_account_id_fkey" FOREIGN KEY ("phone_account_id") REFERENCES "telegram_phone_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "phone_message_logs" ADD CONSTRAINT "phone_message_logs_contact_mapping_id_fkey" FOREIGN KEY ("contact_mapping_id") REFERENCES "phone_contact_mappings"("id") ON DELETE SET NULL ON UPDATE CASCADE;
