import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import * as telegram from "@/lib/telegram/client";
import { findOrCreateContactMapping } from "@/lib/ghl/contacts";
import { pushInboundMessage, uploadMediaToGhl } from "@/lib/ghl/conversations";
import { sessionStorage } from "@/lib/ghl/client";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ secret: string }> },
): Promise<NextResponse> {
  const { secret } = await params;

  const bot = await prisma.telegramBot.findUnique({ where: { webhookSecret: secret } });
  if (!bot || !bot.isActive) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const secretHeader = request.headers.get("x-telegram-bot-api-secret-token");
  if (secretHeader !== bot.webhookSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const update = (await request.json()) as telegram.TelegramUpdate;
  const message = update.message;
  if (!message) {
    return NextResponse.json({ ok: true });
  }

  const telegramMessageId = String(message.message_id);

  const existingLog = await prisma.messageLog.findFirst({
    where: { botId: bot.id, telegramMessageId, direction: "INBOUND", status: "SENT" },
  });
  if (existingLog) {
    return NextResponse.json({ ok: true });
  }

  const session = await sessionStorage.get(bot.locationId);
  if (!session) {
    await prisma.messageLog.create({
      data: {
        botId: bot.id,
        locationId: bot.locationId,
        direction: "INBOUND",
        contentType: "text",
        textContent: message.text ?? message.caption ?? null,
        telegramMessageId,
        status: "FAILED",
        errorMessage: "GHL session expired — reconnect this location",
      },
    });
    return NextResponse.json({ ok: true });
  }

  try {
    const mapping = await findOrCreateContactMapping(
      bot.id,
      bot.locationId,
      session.accessToken,
      {
        chatId: String(message.chat.id),
        userId: message.from ? String(message.from.id) : undefined,
        username: message.from?.username,
        firstName: message.from?.first_name ?? message.chat.first_name,
        lastName: message.from?.last_name ?? message.chat.last_name,
      },
      bot.displayName || bot.botUsername,
    );

    let contentType = "text";
    let mediaUrl: string | undefined;
    const attachmentUrls: string[] = [];

    if (message.photo && message.photo.length > 0) {
      contentType = "photo";
      const largest = message.photo[message.photo.length - 1];
      const file = await telegram.getFile(bot.botToken, largest.file_id);
      if (file.file_path) {
        const buffer = await telegram.downloadFile(bot.botToken, file.file_path);
        mediaUrl = await uploadMediaToGhl(
          buffer,
          `telegram-photo-${message.message_id}.jpg`,
          "image/jpeg",
          bot.locationId,
          session.accessToken,
        );
        attachmentUrls.push(mediaUrl);
      }
    } else if (message.document) {
      contentType = "document";
      const file = await telegram.getFile(bot.botToken, message.document.file_id);
      if (file.file_path) {
        const buffer = await telegram.downloadFile(bot.botToken, file.file_path);
        mediaUrl = await uploadMediaToGhl(
          buffer,
          message.document.file_name ?? `telegram-document-${message.message_id}`,
          message.document.mime_type ?? "application/octet-stream",
          bot.locationId,
          session.accessToken,
        );
        attachmentUrls.push(mediaUrl);
      }
    } else if (message.voice) {
      contentType = "voice";
      const file = await telegram.getFile(bot.botToken, message.voice.file_id);
      if (file.file_path) {
        const buffer = await telegram.downloadFile(bot.botToken, file.file_path);
        mediaUrl = await uploadMediaToGhl(
          buffer,
          `telegram-voice-${message.message_id}.ogg`,
          message.voice.mime_type ?? "audio/ogg",
          bot.locationId,
          session.accessToken,
        );
        attachmentUrls.push(mediaUrl);
      }
    } else if (message.video) {
      contentType = "video";
      const file = await telegram.getFile(bot.botToken, message.video.file_id);
      if (file.file_path) {
        const buffer = await telegram.downloadFile(bot.botToken, file.file_path);
        mediaUrl = await uploadMediaToGhl(
          buffer,
          `telegram-video-${message.message_id}.mp4`,
          message.video.mime_type ?? "video/mp4",
          bot.locationId,
          session.accessToken,
        );
        attachmentUrls.push(mediaUrl);
      }
    }

    // Falls back to a placeholder for Telegram message kinds we don't parse
    // yet (stickers, polls, locations, video notes, ...) — without this,
    // an unhandled type pushes to GHL with no text and no attachments,
    // which shows up as a blank message in the Inbox instead of something
    // staff can act on.
    const text =
      message.text ??
      message.caption ??
      (attachmentUrls.length === 0 ? "[Unsupported Telegram message type — check Telegram directly]" : undefined);

    const { messageId } = await pushInboundMessage({
      contactId: mapping.ghlContactId,
      locationId: bot.locationId,
      accessToken: session.accessToken,
      text,
      attachmentUrls: attachmentUrls.length > 0 ? attachmentUrls : undefined,
    });

    await prisma.messageLog.create({
      data: {
        botId: bot.id,
        locationId: bot.locationId,
        contactMappingId: mapping.id,
        direction: "INBOUND",
        contentType,
        textContent: text,
        mediaUrl,
        telegramMessageId,
        ghlMessageId: messageId,
        status: "SENT",
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("[Telegram Webhook] Failed to process message:", error);
    await prisma.messageLog.create({
      data: {
        botId: bot.id,
        locationId: bot.locationId,
        direction: "INBOUND",
        contentType: "text",
        textContent: message.text ?? message.caption ?? null,
        telegramMessageId,
        status: "FAILED",
        errorMessage,
      },
    });
  }

  return NextResponse.json({ ok: true });
}
