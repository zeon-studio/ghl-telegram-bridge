import { NextRequest, NextResponse } from "next/server";
import { isPhoneAccountEnabled } from "@/lib/telegram/phoneCredentials";
import { buildPhoneClient } from "@/lib/telegram/phoneClient";
import { createPendingLogin, armCodeResolver, armPasswordResolver, setPendingState } from "@/lib/telegram/pendingLogins";
import { getActiveSession, handleApiError } from "@/lib/api-utils";

export const runtime = "nodejs";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    if (!isPhoneAccountEnabled()) {
      return NextResponse.json({ error: "Phone Account is not configured" }, { status: 503 });
    }

    const body = (await request.json()) as { locationId?: string; phoneNumber?: string };
    const { locationId, phoneNumber } = body;
    if (!locationId || !phoneNumber) {
      return NextResponse.json({ error: "locationId and phoneNumber are required" }, { status: 400 });
    }

    const { errorResponse } = await getActiveSession(locationId);
    if (errorResponse) return errorResponse;

    const client = buildPhoneClient("");
    const loginToken = createPendingLogin(client, phoneNumber, locationId);

    client
      .start({
        phoneNumber: () => Promise.resolve(phoneNumber),
        phoneCode: () => new Promise<string>((resolve) => armCodeResolver(loginToken, resolve)),
        password: () => new Promise<string>((resolve) => armPasswordResolver(loginToken, resolve)),
        onError: (err: Error) => setPendingState(loginToken, "error", err.message),
      })
      .then(() => setPendingState(loginToken, "done"))
      .catch((err: Error) => setPendingState(loginToken, "error", err.message));

    return NextResponse.json({ success: true, loginToken });
  } catch (error) {
    return handleApiError(error, "Failed to start Phone Account login");
  }
}
