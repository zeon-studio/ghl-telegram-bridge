// src/lib/telegram/phoneAccountManager.ts
/**
 * In-process singleton holding one live teleproto TelegramClient per
 * active TelegramPhoneAccount. Hot-reload-safe the same way lib/prisma.ts
 * is. No queue, no separate worker process — see design doc.
 */

import { TelegramClient, Api } from "teleproto";
import { NewMessage, type NewMessageEvent } from "teleproto/events";
import { prisma } from "@/lib/prisma";
import { isPhoneAccountEnabled } from "./phoneCredentials";
import { buildPhoneClient, connectPhoneClient, logoutPhoneClient, warmEntityCache } from "./phoneClient";
import { findOrCreatePhoneContactMapping } from "@/lib/ghl/phoneContacts";
import { pushInboundMessage, uploadMediaToGhl } from "@/lib/ghl/conversations";
import { sessionStorage } from "@/lib/ghl/client";
import type { PendingLoginRecord } from "./pendingLogins";

const globalForManager = globalThis as unknown as {
  phoneClients: Map<string, TelegramClient> | undefined;
};

const clients = globalForManager.phoneClients ?? new Map<string, TelegramClient>();
// Unlike lib/prisma.ts's dev-hot-reload-only gate, this singleton must be
// shared unconditionally: it's imported from both instrumentation.ts (boot())
// and route handlers (getClient()), which may live in separate Next.js
// server bundles even in production. There's no "too many connections"
// downside here the way there is for Prisma in dev, so always share it.
globalForManager.phoneClients = clients;

// teleproto's real TypeChat union is wider than classic GramJS: besides
// Chat/Channel it also has ChatForbidden/ChannelForbidden and a
// Community/CommunityForbidden pair (see node_modules/teleproto/tl/generated/api.d.ts
// around the `TypeChat` alias). All of them carry a `className` discriminant
// and a `title`, so they're grouped in below rather than falling through to
// the "user" default the original brief only handled Chat/Channel for.
function resolveChatIdentity(chat: unknown): { chatType: string; chatName?: string } {
  if (chat && typeof chat === "object" && "className" in chat) {
    const c = chat as {
      className: string;
      title?: string;
      broadcast?: boolean;
      firstName?: string;
      lastName?: string;
      username?: string;
    };
    switch (c.className) {
      case "Channel":
      case "ChannelForbidden":
        return { chatType: c.broadcast ? "channel" : "group", chatName: c.title };
      case "Chat":
      case "ChatForbidden":
      case "Community":
      case "CommunityForbidden":
        return { chatType: "group", chatName: c.title };
      default:
        // Mirrors lib/ghl/contacts.ts's fallback chain — a Telegram user
        // with no first/last name set (common for username-only accounts)
        // still has a username; without this, they'd fall all the way to
        // findOrCreatePhoneContactMapping's generic "Telegram Contact".
        return {
          chatType: "user",
          chatName:
            [c.firstName, c.lastName].filter(Boolean).join(" ") ||
            (c.username ? `@${c.username}` : undefined),
        };
    }
  }
  return { chatType: "user" };
}

/**
 * teleproto's `Message.downloadMedia()` is typed `Promise<string | Buffer | undefined>`
 * (see node_modules/teleproto/client/downloads.d.ts / tl/custom/message.d.ts) — it
 * returns a string only when called with an `outputFile` path, which we never pass.
 * We still narrow at runtime instead of casting blindly, since an unsafe cast would
 * silently hand a file-path string to uploadMediaToGhl's Buffer parameter.
 */
async function downloadMessageMedia(message: Api.Message): Promise<Buffer | undefined> {
  const result = await message.downloadMedia();
  if (result === undefined) return undefined;
  if (Buffer.isBuffer(result)) return result;
  console.error(
    `[PhoneAccountManager] downloadMedia() returned a file path instead of a Buffer for message ${message.id}; skipping media relay.`,
  );
  return undefined;
}

