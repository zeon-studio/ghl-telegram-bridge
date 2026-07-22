/**
 * app/api/auth/callback/route.ts
 * --------------------------------
 * Handles the OAuth 2.0 callback from GHL Marketplace.
 * Exchanges the authorization code for access + refresh tokens,
 * stores them in the in-memory session keyed by locationId,
 * then redirects to /dashboard.
 *
 * GET /api/auth/callback?code=...&locationId=...
 */

import { NextRequest, NextResponse } from "next/server";
import axios from "axios";
import { exchangeToken, getGhlClient, sessionStorage } from "@/lib/ghl/client";
import type { TokenSession } from "@/lib/ghl/client";

export const runtime = "nodejs";



export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const returnedState = searchParams.get("state");
  const locationId = searchParams.get("locationId"); // GHL passes this

  // ── Validate presence of code ────────────────────────────────────────────
  if (!code) {
    return NextResponse.json(
      { error: "Missing authorization code" },
      { status: 400 }
    );
  }

  // ── Optional: Validate state cookie ─────────────────────────────────────
  const savedState = request.cookies.get("ghl_oauth_state")?.value;
  if (savedState && returnedState && savedState !== returnedState) {
    return NextResponse.json(
      { error: "OAuth state mismatch — possible CSRF attack" },
      { status: 403 }
    );
  }

  try {
    // ── Step 1: Exchange code for tokens ──────────────────────────────────────────
    const tokenData = await exchangeToken(code);

    // ── Step 2: Resolve locationId ────────────────────────────────────────────────
    const resolvedLocationId =
      locationId ?? tokenData.locationId ?? "unknown";

    // ── Step 3: Fetch Location Details ───────────────────────────────────────────
    let locationDetails = {};
    if (resolvedLocationId !== "unknown") {
      try {
        const client = getGhlClient(tokenData.access_token);
        const locResp = await client.get(`/locations/${resolvedLocationId}`);
        const locData = locResp.data?.location;
        if (locData) {
          locationDetails = {
            locationName: locData.name,
            email: locData.email,
            phone: locData.phone,
            address: locData.address,
            city: locData.city,
            country: locData.country,
          };
        }
      } catch (err) {
        console.warn("[GHL Callback] Failed to fetch location details:", err);
      }
    }

    // ── Persist session ───────────────────────────────────────────────────
    const session: TokenSession = {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt: Date.now() + tokenData.expires_in * 1000,
      locationId: resolvedLocationId,
      userId: tokenData.userId,
      companyId: tokenData.companyId,
      ...locationDetails,
    };

    await sessionStorage.set(resolvedLocationId, session);

    // ── Clear state cookie & redirect to dashboard ────────────────────────
    // Use NEXT_PUBLIC_APP_URL rather than request.nextUrl.origin — behind a
    // dev tunnel (ngrok, tunnelmole, etc.) the local server sees the request
    // as arriving at localhost, not the public tunnel URL, and would redirect
    // the browser off the tunnel entirely.
    const dashboardUrl = new URL(
      `/dashboard?locationId=${resolvedLocationId}`,
      process.env.NEXT_PUBLIC_APP_URL ?? request.nextUrl.origin
    );

    const response = NextResponse.redirect(dashboardUrl);
    response.cookies.delete("ghl_oauth_state");
    return response;
  } catch (error: unknown) {
    if (axios.isAxiosError(error)) {
      console.error("[GHL Callback] Error:", error.response?.data ?? error.message);
      return NextResponse.json(
        {
          error: "Authentication failed",
          details: error.response?.data,
        },
        { status: error.response?.status || 500 }
      );
    }
    const err = error as Error;
    console.error("[GHL Callback] Error:", err.message);
    return NextResponse.json(
      { error: "Authentication failed", details: err.message },
      { status: 500 }
    );
  }
}
