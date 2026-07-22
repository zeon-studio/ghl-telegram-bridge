# Telegram "Phone Account" Connection Type — Design

## Summary

Add a second Telegram connection type alongside the existing bot-token flow: **Phone Account**.
Instead of a bot, the agency logs in with a real Telegram phone number (MTProto user login via
teleproto) so their existing personal/business Telegram account syncs into GHL directly — no bot
required, and unlike the bot flow, this supports groups and channels in addition to DMs.

This is purely additive. The existing `TelegramBot` flow (schema, routes, UI, webhook) is
untouched; Phone Account is a parallel connector type that reuses the GHL-push logic through a
shared interface.

## Decisions

Resolved during brainstorming — these drive the design below:

- **Auth mechanism**: full MTProto user login (phone number + OTP + optional 2FA password) via
  [teleproto](https://docs.teleproto.dev/) (`teleproto` npm package — actively maintained
  GramJS-alternative; GramJS itself is no longer maintained), not a lighter/stubbed flow. Its API
  shape mirrors GramJS's (`TelegramClient`, `StringSession`, `NewMessage`, `addEventHandler`,
  `sendMessage`, `downloadMedia`, `invoke`/`Api.*`), so it's a drop-in for the architecture below.
  Note: it's a young package (single maintainer, first published recently per npm) — worth
  re-checking its health before this ships, same diligence as any new runtime dependency.
- **Hosting assumption**: app runs as a long-running Node process (`next start` on a persistent
  server, not serverless) — required because MTProto has no webhook equivalent; each connected
  account needs a standing connection to receive events.
- **Telegram app credentials**: one global `TELEGRAM_API_ID` / `TELEGRAM_API_HASH` pair (from
  my.telegram.org) via env vars — **optional at the process level**: the app must still start and
  the Bot flow must still work with these unset. If absent, the Phone Account feature disables
  itself (see "Graceful degradation" below) instead of the process failing to boot.
- **Session storage**: session strings stored in **plaintext**, matching the existing `botToken`
  pattern (explicit call — see Security Notes for the risk this accepts).
- **Data model**: separate parallel tables (`TelegramPhoneAccount`, `PhoneContactMapping`,
  `PhoneMessageLog`), not a unified/refactored schema — zero changes to the existing, already
  shipped and security-reviewed `TelegramBot` tables and code paths.
- **Chat sync scope**: all chats the account is part of (DMs, groups, channels) sync automatically
  — no per-chat opt-in UI in v1.
- **Dashboard entry point**: a second, separate "Add Phone Account" button next to the existing
  "Add Bot" button — no type-picker step.
- **Dashboard list display**: a separate `PhoneAccountList` section, not merged into `BotList`.
- **Connection management**: in-process singleton manager (module-level map of
  `accountId → teleproto client`), not a separate worker process/service.
- **Restart behavior**: on process boot, auto-reconnect every active phone account from its stored
  session — no manual reconnect step required after a deploy/crash/restart.
- **Pause/Delete semantics**: Pause disconnects the client but keeps the session (resumable).
  Delete disconnects, calls Telegram's own logout (`auth.LogOut`) to properly revoke the session,
  then removes the DB rows.
- **Missing credentials UI**: when `TELEGRAM_API_ID`/`TELEGRAM_API_HASH` aren't set, "Add Phone
  Account" stays visible but disabled (grayed out) with a tooltip explaining why, rather than being
  hidden outright — discoverable, tells the operator exactly what to configure.

## Architecture

```
Telegram account's chats ──message──▶ teleproto client (persistent connection)
                                              │  NewMessage event handler
                                              ▼
                              find/create PhoneContactMapping,
                              download media if present,
                              push via shared GHL-relay logic
                              (same code path the bot connector uses)
                                              │
                                              ▼
                                     GHL Inbox ("Telegram" channel,
                                     same Conversation Provider ID
                                     used by the bot flow)
                                              │
                              staff replies from Inbox
                                              │
                                              ▼
                    POST /api/ghl/conversation-provider/outbound
                                              │
                    look up ghlContactId in PhoneContactMapping
                    (falls back to bot's ContactMapping if not found)
                                              │
                                              ▼
                    resolve TelegramPhoneAccount, teleproto sendMessage/sendFile
                                              │
                                              ▼
                                  Telegram chat (DM, group, or channel)
```

