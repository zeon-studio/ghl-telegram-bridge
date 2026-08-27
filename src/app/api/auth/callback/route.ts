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

import type { TokenSession } from "@/lib/ghl/client";
import {
  agencySessionStorage,
  exchangeAgencyTokenForLocationToken,
  exchangeToken,
  getAgencyInstalledLocationIds,
  getGhlClient,
  sessionStorage,
} from "@/lib/ghl/client";
import axios from "axios";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const returnedState = searchParams.get("state");
  const locationId = searchParams.get("locationId"); // GHL passes this for location-scoped auth

  // ── Validate presence of code ────────────────────────────────────────────
  if (!code) {
    return NextResponse.json(
      { error: "Missing authorization code" },
      { status: 400 },
    );
  }

  // ── Optional: Validate state cookie ─────────────────────────────────────
  const savedState = request.cookies.get("ghl_oauth_state")?.value;
  if (savedState && returnedState && savedState !== returnedState) {
    return NextResponse.json(
      { error: "OAuth state mismatch — possible CSRF attack" },
      { status: 403 },
    );
  }

  try {
    // ── Step 1: Exchange code for tokens ──────────────────────────────────────────
    const tokenData = await exchangeToken(code);

    // ── Step 2: Handle Agency vs Location Installation ────────────────────────────
    const usesAgencyToken = Boolean(
      tokenData.companyId && !tokenData.locationId,
    );

    if (usesAgencyToken && tokenData.companyId) {
      // 1. Save Agency Session
      await agencySessionStorage.set(tokenData.companyId, {
        companyId: tokenData.companyId,
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        expiresAt: Date.now() + tokenData.expires_in * 1000,
        userId: tokenData.userId,
      });

      // 2. Discover installed/accessible sub-accounts
      const oauthLocationId =
        locationId ?? tokenData.locationId ?? tokenData.approvedLocations?.[0];
      const installedLocationIds = await getAgencyInstalledLocationIds(
        tokenData.access_token,
        tokenData.companyId,
      );

      const sessionLocationIds = [
        ...new Set(
          [...installedLocationIds, oauthLocationId].filter(
            (candidate): candidate is string => Boolean(candidate),
          ),
        ),
      ];

      // 3. Persist location sessions for any discovered locations
      if (sessionLocationIds.length > 0) {
        await Promise.all(
          sessionLocationIds.map(async (sessionLocationId) => {
            try {
              const locationToken = await exchangeAgencyTokenForLocationToken(
                tokenData.access_token,
                tokenData.companyId!,
                sessionLocationId,
              );

              let locationDetails = {};
              try {
                const client = getGhlClient(locationToken.accessToken);
                const locResp = await client.get(
                  `/locations/${sessionLocationId}`,
                );
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
                console.warn(
                  `[GHL Callback] Failed to fetch location details for ${sessionLocationId}:`,
                  err,
                );
              }

              const session: TokenSession = {
                accessToken: locationToken.accessToken,
                refreshToken: tokenData.refresh_token,
                expiresAt:
                  Date.now() + locationToken.expiresIn * 1000,
                locationId: sessionLocationId,
                userId: tokenData.userId,
                companyId: tokenData.companyId,
                usesAgencyToken: true,
                ...locationDetails,
              };

              await sessionStorage.set(sessionLocationId, session);
            } catch (err) {
              console.warn(
                `[GHL Callback] Could not initialize session for location ${sessionLocationId}:`,
                err,
              );
            }
          }),
        );
      }

      // 4. Redirect: to resolved location if available, otherwise to agency dashboard
      const targetUrl = sessionLocationIds[0]
        ? `/dashboard?locationId=${encodeURIComponent(sessionLocationIds[0])}`
        : `/dashboard?companyId=${encodeURIComponent(tokenData.companyId)}&installed=agency`;

      const redirectUrl = new URL(
        targetUrl,
        process.env.NEXT_PUBLIC_APP_URL ?? request.nextUrl.origin,
      );

      const response = NextResponse.redirect(redirectUrl);
      response.cookies.delete("ghl_oauth_state");
      return response;
    }

    // ── Direct Location Installation ──────────────────────────────────────────────
    const resolvedLocationId =
      locationId ?? tokenData.locationId ?? tokenData.approvedLocations?.[0];

    if (!resolvedLocationId) {
      return NextResponse.json(
        {
          error: "No sub-account was authorized for this installation",
          details: "Please install or authorize the app from a sub-account.",
        },
        { status: 400 },
      );
    }

    let locationDetails = {};
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

    const session: TokenSession = {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt: Date.now() + tokenData.expires_in * 1000,
      locationId: resolvedLocationId,
      userId: tokenData.userId,
      companyId: tokenData.companyId,
      usesAgencyToken: false,
      ...locationDetails,
    };

    await sessionStorage.set(resolvedLocationId, session);

    const dashboardUrl = new URL(
      `/dashboard?locationId=${encodeURIComponent(resolvedLocationId)}`,
      process.env.NEXT_PUBLIC_APP_URL ?? request.nextUrl.origin,
    );

    const response = NextResponse.redirect(dashboardUrl);
    response.cookies.delete("ghl_oauth_state");
    return response;
  } catch (error: unknown) {
    if (axios.isAxiosError(error)) {
      console.error(
        "[GHL Callback] Error:",
        error.response?.data ?? error.message,
      );
      return NextResponse.json(
        {
          error: "Authentication failed",
          details: error.response?.data,
        },
        { status: error.response?.status || 500 },
      );
    }
    const err = error as Error;
    console.error("[GHL Callback] Error:", err.message);
    return NextResponse.json(
      { error: "Authentication failed", details: err.message },
      { status: 500 },
    );
  }
}
