import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveSession, handleApiError } from "@/lib/api-utils";

export const runtime = "nodejs";

function serializeAccount(account: {
  id: string;
  phoneNumber: string;
  telegramUsername: string | null;
  displayName: string | null;
  isActive: boolean;
  needsAttention: boolean;
  createdAt: Date;
}) {
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

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const locationId = request.nextUrl.searchParams.get("locationId");
    if (!locationId) {
      return NextResponse.json({ error: "locationId is required" }, { status: 400 });
    }

    const { errorResponse } = await getActiveSession(locationId);
    if (errorResponse) return errorResponse;

    const accounts = await prisma.telegramPhoneAccount.findMany({
      where: { locationId },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json({ success: true, accounts: accounts.map(serializeAccount) });
  } catch (error) {
    return handleApiError(error, "Failed to fetch phone accounts");
  }
}
