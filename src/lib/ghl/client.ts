/**
 * lib/ghl/client.ts
 * -----------------
 * Singleton GHL SDK client with a simple in-memory session storage.
 * In production, replace InMemorySessionStorage with a Redis/DB-backed
 * implementation to survive server restarts.
 */

import HighLevel from "@gohighlevel/api-client";
import axios, { AxiosInstance } from "axios";

export const API_BASE = "https://services.leadconnectorhq.com";

export interface GHLSSOPayload {
  locationId: string;
  userId: string;
  companyId?: string;
  email?: string;
  role?: string;
  type?: string;
}

/**
 * Creates an Axios instance pre-configured for the GoHighLevel V2 API.
 * Automatically attaches the Bearer token, Version, and Accept headers.
 */
export function getGhlClient(accessToken: string): AxiosInstance {
  return axios.create({
    baseURL: API_BASE,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Version: "2021-07-28",
      Accept: "application/json",
    },
  });
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TokenSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // Unix ms timestamp
  locationId: string;
  userId?: string;
  companyId?: string;
  locationName?: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  country?: string;
}
export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  locationId?: string;
  userId?: string;
  companyId?: string;
  scope?: string;
}

// ─── Prisma Session Storage ──────────────────────────────────────────────────

import { prisma } from "../prisma";

const GHL_API_BASE = API_BASE;

async function refreshAccessToken(
  session: TokenSession,
): Promise<TokenSession> {
  if (!process.env.GHL_CLIENT_ID || !process.env.GHL_CLIENT_SECRET) {
    throw new Error("Missing GHL credentials for token refresh");
  }

  const tokenResp = await axios.post(
    `${GHL_API_BASE}/oauth/token`,
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: session.refreshToken,
      client_id: process.env.GHL_CLIENT_ID,
      client_secret: process.env.GHL_CLIENT_SECRET,
    }),
    {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    },
  );

  const data = tokenResp.data;

  const newSession: TokenSession = {
    ...session,
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };

  // Save the new session to Supabase
  await sessionStorage.set(session.locationId, newSession);

  return newSession;
}

export const sessionStorage = {
  async set(locationId: string, session: TokenSession): Promise<void> {
    const data = {
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      expiresAt: BigInt(session.expiresAt),
      userId: session.userId,
      companyId: session.companyId,
      locationName: session.locationName,
      email: session.email,
      phone: session.phone,
      address: session.address,
      city: session.city,
      country: session.country,
    };

    try {
      await prisma.session.upsert({
        where: { locationId },
        create: { locationId, ...data },
        update: data,
      });
    } catch (e) {
      console.error(`[Session] Failed to save session for ${locationId}:`, e);
    }
  },

  async get(locationId: string): Promise<TokenSession | undefined> {
    let row;
    try {
      row = await prisma.session.findUnique({ where: { locationId } });
    } catch (e) {
      console.error(`[Session] Failed to fetch session for ${locationId}:`, e);
      return undefined;
    }

    if (!row) return undefined;

    let session: TokenSession = {
      accessToken: row.accessToken,
      refreshToken: row.refreshToken,
      expiresAt: Number(row.expiresAt),
      locationId: row.locationId,
      userId: row.userId ?? undefined,
      companyId: row.companyId ?? undefined,
      locationName: row.locationName ?? undefined,
      email: row.email ?? undefined,
      phone: row.phone ?? undefined,
      address: row.address ?? undefined,
      city: row.city ?? undefined,
      country: row.country ?? undefined,
    };

    if (Date.now() + 5 * 60 * 1000 >= session.expiresAt) {
      try {
        session = await refreshAccessToken(session);
      } catch (err) {
        console.error(`[Session] Failed to refresh token for location ${locationId}:`, err);
        return undefined;
      }
    }

    return session;
  },

  async delete(locationId: string): Promise<void> {
    try {
      await prisma.session.delete({ where: { locationId } });
    } catch (e) {
      console.error(`[Session] Failed to delete session for ${locationId}:`, e);
    }
  },

  async keys(): Promise<string[]> {
    try {
      const rows = await prisma.session.findMany({ select: { locationId: true } });
      return rows.map((r) => r.locationId);
    } catch (e) {
      console.error("[Session] Failed to list session keys:", e);
      return [];
    }
  },
};

// ─── SDK Client Singleton ─────────────────────────────────────────────────────

let _client: InstanceType<typeof HighLevel> | null = null;

export function getGHLClient(): InstanceType<typeof HighLevel> {
  if (_client) return _client;

  if (!process.env.GHL_CLIENT_ID) throw new Error("Missing GHL_CLIENT_ID");
  if (!process.env.GHL_CLIENT_SECRET)
    throw new Error("Missing GHL_CLIENT_SECRET");

  _client = new HighLevel({
    clientId: process.env.GHL_CLIENT_ID,
    clientSecret: process.env.GHL_CLIENT_SECRET,
  });

  return _client;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Returns the OAuth authorization URL to redirect users to */
export function buildAuthorizationUrl(state?: string): string {
  const base =
    process.env.GHL_BASE_URL ?? "https://marketplace.gohighlevel.com";
  const redirectUri =
    process.env.GHL_REDIRECT_URI ??
    `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/callback`;
  const clientId = process.env.GHL_CLIENT_ID!;

  const scopes = [
    "conversations.readonly",
    "conversations.write",
    "conversations/message.readonly",
    "conversations/message.write",
    "contacts.readonly",
    "contacts.write",
    "locations.readonly",
    "medias.readonly",
    "medias.write",
  ].join(" ");

  const params = new URLSearchParams({
    response_type: "code",
    redirect_uri: redirectUri,
    client_id: clientId,
    scope: scopes,
    ...(process.env.GHL_APP_VERSION_ID
      ? { version_id: process.env.GHL_APP_VERSION_ID }
      : {}),
    ...(state ? { state } : {}),
  });

  return `${base}/oauth/chooselocation?${params.toString()}`;
}

/**
 * Exchanges an authorization code for access and refresh tokens.
 */
export async function exchangeToken(code: string): Promise<TokenResponse> {
  const redirectUri =
    process.env.GHL_REDIRECT_URI ??
    `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/callback`;

  const resp = await axios.post(
    `${API_BASE}/oauth/token`,
    new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: process.env.GHL_CLIENT_ID!,
      client_secret: process.env.GHL_CLIENT_SECRET!,
    }),
    {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    },
  );

  return resp.data;
}
