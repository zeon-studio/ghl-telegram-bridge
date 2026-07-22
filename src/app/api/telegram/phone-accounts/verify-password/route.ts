import { NextRequest, NextResponse } from "next/server";
import { getPendingLogin, submitPassword, waitForState, deletePendingLogin } from "@/lib/telegram/pendingLogins";
import { completeLogin } from "@/lib/telegram/phoneAccountManager";
import { handleApiError } from "@/lib/api-utils";

export const runtime = "nodejs";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = (await request.json()) as { loginToken?: string; password?: string };
    const { loginToken, password } = body;
    if (!loginToken || !password) {
      return NextResponse.json({ error: "loginToken and password are required" }, { status: 400 });
    }

    const pending = getPendingLogin(loginToken);
    if (!pending) {
      return NextResponse.json({ error: "Login session expired — start again" }, { status: 400 });
    }

    submitPassword(loginToken, password);
    const state = await waitForState(loginToken, "awaiting_password");

    if (state === "error") {
      const failed = getPendingLogin(loginToken);
      deletePendingLogin(loginToken);
      return NextResponse.json({ error: failed?.errorMessage ?? "Incorrect password" }, { status: 400 });
    }

    const account = await completeLogin(pending);
    deletePendingLogin(loginToken);
    return NextResponse.json({ success: true, account });
  } catch (error) {
    return handleApiError(error, "Failed to verify 2FA password");
  }
}
