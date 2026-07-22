/**
 * lib/ghl/contacts.ts
 * ---------------------
 * Resolves a Telegram sender to a GHL contact, auto-creating both the
 * contact and the local mapping row on first contact.
 */

import HighLevel from "@gohighlevel/api-client";
import { Prisma, type ContactMapping } from "@prisma/client";
import { prisma } from "../prisma";

export interface TelegramSender {
  chatId: string;
  userId?: string;
  username?: string;
  firstName?: string;
  lastName?: string;
}

function ghlClient(accessToken: string): HighLevel {
  // The SDK's constructor requires clientId+clientSecret or a
  // privateIntegrationToken to pass its own validation, even though a
  // locationAccessToken alone is all that's actually used to build the
  // Authorization header (clientId/clientSecret only back its own OAuth
  // refresh flow, which we never trigger — our accessToken is already
  // refreshed by sessionStorage.get() before it reaches here).
  return new HighLevel({
    clientId: process.env.GHL_CLIENT_ID!,
    clientSecret: process.env.GHL_CLIENT_SECRET!,
    locationAccessToken: accessToken,
  });
}

export async function findOrCreateContactMapping(
  botId: string,
  locationId: string,
  accessToken: string,
  sender: TelegramSender,
  botLabel: string,
): Promise<ContactMapping> {
  const existing = await prisma.contactMapping.findUnique({
    where: { botId_telegramChatId: { botId, telegramChatId: sender.chatId } },
  });
  if (existing) return existing;

  const ghl = ghlClient(accessToken);
  const displayName =
    [sender.firstName, sender.lastName].filter(Boolean).join(" ") ||
    sender.username ||
    "Telegram User";

  const response = await ghl.contacts.createContact({
    locationId,
    firstName: sender.firstName,
    lastName: sender.lastName,
    // Includes the bot's own label so multiple bots messaging the same
    // Telegram contact stay distinguishable in the GHL conversation sidebar.
    // firstName/lastName and the locally-stored telegramName below keep the
    // sender's real name, unprefixed.
    name: `Sender: ${displayName} Bot:${botLabel}`,
    source: "Telegram",
  });

  const ghlContactId = response.contact?.id;
  if (!ghlContactId) {
    throw new Error(`GHL contact creation returned no id: ${JSON.stringify(response)}`);
  }

  try {
    return await prisma.contactMapping.create({
      data: {
        botId,
        locationId,
        telegramChatId: sender.chatId,
        telegramUserId: sender.userId,
        telegramUsername: sender.username,
        telegramName: displayName,
        ghlContactId,
      },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const winner = await prisma.contactMapping.findUnique({
        where: { botId_telegramChatId: { botId, telegramChatId: sender.chatId } },
      });
      if (winner) return winner;
    }
    throw e;
  }
}