async function handleInboundMessage(accountId: string, event: NewMessageEvent): Promise<void> {
  const account = await prisma.telegramPhoneAccount.findUnique({ where: { id: accountId } });
  if (!account || !account.isActive) return;

  const message = event.message;
  const chatId = String(message.chatId);
  const chat = await message.getChat();
  const { chatType, chatName } = resolveChatIdentity(chat);

  const telegramMessageId = String(message.id);

  // TEMPORARY DIAGNOSTIC — remove once the media-relay issue is root-caused.
  console.log("[PhoneAccountManager][DEBUG] message media check:", {
    id: message.id,
    hasMessageText: Boolean(message.message),
    hasMedia: Boolean(message.media),
    mediaClassName:
      message.media && typeof message.media === "object" && "className" in message.media
        ? (message.media as { className: string }).className
        : undefined,
    photo: Boolean(message.photo),
    video: Boolean(message.video),
    voice: Boolean(message.voice),
    document: Boolean(message.document),
  });

  // Dedupe on reconnect: teleproto can redeliver an update after a dropped
  // connection reconnects, same as Telegram's webhook redelivery for bots —
  // mirrors the bot webhook's existing dedupe check.
  const existingLog = await prisma.phoneMessageLog.findFirst({
    where: { phoneAccountId: accountId, telegramMessageId, direction: "INBOUND", status: "SENT" },
  });
  if (existingLog) return;

  const session = await sessionStorage.get(account.locationId);
  if (!session) {
    await prisma.phoneMessageLog.create({
      data: {
        phoneAccountId: account.id,
        locationId: account.locationId,
        direction: "INBOUND",
        contentType: "text",
        textContent: message.message || null,
        telegramMessageId,
        status: "FAILED",
        errorMessage: "GHL session expired — reconnect this location",
      },
    });
    return;
  }

  try {
    const mapping = await findOrCreatePhoneContactMapping(
      account.id,
      account.locationId,
      session.accessToken,
      { chatId, chatType, chatName },
      account.displayName || account.phoneNumber,
    );

    let contentType = "text";
    let mediaUrl: string | undefined;
    const attachmentUrls: string[] = [];

    // Mirrors the bot webhook's per-type media handling (lib/telegram/client.ts
    // callers in the webhook route) so GHL gets a correctly-typed attachment
    // instead of a generic blob — teleproto's Message exposes the same
    // photo/video/voice/document convenience getters as its GramJS parent
    // (confirmed: Api.Message extends CustomMessage in
    // node_modules/teleproto/tl/generated/api.d.ts, and CustomMessage declares
    // these getters in node_modules/teleproto/tl/custom/message.d.ts).
    if (message.photo) {
      const buffer = await downloadMessageMedia(message);
      if (buffer) {
        contentType = "photo";
        mediaUrl = await uploadMediaToGhl(
          buffer,
          `telegram-phone-photo-${message.id}.jpg`,
          "image/jpeg",
          account.locationId,
          session.accessToken,
        );
        attachmentUrls.push(mediaUrl);
      }
    } else if (message.video) {
      const buffer = await downloadMessageMedia(message);
      if (buffer) {
        contentType = "video";
        mediaUrl = await uploadMediaToGhl(
          buffer,
          `telegram-phone-video-${message.id}.mp4`,
          "video/mp4",
          account.locationId,
          session.accessToken,
        );
        attachmentUrls.push(mediaUrl);
      }
    } else if (message.voice) {
      const buffer = await downloadMessageMedia(message);
      if (buffer) {
        contentType = "voice";
        mediaUrl = await uploadMediaToGhl(
          buffer,
          `telegram-phone-voice-${message.id}.ogg`,
          "audio/ogg",
          account.locationId,
          session.accessToken,
        );
        attachmentUrls.push(mediaUrl);
      }
    } else if (message.document) {
      const buffer = await downloadMessageMedia(message);
      if (buffer) {
        contentType = "document";
        mediaUrl = await uploadMediaToGhl(
          buffer,
          `telegram-phone-document-${message.id}`,
          "application/octet-stream",
          account.locationId,
          session.accessToken,
        );
        attachmentUrls.push(mediaUrl);
      }
    }

    const text =
      message.message ||
      (attachmentUrls.length === 0
        ? "[Unsupported Telegram message type — check Telegram directly]"
        : undefined);

    const { messageId } = await pushInboundMessage({
      contactId: mapping.ghlContactId,
      locationId: account.locationId,
      accessToken: session.accessToken,
      text,
      attachmentUrls: attachmentUrls.length > 0 ? attachmentUrls : undefined,
    });

    await prisma.phoneMessageLog.create({
      data: {
        phoneAccountId: account.id,
        locationId: account.locationId,
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
    console.error(`[PhoneAccountManager] Failed to relay message for ${accountId}:`, error);
    await prisma.phoneMessageLog.create({
      data: {
        phoneAccountId: account.id,
        locationId: account.locationId,
        direction: "INBOUND",
        contentType: "text",
        textContent: message.message || null,
        telegramMessageId,
        status: "FAILED",
        errorMessage,
      },
    });
  }
}

async function attachInboundHandler(accountId: string, client: TelegramClient): Promise<void> {
  client.addEventHandler(
    (event: NewMessageEvent) => {
      handleInboundMessage(accountId, event).catch((error) =>
        console.error(`[PhoneAccountManager] Unhandled relay error for ${accountId}:`, error),
      );
    },
    new NewMessage({ incoming: true }),
  );
}

export async function boot(): Promise<void> {
  if (!isPhoneAccountEnabled()) {
    console.log(
      "[PhoneAccountManager] TELEGRAM_API_ID/TELEGRAM_API_HASH not set — Phone Account disabled.",
    );
    return;
  }

  const accounts = await prisma.telegramPhoneAccount.findMany({ where: { isActive: true } });
  for (const account of accounts) {
    try {
      await startAccount(account.id, account.sessionString);
    } catch (error) {
      console.error(`[PhoneAccountManager] Failed to reconnect account ${account.id}:`, error);
      await prisma.telegramPhoneAccount.update({
        where: { id: account.id },
        data: { needsAttention: true },
      });
    }
  }
}

export async function startAccount(accountId: string, sessionString: string): Promise<void> {
  const client = await connectPhoneClient(sessionString);
  clients.set(accountId, client);
  await attachInboundHandler(accountId, client);
}

export async function stopAccount(accountId: string): Promise<void> {
  const client = clients.get(accountId);
  if (!client) return;
  await client.disconnect();
  clients.delete(accountId);
}

export async function deleteAccount(accountId: string): Promise<void> {
  const client = clients.get(accountId);
  if (client) {
    await logoutPhoneClient(client);
    clients.delete(accountId);
  }
}

export function getClient(accountId: string): TelegramClient | undefined {
  return clients.get(accountId);
}

export async function completeLogin(pending: PendingLoginRecord): Promise<{
  id: string;
  phoneNumber: string;
  telegramUsername: string | null;
  displayName: string | null;
  isActive: boolean;
  needsAttention: boolean;
  createdAt: string;
}> {
  const me = await pending.client.getMe();

  // `pending.client` is typed `TelegramClient` (default `Session` generic —
  // see pendingLogins.ts's plain `import type { TelegramClient } from "teleproto"`),
  // so `.session` is the abstract `Session` base whose `save()` signature is
  // `void | string` (node_modules/teleproto/sessions/Abstract.d.ts). At runtime
  // it's always a `StringSession` (built in phoneClient.ts's buildPhoneClient),
  // whose own `save(): string` override (StringSession.d.ts) is genuinely
  // synchronous, not a Promise — but the static type doesn't know that, so we
  // narrow at runtime instead of the brief's `as unknown as string` cast.
  const savedSession = pending.client.session.save();
  if (typeof savedSession !== "string") {
    throw new Error("Phone Account login produced no session string — cannot persist account");
  }
  const sessionString = savedSession;

  const account = await prisma.telegramPhoneAccount.create({
    data: {
      locationId: pending.locationId,
      phoneNumber: pending.phoneNumber,
      sessionString,
      telegramUserId: String(me.id),
      telegramUsername: "username" in me ? (me.username ?? null) : null,
      displayName: null,
    },
  });

  clients.set(account.id, pending.client);
  await warmEntityCache(pending.client);
  await attachInboundHandler(account.id, pending.client);

  return {
    id: account.id,
    phoneNumber: account.phoneNumber,
    telegramUsername: account.telegramUsername,
    displayName: account.displayName,
    isActive: account.isActive,
    needsAttention: account.needsAttention,
    createdAt: account.createdAt.toISOString(),
  };
}
