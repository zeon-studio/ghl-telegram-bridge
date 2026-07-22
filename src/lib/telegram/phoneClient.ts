/**
 * lib/telegram/phoneClient.ts
 * -----------------------
 * Thin wrapper around teleproto (MTProto user-account client) — the
 * Phone Account equivalent of lib/telegram/client.ts's Bot API wrapper.
 */

import { TelegramClient } from "teleproto";
import { Api } from "teleproto";
import { StringSession } from "teleproto/sessions";
import { getTelegramApiCredentials } from "./phoneCredentials";

export function buildPhoneClient(sessionString: string): TelegramClient {
  const { apiId, apiHash } = getTelegramApiCredentials();
  const session = new StringSession(sessionString);
  return new TelegramClient(session, apiId, apiHash, { connectionRetries: 5 });
}

/**
 * teleproto's Message#getChat()/getSender() only resolve an entity from the
 * client's local cache or from whatever entity data happened to ride along
 * with a given update — they don't proactively fetch anything. A freshly
 * connected client (nothing cached yet) silently returns `undefined` for a
 * chat/sender it hasn't "seen" before, instead of fetching it. Calling
 * getDialogs() once after connecting populates that cache with full
 * user/chat/channel info for every existing conversation, so inbound
 * messages that arrive right after connecting can resolve real names.
 */
export async function warmEntityCache(client: TelegramClient): Promise<void> {
  try {
    await client.getDialogs({});
  } catch (error) {
    console.error("[phoneClient] Failed to warm entity cache via getDialogs:", error);
  }
}

/** For an already-authorized session (reconnect on boot/resume) — no interactive login. */
export async function connectPhoneClient(sessionString: string): Promise<TelegramClient> {
  const client = buildPhoneClient(sessionString);
  await client.connect();
  await warmEntityCache(client);
  return client;
}

export async function sendPhoneMessage(
  client: TelegramClient,
  chatId: string,
  text: string,
): Promise<void> {
  await client.sendMessage(chatId, { message: text });
}

export async function sendPhoneMedia(
  client: TelegramClient,
  chatId: string,
  fileUrl: string,
  caption?: string,
): Promise<void> {
  await client.sendFile(chatId, { file: fileUrl, caption });
}

export async function logoutPhoneClient(client: TelegramClient): Promise<void> {
  try {
    await client.invoke(new Api.auth.LogOut());
  } finally {
    await client.disconnect();
  }
}
