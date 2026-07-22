import { NextResponse } from "next/server";
import { isPhoneAccountEnabled } from "@/lib/telegram/phoneCredentials";

export const runtime = "nodejs";

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ enabled: isPhoneAccountEnabled() });
}