In-process singleton `phoneAccountManager` holds one live teleproto `TelegramClient` per active
`TelegramPhoneAccount`, started on boot and mutated at runtime by connect/pause/resume/delete
actions. No queue, no Redis, no separate worker process. If `TELEGRAM_API_ID`/`TELEGRAM_API_HASH`
are unset, `boot()` no-ops entirely (see "Graceful degradation without Telegram API credentials").

## Data Model (Prisma)

Additive only — no changes to `TelegramBot`, `ContactMapping`, or `MessageLog`.

```prisma
model TelegramPhoneAccount {
  id              String   @id @default(cuid())
  locationId      String
  phoneNumber     String
  sessionString   String              // teleproto StringSession, plaintext — see Security Notes
  telegramUserId  String              // numeric id from the logged-in account
  telegramUsername String?            // "@" username if set
  displayName     String?             // friendly label set by the agency user
  isActive        Boolean  @default(true)
  needsAttention  Boolean  @default(false) // set true if session becomes invalid (revoked/banned)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  contacts        PhoneContactMapping[]
  messages        PhoneMessageLog[]

  @@index([locationId])
}

model PhoneContactMapping {
  id                String   @id @default(cuid())
  phoneAccountId    String
  locationId        String
  telegramChatId    String
  telegramChatType  String            // "user" | "group" | "channel"
  telegramChatName  String?
  ghlContactId      String
  ghlConversationId String?
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  phoneAccount      TelegramPhoneAccount @relation(fields: [phoneAccountId], references: [id], onDelete: Cascade)
  messages          PhoneMessageLog[]

  @@unique([phoneAccountId, telegramChatId])
  @@index([locationId])
}

model PhoneMessageLog {
  id                 String   @id @default(cuid())
  phoneAccountId     String
  locationId         String
  contactMappingId   String?
  direction          MessageDirection  // reuses the enum defined for the bot flow
  contentType        String
  textContent        String?
  mediaUrl           String?
  telegramMessageId  String?
  ghlMessageId       String?
  status             MessageStatus     // reuses the enum defined for the bot flow
  errorMessage       String?
  createdAt          DateTime @default(now())

  phoneAccount       TelegramPhoneAccount @relation(fields: [phoneAccountId], references: [id], onDelete: Cascade)
  contactMapping     PhoneContactMapping? @relation(fields: [contactMappingId], references: [id])

  @@index([locationId])
  @@index([phoneAccountId, createdAt])
}
```

**Shared relay interface** — a `TelegramConnector` TypeScript interface (`sendMessage`, `sendMedia`,
`downloadMedia`) implemented by both the existing bot client (`lib/telegram/client.ts`) and a new
teleproto-backed phone connector. The inbound-relay-to-GHL and outbound-relay-to-Telegram logic is
written once against this interface and reused by both connection types, rather than duplicated.

**Media direction handling**: same pattern as the bot flow — inbound media downloaded from
Telegram (via teleproto `downloadMedia`) and re-uploaded to the GHL Media Library for a stable URL;
outbound media already has a stable GHL CDN URL and is passed straight to teleproto's `sendFile`.

## Telegram Side (MTProto)

**`lib/telegram/phoneClient.ts`** — teleproto wrapper implementing the shared `TelegramConnector`
interface, plus login-specific methods used only by the auth routes below.

**`lib/telegram/phoneAccountManager.ts`** — in-process singleton (global map, hot-reload-safe like
the Prisma client singleton):

- `isEnabled()` — `true` only if both `TELEGRAM_API_ID` and `TELEGRAM_API_HASH` are set. Checked by
  `boot()`, every phone-account API route, and exposed to the dashboard (see "Graceful degradation"
  below).
- `boot()` — called once on server startup; if `isEnabled()` is false, logs a one-line notice and
  returns immediately (no crash, Bot flow unaffected). Otherwise loads all `isActive: true`
  `TelegramPhoneAccount` rows, starts a teleproto client per account from its stored session
  string, attaches the `NewMessage` event handler.
