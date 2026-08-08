import { NextRequest, NextResponse, after } from "next/server";
import type { TelegramBot } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import * as telegram from "@/lib/telegram/client";
import { findOrCreateContactMapping } from "@/lib/ghl/contacts";
import { pushInboundMessage, uploadMediaToGhl } from "@/lib/ghl/conversations";
import { sessionStorage } from "@/lib/ghl/client";
import { decryptSecret } from "@/lib/crypto";
import { MediaTooLargeError, composeInboundText } from "@/lib/media-limits";

export const runtime = "nodejs";

interface MediaDescriptor {
  contentType: string;
  fileId: string;
  size?: number;
  fileName: string;
  mimeType: string;
}

/**
 * Picks the one attachment we relay for this update, in the same precedence
 * order the handler has always used. Collapsing the four near-identical
 * branches into a descriptor keeps the size-guard logic in exactly one place
 * below rather than repeated per media type.
 */
function describeMedia(message: telegram.TelegramMessage): MediaDescriptor | undefined {
  if (message.photo && message.photo.length > 0) {
    const largest = message.photo[message.photo.length - 1];
    return {
      contentType: "photo",
      fileId: largest.file_id,
      size: largest.file_size,
      fileName: `telegram-photo-${message.message_id}.jpg`,
      mimeType: "image/jpeg",
    };
  }
  if (message.document) {
    return {
      contentType: "document",
      fileId: message.document.file_id,
      size: message.document.file_size,
      fileName: message.document.file_name ?? `telegram-document-${message.message_id}`,
      mimeType: message.document.mime_type ?? "application/octet-stream",
    };
  }
  if (message.voice) {
    return {
      contentType: "voice",
      fileId: message.voice.file_id,
      size: message.voice.file_size,
      fileName: `telegram-voice-${message.message_id}.ogg`,
      mimeType: message.voice.mime_type ?? "audio/ogg",
    };
  }
  if (message.video) {
    return {
      contentType: "video",
      fileId: message.video.file_id,
      size: message.video.file_size,
      fileName: `telegram-video-${message.message_id}.mp4`,
      mimeType: message.video.mime_type ?? "video/mp4",
    };
  }
  return undefined;
}

async function processInboundMessage(
  bot: TelegramBot,
  message: telegram.TelegramMessage,
): Promise<void> {
  const telegramMessageId = String(message.message_id);

  // Both reads depend only on values already in hand, so they go together
  // rather than back to back — every round-trip to Postgres is on the critical
  // path of relaying a message. Telegram redelivers an update if a previous
  // attempt wasn't acknowledged; we now ack immediately (see POST), so the
  // dedupe check mostly guards genuine duplicates rather than our own
  // slowness, and its hit rate is low enough that fetching the session
  // alongside it is very rarely wasted work.
  const [existingLog, session] = await Promise.all([
    prisma.messageLog.findFirst({
      where: { botId: bot.id, telegramMessageId, direction: "INBOUND", status: "SENT" },
    }),
    sessionStorage.get(bot.locationId),
  ]);
  if (existingLog) return;

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
    return;
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

    const media = describeMedia(message);
    const contentType = media?.contentType ?? "text";
    let mediaUrl: string | undefined;
    let mediaNotice: string | undefined;

    if (media) {
      try {
        const buffer = await telegram.downloadFileWithinLimit(
          decryptSecret(bot.botToken),
          media.fileId,
          media.size,
        );
        mediaUrl = await uploadMediaToGhl(
          buffer,
          media.fileName,
          media.mimeType,
          bot.locationId,
          session.accessToken,
        );
      } catch (error) {
        // An oversized attachment shouldn't lose the message — relay the
        // text and tell the user where to find the file.
        if (!(error instanceof MediaTooLargeError)) throw error;
        mediaNotice = error.message;
        console.warn(
          `[Telegram Webhook] Skipped oversized ${media.contentType} on message ${telegramMessageId}:`,
          error.message,
        );
      }
    }

    const text = composeInboundText(message.text ?? message.caption, mediaNotice, Boolean(mediaUrl));

    const { messageId } = await pushInboundMessage({
      contactId: mapping.ghlContactId,
      locationId: bot.locationId,
      accessToken: session.accessToken,
      text,
      attachmentUrls: mediaUrl ? [mediaUrl] : undefined,
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
}

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

  // Everything past authentication runs after the response is flushed.
  // Relaying a message means a contact lookup, possibly a media download and
  // re-upload, and a write to GHL — far too slow to hold Telegram's webhook
  // connection open for on a 0.1 CPU instance. Doing it inline meant Telegram
  // timed out, retried, and the retry re-did the same work, which is exactly
  // the kind of pile-up a shared free instance can't absorb.
  after(async () => {
    try {
      await processInboundMessage(bot, message);
    } catch (error) {
      console.error("[Telegram Webhook] Unhandled error while relaying message:", error);
    }
  });

  return NextResponse.json({ ok: true });
}
