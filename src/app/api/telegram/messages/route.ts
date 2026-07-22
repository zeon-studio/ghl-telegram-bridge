import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveSession, handleApiError } from "@/lib/api-utils";

export const runtime = "nodejs";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const locationId = request.nextUrl.searchParams.get("locationId");
    if (!locationId) {
      return NextResponse.json({ error: "locationId is required" }, { status: 400 });
    }

    const { errorResponse } = await getActiveSession(locationId);
    if (errorResponse) return errorResponse;

    const limit = Number(request.nextUrl.searchParams.get("limit") ?? "50");
    const offset = Number(request.nextUrl.searchParams.get("offset") ?? "0");

    const messages = await prisma.messageLog.findMany({
      where: { locationId },
      orderBy: { createdAt: "desc" },
      take: Math.min(limit, 100),
      skip: offset,
      include: { contactMapping: true },
    });

    return NextResponse.json({
      success: true,
      messages: messages.map((m) => ({
        id: m.id,
        direction: m.direction,
        contentType: m.contentType,
        textContent: m.textContent,
        mediaUrl: m.mediaUrl,
        status: m.status,
        errorMessage: m.errorMessage,
        createdAt: m.createdAt.toISOString(),
        contactName: m.contactMapping?.telegramName ?? null,
      })),
    });
  } catch (error) {
    return handleApiError(error, "Failed to fetch messages");
  }
}