- `start(accountId)` / `stop(accountId)` — used by pause/resume/delete.
- Emits `needsAttention` on the DB row (and stops trying to reconnect) if a session comes back
  invalid — e.g. revoked from the user's Telegram app, or the number gets banned.

**Login flow** — teleproto's `client.start()` is interactive (wants callbacks for code/2FA), so the
API holds the in-flight client across requests via a short-lived **pending-login cache**
(in-memory `Map<loginToken, { client, phoneCodeHash }>`, ~10 min TTL). Every route below returns
`503 { error: "Phone Account is not configured" }` immediately if `phoneAccountManager.isEnabled()`
is false, before touching teleproto at all:

1. `POST /api/telegram/phone-accounts/start` — `{ phoneNumber }` → begins teleproto auth, Telegram
   sends the OTP to the account's Telegram app/SMS, returns `{ loginToken }`.
2. `POST /api/telegram/phone-accounts/verify-code` — `{ loginToken, code }` → completes login, or
   returns `{ needs2FA: true }` if the account has a cloud password enabled.
3. `POST /api/telegram/phone-accounts/verify-password` — `{ loginToken, password }` → completes
   login using the pending client from step 1.
4. On success (from either verify step): persist `TelegramPhoneAccount` with the resulting
   `StringSession`, register the client with `phoneAccountManager`, discard the pending-login
   entry.

**Other routes:**

- `PATCH /api/telegram/phone-accounts/[id]` — toggle `isActive` (pause/resume via the manager).
- `DELETE /api/telegram/phone-accounts/[id]` — `phoneAccountManager.stop()`, teleproto
  `auth.LogOut`, delete DB rows (cascades to mappings/logs).
- `GET /api/telegram/phone-accounts/config` — `{ enabled: boolean }`, used by the dashboard to
  render "Add Phone Account" enabled/disabled without duplicating the env-var check client-side.

**Inbound relay** — teleproto `NewMessage` handler per client:

1. Resolve chat type (user/group/channel) and id from the event.
2. Find/create `PhoneContactMapping` by `(phoneAccountId, telegramChatId)` — same
   create-GHL-contact-on-first-message behavior as the bot flow, unique constraint makes it
   race-safe.
3. Download media if present, push message via the shared relay logic to GHL's Conversations API
   (same `GHL_CONVERSATION_PROVIDER_ID` the bot flow uses).
4. Write a `PhoneMessageLog` row (`SENT` or `FAILED`).

**Outbound relay** — `POST /api/ghl/conversation-provider/outbound` (existing route, extended):
on a reply, look up `ghlContactId` first against `ContactMapping` (bot), then
`PhoneContactMapping` (phone) to determine which connector owns the conversation, then dispatch
through that connector's `sendMessage`/`sendMedia`.

## Dashboard UI

