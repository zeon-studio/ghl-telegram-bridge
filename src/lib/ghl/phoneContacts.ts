/**
 * Phone Account equivalent of lib/ghl/contacts.ts — resolves a Telegram
 * chat (DM, group, or channel) reached via a Phone Account to a GHL
 * contact, auto-creating both on first contact. Kept as a separate file
 * per the "separate parallel tables" decision, not merged with contacts.ts.
 */

import HighLevel from "@gohighlevel/api-client";
import { Prisma, type PhoneContactMapping } from "@prisma/client";
import { prisma } from "../prisma";

export interface PhoneChatInfo {
  chatId: string;
  chatType: string; // "user" | "group" | "channel"
  chatName?: string;
}

function ghlClient(accessToken: string): HighLevel {
  // See lib/ghl/contacts.ts for why clientId/clientSecret are required here
  // even though only locationAccessToken is actually used.
  return new HighLevel({
    clientId: process.env.GHL_CLIENT_ID!,
    clientSecret: process.env.GHL_CLIENT_SECRET!,
    locationAccessToken: accessToken,
  });
}

export async function findOrCreatePhoneContactMapping(
  phoneAccountId: string,
  locationId: string,
  accessToken: string,
  chat: PhoneChatInfo,
  accountLabel: string,
): Promise<PhoneContactMapping> {
  const existing = await prisma.phoneContactMapping.findUnique({
    where: { phoneAccountId_telegramChatId: { phoneAccountId, telegramChatId: chat.chatId } },
  });
  if (existing) return existing;

  const ghl = ghlClient(accessToken);
  const displayName = chat.chatName || "Telegram Contact";

  const response = await ghl.contacts.createContact({
    locationId,
    // GHL rejects contact creation with 422 "Contacts without email, phone,
    // firstName and lastName are not allowed" unless at least one of those
    // four fields is set — `name` alone isn't enough. Chats (especially
    // groups/channels) don't have a real first/last split, so firstName
    // just carries the same display name to satisfy the requirement.
    firstName: displayName,
    // Suffixed with the phone account's own label so multiple connected
    // accounts stay distinguishable in the GHL conversation sidebar. The
    // locally-stored telegramChatName below keeps the chat's real name,
    // unprefixed.
    name: `Sender: ${displayName} Acc: ${accountLabel}`,
    source: "Telegram",
  });

  const ghlContactId = response.contact?.id;
  if (!ghlContactId) {
    throw new Error(`GHL contact creation returned no id: ${JSON.stringify(response)}`);
  }

  try {
    return await prisma.phoneContactMapping.create({
      data: {
        phoneAccountId,
        locationId,
        telegramChatId: chat.chatId,
        telegramChatType: chat.chatType,
        telegramChatName: displayName,
        ghlContactId,
      },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const winner = await prisma.phoneContactMapping.findUnique({
        where: { phoneAccountId_telegramChatId: { phoneAccountId, telegramChatId: chat.chatId } },
      });
      if (winner) return winner;
    }
    throw e;
  }
}
