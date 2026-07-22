/**
 * app/api/auth/ghl/route.ts
 * --------------------------
 * Initiates the GHL OAuth 2.0 Authorization Code flow.
 * Redirects the user to the GHL Marketplace authorization page.
 *
 * GET /api/auth/ghl
 */

import { NextResponse } from "next/server";
import { buildAuthorizationUrl } from "@/lib/ghl/client";

export const runtime = "nodejs";

export async function GET(): Promise<NextResponse> {
  try {
    // Generate a random state token for CSRF protection
    const state = crypto.randomUUID();

    // In production, persist `state` in a short-lived store (cookie / Redis)
    // and validate it in the callback before exchanging the code.
    const authUrl = buildAuthorizationUrl(state);

    const response = NextResponse.redirect(authUrl);

    // Store state in a short-lived cookie for validation in callback
    response.cookies.set("ghl_oauth_state", state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 10, // 10 minutes
      path: "/",
    });

    return response;
  } catch (error) {
    console.error("[GHL Auth] Failed to build authorization URL:", error);
    return NextResponse.json(
      { error: "Failed to initiate OAuth flow" },
      { status: 500 }
    );
  }
}
