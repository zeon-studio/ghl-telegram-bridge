import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveSession, handleApiError } from "@/lib/api-utils";
import { startAccount, stopAccount, deleteAccount } from "@/lib/telegram/phoneAccountManager";

export const runtime = "nodejs";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const body = (await request.json()) as { isActive?: boolean; displayName?: string };

    const existing = await prisma.telegramPhoneAccount.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Phone account not found" }, { status: 404 });
    }

    const { errorResponse } = await getActiveSession(existing.locationId);
    if (errorResponse) return errorResponse;

    if (typeof body.isActive === "boolean" && body.isActive !== existing.isActive) {
      if (body.isActive) {
        await startAccount(id, existing.sessionString);
      } else {
        await stopAccount(id);
      }
    }

    const account = await prisma.telegramPhoneAccount.update({
      where: { id },
      data: {
        ...(typeof body.isActive === "boolean" ? { isActive: body.isActive } : {}),
        ...(typeof body.displayName === "string" ? { displayName: body.displayName || null } : {}),
      },
    });

    return NextResponse.json({
      success: true,
      account: { id: account.id, isActive: account.isActive, displayName: account.displayName },
    });
  } catch (error) {
    return handleApiError(error, "Failed to update phone account");
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const account = await prisma.telegramPhoneAccount.findUnique({ where: { id } });
    if (!account) {
      return NextResponse.json({ error: "Phone account not found" }, { status: 404 });
    }

    const { errorResponse } = await getActiveSession(account.locationId);
    if (errorResponse) return errorResponse;

    try {
      await deleteAccount(id);
    } catch (e) {
      console.error("[PhoneAccounts] Failed to log out Telegram session (continuing):", e);
    }

    await prisma.telegramPhoneAccount.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error, "Failed to delete phone account");
  }
}
