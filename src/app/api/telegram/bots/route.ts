import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { getMe, setWebhook } from "@/lib/telegram/client";
import { getActiveSession, handleApiError } from "@/lib/api-utils";
import { encryptSecret } from "@/lib/crypto";

export const runtime = "nodejs";

function serializeBot(bot: {
  id: string;
  botUsername: string;
  displayName: string | null;
  isActive: boolean;
  createdAt: Date;
}) {
  return {
    id: bot.id,
    botUsername: bot.botUsername,
    displayName: bot.displayName,
    isActive: bot.isActive,
    createdAt: bot.createdAt.toISOString(),
  };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const locationId = request.nextUrl.searchParams.get("locationId");
    if (!locationId) {
      return NextResponse.json({ error: "locationId is required" }, { status: 400 });
    }

    const { errorResponse } = await getActiveSession(locationId);
    if (errorResponse) return errorResponse;

    const bots = await prisma.telegramBot.findMany({
      where: { locationId },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json({ success: true, bots: bots.map(serializeBot) });
  } catch (error) {
    return handleApiError(error, "Failed to fetch bots");
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = (await request.json()) as {
      locationId?: string;
      botToken?: string;
      displayName?: string;
    };
    const { locationId, botToken, displayName } = body;

    if (!locationId || !botToken) {
      return NextResponse.json(
        { error: "locationId and botToken are required" },
        { status: 400 },
      );
    }

    const { errorResponse } = await getActiveSession(locationId);
    if (errorResponse) return errorResponse;

    let me;
    try {
      me = await getMe(botToken);
    } catch {
      return NextResponse.json(
        { error: "Invalid bot token — Telegram rejected it" },
        { status: 400 },
      );
    }

    const webhookSecret = crypto.randomBytes(24).toString("hex");
    const webhookUrl = `${process.env.NEXT_PUBLIC_APP_URL}/api/telegram/webhook/${webhookSecret}`;
    await setWebhook(botToken, webhookUrl, webhookSecret);

    const bot = await prisma.telegramBot.create({
      data: {
        locationId,
        // Encrypted at rest — a bot token is enough to read and send every
        // message the bot can see. See lib/crypto.ts.
        botToken: encryptSecret(botToken),
        telegramBotId: String(me.id),
        botUsername: me.username ?? me.first_name,
        displayName: displayName || null,
        webhookSecret,
      },
    });

    return NextResponse.json({ success: true, bot: serializeBot(bot) });
  } catch (error) {
    return handleApiError(error, "Failed to add bot");
  }
}
