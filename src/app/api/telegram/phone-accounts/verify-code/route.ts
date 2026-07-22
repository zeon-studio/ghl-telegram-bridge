import { NextRequest, NextResponse } from "next/server";
import { getPendingLogin, submitCode, waitForState, deletePendingLogin } from "@/lib/telegram/pendingLogins";
import { completeLogin } from "@/lib/telegram/phoneAccountManager";
import { handleApiError } from "@/lib/api-utils";

export const runtime = "nodejs";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = (await request.json()) as { loginToken?: string; code?: string };
    const { loginToken, code } = body;
    if (!loginToken || !code) {
      return NextResponse.json({ error: "loginToken and code are required" }, { status: 400 });
    }

    const pending = getPendingLogin(loginToken);
    if (!pending) {
      return NextResponse.json({ error: "Login session expired — start again" }, { status: 400 });
    }

    submitCode(loginToken, code);
    const state = await waitForState(loginToken, "awaiting_code");

    if (state === "error") {
      const failed = getPendingLogin(loginToken);
      deletePendingLogin(loginToken);
      return NextResponse.json({ error: failed?.errorMessage ?? "Invalid code" }, { status: 400 });
    }
    if (state === "awaiting_password") {
      return NextResponse.json({ success: true, needs2FA: true });
    }

    const account = await completeLogin(pending);
    deletePendingLogin(loginToken);
    return NextResponse.json({ success: true, needs2FA: false, account });
  } catch (error) {
    return handleApiError(error, "Failed to verify code");
  }
}
