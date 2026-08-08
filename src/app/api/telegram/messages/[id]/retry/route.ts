import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import * as telegram from "@/lib/telegram/client";
import { sessionStorage } from "@/lib/ghl/client";
import { pushInboundMessage } from "@/lib/ghl/conversations";
import { decryptSecret } from "@/lib/crypto";

export const runtime = "nodejs";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;

  const log = await prisma.messageLog.findUnique({
    where: { id },
    include: { contactMapping: true, bot: true },
  });

  if (!log || log.status !== "FAILED") {
    return NextResponse.json({ error: "Message not found or not retryable" }, { status: 404 });
  }

  const session = await sessionStorage.get(log.locationId);
  if (!session) {
    return NextResponse.json(
      { error: "GHL session expired — reconnect this location" },
      { status: 401 },
    );
  }

  try {
    if (!log.contactMapping) {
      return NextResponse.json({ error: "No contact mapping for this message" }, { status: 400 });
    }

    if (log.direction === "INBOUND") {
      const { messageId } = await pushInboundMessage({
        contactId: log.contactMapping.ghlContactId,
        locationId: log.locationId,
        accessToken: session.accessToken,
        text: log.textContent ?? undefined,
        attachmentUrls: log.mediaUrl ? [log.mediaUrl] : undefined,
      });
      await prisma.messageLog.update({
        where: { id },
        data: { status: "SENT", errorMessage: null, ghlMessageId: messageId },
      });
    } else {
      const botToken = decryptSecret(log.bot.botToken);
      if (log.textContent) {
        await telegram.sendMessage(botToken, log.contactMapping.telegramChatId, log.textContent);
      }
      if (log.mediaUrl) {
        if (/\.(jpe?g|png|gif|webp)$/i.test(log.mediaUrl)) {
          await telegram.sendPhoto(botToken, log.contactMapping.telegramChatId, log.mediaUrl);
        } else {
          await telegram.sendDocument(botToken, log.contactMapping.telegramChatId, log.mediaUrl);
        }
      }
      await prisma.messageLog.update({
        where: { id },
        data: { status: "SENT", errorMessage: null },
      });
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: `Retry failed: ${errorMessage}` }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