- `dashboard/page.tsx` — add an "Add Phone Account" button next to the existing "Add Bot" button.
  On mount, fetches `GET /api/telegram/phone-accounts/config`; if `enabled: false`, the button
  renders disabled with a tooltip ("Telegram API credentials not configured — set
  TELEGRAM_API_ID/TELEGRAM_API_HASH") instead of being hidden.
- **`AddPhoneAccountDialog.tsx`** — stepped dialog (local step state, no new dependency):
  1. Phone step — phone number input, "Send Code".
  2. Code step — OTP input, "Verify" (with a way back to fix the phone number).
  3. 2FA step (conditional) — cloud password input, shown only if step 2 signals `needs2FA`.
  4. Success step — shows the synced account's username/display name, optional label field,
     "Done" closes the dialog and refreshes the list.
  Inline errors for invalid phone format, wrong code, wrong password, and Telegram flood-wait.
- **`PhoneAccountList.tsx`** — separate section from `BotList`, cards showing phone number,
  display name/username, status (connected / paused / needs attention), pause toggle, delete —
  visually consistent with `BotList`'s card style.
- `dashboard/types.ts` — add a `TelegramPhoneAccount` client type.

No changes to `AddBotDialog.tsx` or `BotList.tsx`.

## Security Notes

Session strings are stored in **plaintext**, matching the existing `botToken` pattern (explicit
decision, not an oversight). This is a materially higher-value secret than a bot token: a DB leak
means full account takeover — read all chats, send/impersonate messages, add/remove group and
channel members — not just control of a bot. Recorded once here per the decision not to
re-litigate it; worth revisiting (e.g. `SESSION_ENCRYPTION_KEY` + AES at rest) if this ever handles
real customer accounts at meaningful scale.

## Graceful Degradation Without Telegram API Credentials

`TELEGRAM_API_ID`/`TELEGRAM_API_HASH` are **optional** at the process level — this is a hard
requirement, not a nice-to-have, since the app must keep running for the existing Bot flow
regardless of whether Phone Account is configured:

- **Startup**: no fail-fast check for these two vars. `phoneAccountManager.boot()` checks
  `isEnabled()` first and simply skips all phone-account startup work (no clients started, no
  crash, one log line noting the feature is disabled) if either is missing.
- **API**: every `/api/telegram/phone-accounts/*` route checks `isEnabled()` first and returns
  `503` before importing/touching teleproto, so a missing config can never surface as an unhandled
  exception.
- **UI**: `GET /api/telegram/phone-accounts/config` tells the dashboard whether to render "Add
  Phone Account" enabled or disabled-with-tooltip (per the Decisions section above).
- **Already-connected accounts**: if credentials are removed after accounts exist (e.g. env var
  deleted in a later deploy), those rows are simply not started by `boot()` — they stay in the DB,
  `isActive: true`, disconnected, until credentials are restored and the process restarts. This is
  a distinct state from `needsAttention` (which means the *session itself* is invalid); a config
  change is an operator action, not an account-health problem, so no `needsAttention` badge fires
  for it.

## Edge Cases

- **Session invalidated** (revoked from the user's own Telegram app, or account banned) — manager
  catches the auth error, sets `needsAttention: true` and `isActive: false`, stops retrying.
  Dashboard shows an "attention needed" badge; user must delete and reconnect.
- **Flood-wait during login or send** — surfaced as an inline "try again in Ns" error rather than
  a silent retry loop.
- **Duplicate/out-of-order events** — teleproto delivers each update once per connection, but on
  reconnect after a drop it's possible to see an update again; dedupe via `telegramMessageId` +
  `phoneAccountId` the same way the bot flow dedupes webhook redeliveries.
- **Server restart mid-login** — the pending-login cache is in-memory only; an in-flight login
  (phone submitted, code not yet entered) is lost on restart. Acceptable: user just restarts the
  "Add Phone Account" flow from step 1.
- **Expired/unrecoverable GHL session** — same handling as the bot flow: log `FAILED` with
  `"GHL session expired — reconnect this location"`, surfaced via the existing dashboard banner.
- **App uninstalled from a location** — same as the bot flow: out of scope for v1, no cleanup
  webhook; a churned location's phone accounts keep running and failing gracefully rather than
  being torn down automatically.

## Config

New **optional** env vars: `TELEGRAM_API_ID`, `TELEGRAM_API_HASH` — the app must start and the Bot
flow must work fully without them (see "Graceful Degradation" above). Reuses the existing
`GHL_CONVERSATION_PROVIDER_ID` — phone-account messages show in the same "Telegram" Inbox channel
as bot messages; the two connection types are distinguished internally by which mapping table owns
the contact, not by a different provider.

## Testing Approach

Matches the existing project convention — no test framework in this repo (no Jest/Vitest), not
introducing one speculatively. Verification is `tsc --noEmit` + `eslint`, then a manual end-to-end
walkthrough: connect a real personal Telegram account through the login wizard, send/receive a
message in a DM, a group, and a channel, confirm all three land in the GHL Inbox, reply from the
Inbox and confirm delivery back to Telegram, then verify pause → resume and a process restart both
correctly reconnect the account. Also verify the degraded path: start the app with
`TELEGRAM_API_ID`/`TELEGRAM_API_HASH` unset, confirm it boots cleanly, the Bot flow still works
end-to-end, and "Add Phone Account" renders disabled with the expected tooltip.
