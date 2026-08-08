import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import * as telegram from "@/lib/telegram/client";
import { sessionStorage } from "@/lib/ghl/client";
import { updateMessageDeliveryStatus } from "@/lib/ghl/conversations";
import { getClient } from "@/lib/telegram/phoneAccountManager";
import { sendPhoneMessage, sendPhoneMedia } from "@/lib/telegram/phoneClient";
import { decryptSecret } from "@/lib/crypto";

export const runtime = "nodejs";

// Confirmed via live testing against a real GHL "reply from Inbox" event —
// message is a plain string, not the nested { body } object originally
// guessed at here.
interface ConversationProviderOutboundPayload {
  locationId?: string;
  contactId?: string;
  conversationId?: string;
  messageId?: string;
  message?: string;
  attachments?: string[];
  type?: string;
}

interface RelayResult {
  status: "SENT" | "FAILED";
  errorMessage?: string;
  contactMappingId: string;
  botId?: string;
  phoneAccountId?: string;
}

async function relayToBot(
  locationId: string,
  contactId: string,
  text: string | undefined,
  attachments: string[],
): Promise<RelayResult | null> {
  const mapping = await prisma.contactMapping.findFirst({ where: { locationId, ghlContactId: contactId } });
  if (!mapping) return null;

  const bot = await prisma.telegramBot.findUnique({ where: { id: mapping.botId } });
  if (!bot || !bot.isActive) {
    return { status: "FAILED", errorMessage: "Bot not found or inactive", botId: mapping.botId, contactMappingId: mapping.id };
  }

  try {
    const botToken = decryptSecret(bot.botToken);
    if (text) {
      await telegram.sendMessage(botToken, mapping.telegramChatId, text);
    }
    for (const url of attachments) {
      if (/\.(jpe?g|png|gif|webp)$/i.test(url)) {
        await telegram.sendPhoto(botToken, mapping.telegramChatId, url);
      } else {
        await telegram.sendDocument(botToken, mapping.telegramChatId, url);
      }
    }
    if (!text && attachments.length === 0) {
      throw new Error("Outbound payload had no text or attachments to relay");
    }
    return { status: "SENT", botId: bot.id, contactMappingId: mapping.id };
  } catch (error) {
    console.error("[Conversation Provider Outbound] Failed to relay to Telegram:", error);
    return {
      status: "FAILED",
      errorMessage: error instanceof Error ? error.message : "Unknown error",
      botId: bot.id,
      contactMappingId: mapping.id,
    };
  }
}

async function relayToPhoneAccount(
  locationId: string,
  contactId: string,
  text: string | undefined,
  attachments: string[],
): Promise<RelayResult | null> {
  const mapping = await prisma.phoneContactMapping.findFirst({ where: { locationId, ghlContactId: contactId } });
  if (!mapping) return null;

  const account = await prisma.telegramPhoneAccount.findUnique({ where: { id: mapping.phoneAccountId } });
  if (!account || !account.isActive) {
    return {
      status: "FAILED",
      errorMessage: "Phone account not found or inactive",
      phoneAccountId: mapping.phoneAccountId,
      contactMappingId: mapping.id,
    };
  }

  const client = getClient(account.id);
  if (!client) {
    return {
      status: "FAILED",
      errorMessage: "Phone account is not currently connected",
      phoneAccountId: account.id,
      contactMappingId: mapping.id,
    };
  }

  try {
    if (text) {
      await sendPhoneMessage(client, mapping.telegramChatId, text);
    }
    for (const url of attachments) {
      await sendPhoneMedia(client, mapping.telegramChatId, url);
    }
    if (!text && attachments.length === 0) {
      throw new Error("Outbound payload had no text or attachments to relay");
    }
    return { status: "SENT", phoneAccountId: account.id, contactMappingId: mapping.id };
  } catch (error) {
    console.error("[Conversation Provider Outbound] Failed to relay to Telegram Phone Account:", error);
    return {
      status: "FAILED",
      errorMessage: error instanceof Error ? error.message : "Unknown error",
      phoneAccountId: account.id,
      contactMappingId: mapping.id,
    };
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const expectedSecret = process.env.GHL_CONVERSATION_PROVIDER_WEBHOOK_SECRET;
  const providedSecret = request.nextUrl.searchParams.get("secret");
  if (!expectedSecret || providedSecret !== expectedSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = (await request.json()) as ConversationProviderOutboundPayload;
  console.log("[Conversation Provider Outbound] Raw payload:", JSON.stringify(payload));

  const locationId = payload.locationId;
  const contactId = payload.contactId;
  const text = payload.message;
  const attachments = payload.attachments ?? [];
  const messageId = payload.messageId;

  if (!locationId || !contactId) {
    return NextResponse.json({ error: "Missing locationId or contactId" }, { status: 400 });
  }

  const botResult = await relayToBot(locationId, contactId, text, attachments);
  const result = botResult ?? (await relayToPhoneAccount(locationId, contactId, text, attachments));

  if (!result) {
    return NextResponse.json({ error: "No Telegram mapping for this contact" }, { status: 404 });
  }

  const contentType = attachments.length > 0 ? "document" : "text";
  if (result.botId) {
    await prisma.messageLog.create({
      data: {
        botId: result.botId,
        locationId,
        contactMappingId: result.contactMappingId,
        direction: "OUTBOUND",
        contentType,
        textContent: text,
        mediaUrl: attachments[0],
        ghlMessageId: messageId,
        status: result.status,
        errorMessage: result.errorMessage,
      },
    });
  } else if (result.phoneAccountId) {
    await prisma.phoneMessageLog.create({
      data: {
        phoneAccountId: result.phoneAccountId,
        locationId,
        contactMappingId: result.contactMappingId,
        direction: "OUTBOUND",
        contentType,
        textContent: text,
        mediaUrl: attachments[0],
        ghlMessageId: messageId,
        status: result.status,
        errorMessage: result.errorMessage,
      },
    });
  }

  if (messageId) {
    const session = await sessionStorage.get(locationId);
    if (session) {
      try {
        await updateMessageDeliveryStatus(
          messageId,
          result.status === "SENT" ? "delivered" : "failed",
          session.accessToken,
          result.errorMessage,
        );
      } catch (e) {
        console.error("[Conversation Provider Outbound] Failed to update GHL message status:", e);
      }
    }
  }

  return NextResponse.json({ success: result.status === "SENT" });
}
