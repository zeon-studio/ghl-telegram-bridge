import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { deleteWebhook } from "@/lib/telegram/client";
import { getActiveSession, handleApiError } from "@/lib/api-utils";

export const runtime = "nodejs";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const { isActive } = (await request.json()) as { isActive?: boolean };

    if (typeof isActive !== "boolean") {
      return NextResponse.json({ error: "isActive must be a boolean" }, { status: 400 });
    }

    const existing = await prisma.telegramBot.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Bot not found" }, { status: 404 });
    }

    const { errorResponse } = await getActiveSession(existing.locationId);
    if (errorResponse) return errorResponse;

    const bot = await prisma.telegramBot.update({ where: { id }, data: { isActive } });
    return NextResponse.json({ success: true, bot: { id: bot.id, isActive: bot.isActive } });
  } catch (error) {
    return handleApiError(error, "Failed to update bot");
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const bot = await prisma.telegramBot.findUnique({ where: { id } });
    if (!bot) {
      return NextResponse.json({ error: "Bot not found" }, { status: 404 });
    }

    const { errorResponse } = await getActiveSession(bot.locationId);
    if (errorResponse) return errorResponse;

    try {
      await deleteWebhook(bot.botToken);
    } catch (e) {
      console.error("[Bots] Failed to delete Telegram webhook (continuing):", e);
    }

    await prisma.telegramBot.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error, "Failed to delete bot");
  }
}
