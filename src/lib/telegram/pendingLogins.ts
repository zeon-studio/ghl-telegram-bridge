// src/lib/telegram/pendingLogins.ts
/**
 * Holds in-flight Phone Account login attempts across the 3 HTTP steps
 * (phone -> code -> optional 2FA password). teleproto's `client.start()`
 * is a single interactive call whose phoneCode/password arguments are
 * prompt callbacks; each callback here returns a Promise that this module
 * resolves once the matching HTTP request arrives, so one `start()` call
 * spans multiple requests instead of blocking on stdin like the docs'
 * `rl.question()` example.
 *
 * In-memory only, single Node process — matches the in-process singleton
 * connection-manager decision. An in-flight login is lost on process
 * restart; the user just restarts the "Add Phone Account" flow from the
 * phone-number step (see design doc's "Server restart mid-login" edge case).
 *
 * A wrong code or password fails the whole in-flight `client.start()` call
 * rather than re-prompting — teleproto's retry-on-invalid-code behavior
 * isn't documented, so this doesn't depend on it. The user restarts from
 * the phone-number step, same as the restart-mid-login case above.
 */

import crypto from "crypto";
import type { TelegramClient } from "teleproto";

export type PendingLoginState = "awaiting_code" | "awaiting_password" | "done" | "error";

interface PendingLogin {
  client: TelegramClient;
  phoneNumber: string;
  locationId: string;
  state: PendingLoginState;
  errorMessage?: string;
  resolveCode?: (code: string) => void;
  resolvePassword?: (password: string) => void;
  createdAt: number;
}

export type PendingLoginRecord = Pick<PendingLogin, "client" | "phoneNumber" | "locationId">;

const PENDING_TTL_MS = 10 * 60 * 1000;
const pending = new Map<string, PendingLogin>();

function cleanupExpired(): void {
  const now = Date.now();
  for (const [token, entry] of pending) {
    if (now - entry.createdAt > PENDING_TTL_MS) {
      entry.client.disconnect().catch(() => {});
      pending.delete(token);
    }
  }
}

export function createPendingLogin(
  client: TelegramClient,
  phoneNumber: string,
  locationId: string,
): string {
  cleanupExpired();
  const token = crypto.randomBytes(24).toString("hex");
  pending.set(token, {
    client,
    phoneNumber,
    locationId,
    state: "awaiting_code",
    createdAt: Date.now(),
  });
  return token;
}

export function getPendingLogin(token: string): PendingLogin | undefined {
  return pending.get(token);
}

export function armCodeResolver(token: string, resolve: (code: string) => void): void {
  const entry = pending.get(token);
  if (!entry) return;
  entry.resolveCode = resolve;
  entry.state = "awaiting_code";
}

export function armPasswordResolver(token: string, resolve: (password: string) => void): void {
  const entry = pending.get(token);
  if (!entry) return;
  entry.resolvePassword = resolve;
  entry.state = "awaiting_password";
}

export function submitCode(token: string, code: string): void {
  const entry = pending.get(token);
  if (!entry?.resolveCode) throw new Error("Not awaiting a code for this login");
  entry.resolveCode(code);
}

export function submitPassword(token: string, password: string): void {
  const entry = pending.get(token);
  if (!entry?.resolvePassword) throw new Error("Not awaiting a password for this login");
  entry.resolvePassword(password);
}

export function setPendingState(
  token: string,
  state: PendingLoginState,
  errorMessage?: string,
): void {
  const entry = pending.get(token);
  if (!entry) return;
  entry.state = state;
  entry.errorMessage = errorMessage;
}

export function deletePendingLogin(token: string): void {
  pending.delete(token);
}

/** Polls (200ms) until the pending login's state moves past `awaitingState`. */
export async function waitForState(
  token: string,
  awaitingState: PendingLoginState,
  timeoutMs = 15000,
): Promise<PendingLoginState> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const entry = pending.get(token);
    if (!entry) throw new Error("Login session expired — start again");
    if (entry.state !== awaitingState) return entry.state;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("Timed out waiting for Telegram — try again");
}
