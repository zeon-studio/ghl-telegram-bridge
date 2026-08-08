-- CreateIndex
CREATE INDEX "message_logs_bot_id_telegram_message_id_idx" ON "message_logs"("bot_id", "telegram_message_id");

-- CreateIndex
CREATE INDEX "message_logs_created_at_idx" ON "message_logs"("created_at");

-- CreateIndex
CREATE INDEX "phone_message_logs_phone_account_id_telegram_message_id_idx" ON "phone_message_logs"("phone_account_id", "telegram_message_id");

-- CreateIndex
CREATE INDEX "phone_message_logs_created_at_idx" ON "phone_message_logs"("created_at");
