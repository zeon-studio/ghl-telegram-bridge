# GHL Telegram Two-Way Inbox Integration — Design

## Summary

Repurpose the existing GHL marketplace app (currently an `llms.txt` generator) into a Telegram
integration: agencies connect one or more Telegram bots per GHL location, and messages between
those bots and their Telegram users flow both ways into the location's native GHL Inbox as a
distinct "Telegram" channel.

Keep: GHL OAuth flow, session/token-refresh logic, the Custom Page dashboard shell, shadcn/ui setup.
Replace: session storage (raw `pg` → Prisma), all `llms.txt`-specific lib/routes/components,
`supabase_schema.sql`.

## Decisions

These were resolved during brainstorming and drive the design below:

- **Bot scoping**: bots are configured per GHL location (sub-account), not shared across locations.
- **Contact creation**: new Telegram senders auto-create a GHL contact immediately (name only,
  keyed by Telegram user id — no manual linking, no contact-share prompt).
- **Message content**: text **and** media (photos, documents, voice) sync both directions in v1.
- **Two-way delivery mechanism**: register the app as a GHL **Conversation Provider** (not notes,
  not a custom "reply" button) so replies work natively from the Inbox.
- **Token storage**: bot tokens stored in **plaintext** in Postgres (explicit call — no encryption
  at rest for v1).
- **Message logging**: keep a local `MessageLog` table for debugging/audit/retry, even though GHL
  remains the source of truth for conversation content.
- **Relay execution model**: synchronous handling inside webhook routes, no queue/worker
  infrastructure. Failures are logged and retried manually via a dashboard button, not
  automatically.
- **Chat scope**: v1 supports private 1:1 Telegram chats only, not group chats.
- **App-uninstall handling**: explicitly out of scope for v1 (see Edge Cases).

## Architecture

```
Telegram user ──sends msg──▶ Telegram Bot API ──webhook──▶ /api/telegram/webhook/[secret]
                                                                     │
                                                     find/create GHL contact,
                                                     push message via GHL
                                                     Conversations API
                                                     (tagged with our
                                                     Conversation Provider ID)
                                                                     │
                                                                     ▼
                                                          GHL Inbox (shows as
                                                          "Telegram" channel)
                                                                     │
                                              staff replies from Inbox
                                                                     │
                                                                     ▼
                                            GHL calls /api/ghl/conversation-provider/outbound
                                                                     │
                                                     look up bot + telegram chat id,
                                                     call Telegram sendMessage/sendPhoto
                                                                     │
                                                                     ▼
                                                            Telegram user's chat
```

Stateless Next.js API routes throughout — no worker process, no queue, no Redis. Postgres (via
Prisma) is the only state besides GHL and Telegram themselves.

## Data Model (Prisma)

Replaces `supabase_schema.sql` and the raw-SQL queries in `lib/ghl/client.ts`'s `sessionStorage`.

```prisma
model Session {
  locationId    String   @id
  accessToken   String
  refreshToken  String
  expiresAt     BigInt
  userId        String?
  companyId     String?
  locationName  String?
  email         String?
  phone         String?
  address       String?
  city          String?
  country       String?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
}

model TelegramBot {
  id            String   @id @default(cuid())
  locationId    String
  botToken      String              // plaintext, per decision above
  telegramBotId String              // numeric id from getMe
  botUsername   String              // "@" username from getMe
  displayName   String?             // friendly label set by the agency user
  webhookSecret String   @unique    // used in webhook path + validated via Telegram's secret header
  isActive      Boolean  @default(true)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  contacts      ContactMapping[]
  messages      MessageLog[]

  @@index([locationId])
}

model ContactMapping {
  id                String   @id @default(cuid())
  botId             String
  locationId        String
  telegramChatId    String
  telegramUserId    String?
  telegramUsername  String?
  telegramName      String?          // first+last, used as the contact's display name
  ghlContactId      String
  ghlConversationId String?         // cached once GHL gives us one
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  bot               TelegramBot @relation(fields: [botId], references: [id], onDelete: Cascade)
  messages          MessageLog[]

  @@unique([botId, telegramChatId])
  @@index([locationId])
}

enum MessageDirection {
  INBOUND   // Telegram -> GHL
  OUTBOUND  // GHL -> Telegram
}

enum MessageStatus {
  SENT
  FAILED
}

model MessageLog {
  id                 String   @id @default(cuid())
  botId              String
  locationId         String
  contactMappingId   String?
  direction          MessageDirection
  contentType        String            // "text" | "photo" | "document" | "voice" | "video"
  textContent        String?
  mediaUrl           String?           // stable, hosted URL (GHL media or Telegram CDN)
  telegramMessageId  String?
  ghlMessageId       String?
  status             MessageStatus
  errorMessage       String?
  createdAt          DateTime @default(now())

  bot                TelegramBot     @relation(fields: [botId], references: [id], onDelete: Cascade)
  contactMapping     ContactMapping? @relation(fields: [contactMappingId], references: [id])

  @@index([locationId])
  @@index([botId, createdAt])
}
```

**Media direction handling**: inbound (Telegram→GHL) files are downloaded from Telegram and
re-uploaded to the GHL Media Library (reusing the upload pattern from the old `lib/ghl/media.ts`)
so GHL gets a stable URL instead of Telegram's short-lived file link. Outbound (GHL→Telegram)
files are already on GHL's CDN with stable URLs, so they're passed straight to Telegram's
`sendPhoto`/`sendDocument`.

## GHL Side

**OAuth scopes** (`buildAuthorizationUrl()` in `lib/ghl/client.ts`) — drop the funnels/media/redirects
scopes, add:

- `conversations/message.readonly`
- `conversations/message.write`
- `contacts.readonly`
- `contacts.write`
- `locations.readonly` (kept, used for location-details fetch on callback)

**Conversation Provider registration** — one-time setup in the GHL Marketplace Developer Portal
(not code):

1. App settings → Conversation Providers → add a provider named "Telegram" with an icon.
2. Set delivery/webhook URL to `https://<domain>/api/ghl/conversation-provider/outbound`.
3. Copy the generated Conversation Provider ID into `.env` as `GHL_CONVERSATION_PROVIDER_ID`
   (one global value for the whole app, not per-location).

**New/changed API routes:**

- `POST /api/ghl/conversation-provider/outbound` — receives GHL's callback when staff reply from
  the Inbox (`locationId`, `contactId`, `conversationId`, `message`). Looks up `ContactMapping` by
  `ghlContactId` + `locationId`, resolves the `TelegramBot`, calls Telegram's send APIs. Logs a
  `MessageLog` row either way.
- `POST /api/telegram/webhook/[secret]` — receives inbound Telegram updates (see Telegram Side).
- `GET/POST/DELETE /api/telegram/bots` — CRUD for bot tokens, used by the dashboard.
- `GET /api/telegram/messages` — paginated message log for a location.
- `POST /api/telegram/messages/[id]/retry` — re-attempts a `FAILED` row in whichever direction it
  originally failed.

`lib/ghl/client.ts` keeps `sessionStorage`, `exchangeToken`, `getGhlClient`, `buildAuthorizationUrl`,
`getGHLClient` — the raw `pg` queries inside `sessionStorage` become Prisma calls. Everything else
in `lib/ghl/` (`domains.ts`, `funnels.ts`, `llms-generator.ts`, `media.ts`, `redirects.ts`) is
deleted; a new `lib/ghl/conversations.ts` adds wrappers for pushing an inbound message and
uploading inbound attachments to the Media Library (adapted from the old `media.ts`).

## Telegram Side

**`lib/telegram/client.ts`** — thin `axios` wrapper around the Telegram Bot API:

- `getMe(token)` — validates a token, fetches bot id/username when adding a bot
- `setWebhook(token, url, secret)` / `deleteWebhook(token)`
- `sendMessage(token, chatId, text)`, `sendPhoto`, `sendDocument`, `sendVoice`
- `getFile(token, fileId)` → resolves Telegram's temporary file URL for downloading inbound media

**Webhook route** `POST /api/telegram/webhook/[secret]`:

1. Look up `TelegramBot` by `webhookSecret` from the URL path — 404 if not found/inactive.
2. Validate the `X-Telegram-Bot-Api-Secret-Token` header matches the same secret.
3. Parse the Telegram `Update`. v1 handles `message` updates only (text/photo/document/voice);
   other update types are ignored.
4. Dedupe: check for an existing `MessageLog` with the same `telegramMessageId` + `botId` and
   `status: SENT` — if found, skip processing and return `200` (handles Telegram's webhook
   redelivery).
5. Find `ContactMapping` by `(botId, telegramChatId)`. If missing: create a GHL contact via
   `POST /contacts` (name from Telegram's `first_name`/`last_name`, no phone/email required), then
   create the mapping. Unique constraint on `(botId, telegramChatId)` makes this race-safe — on a
   unique violation, re-fetch the mapping instead of erroring.
6. If media: download from Telegram, upload to GHL Media Library, get a stable URL.
7. Push into GHL via the Conversations API with `conversationProviderId`, `contactId`,
   `message`/`attachments`.
8. Write a `MessageLog` row (`SENT` or `FAILED` with `errorMessage`).
9. Always return `200 OK` quickly, even on downstream failure — Telegram retries aggressively on
   non-200; failures are visible via the `FAILED` log row + dashboard retry button instead.

**Bot connect flow**: user pastes a token in the dashboard → `POST /api/telegram/bots` → server
calls `getMe` to validate → generates a random `webhookSecret` → calls `setWebhook` pointing at
`/api/telegram/webhook/<secret>` with that secret → persists the `TelegramBot` row → returns bot
username/status to the UI. Fully automated from a single token paste — no manual webhook setup.

## Dashboard UI

Reuses the existing shell (`DashboardHeader`, SSO-via-`locationId` bootstrap, shadcn/ui). Swaps
the `llms.txt`-specific components for:

- **`BotList`** — cards per connected bot (username, active/inactive toggle, connected-since,
  delete). Replaces `GenerateForm`/`PreviewCard`/`ResultCard`.
- **`AddBotDialog`** — paste-a-token form; calls `POST /api/telegram/bots`, shows inline validation
  errors (e.g. invalid token from a failed `getMe`).
- **`MessageActivity`** — paginated recent-messages table (direction, contact, snippet, status)
  from `GET /api/telegram/messages`, with a "Retry" button on `FAILED` rows. Replaces
  `StatusDisplay`.
- **`Onboarding`** — kept, content rewritten for the 3-step Telegram flow (create a bot with
  @BotFather → paste the token → reply from your Inbox).
- **`PromoCard`** — kept as-is.

`dashboard/types.ts` gets new types (`TelegramBot`, `MessageLogEntry`) replacing
`GenerateResult`/`Status`.

## Edge Cases

- **Duplicate webhook delivery** — handled via the `telegramMessageId` dedupe check above.
- **Race on new-contact creation** — handled via the `@@unique([botId, telegramChatId])`
  constraint + re-fetch-on-conflict.
- **Expired/unrecoverable GHL session** — `sessionStorage.get()` already returns `undefined` when
  refresh fails; inbound messages log `FAILED` with `"GHL session expired — reconnect this
  location"`, surfaced as a dashboard banner prompting re-auth via the existing `/api/auth/ghl`
  flow.
- **Revoked/invalid bot token** — not auto-deactivated (avoids surprising the user); failures
  accumulate as `FAILED` rows visible in the dashboard; user deletes/re-adds the bot.
- **App uninstalled from a location** — **out of scope for v1**. No GHL uninstall webhook handler
  is built. A churned location's bots keep receiving Telegram messages that fail gracefully
  (logged, not retried automatically, no crash) rather than being cleaned up. Known gap, not a
  silent failure risk to end users.

## Config

New env var: `GHL_CONVERSATION_PROVIDER_ID`. Unchanged: `GHL_CLIENT_ID`, `GHL_CLIENT_SECRET`,
`GHL_REDIRECT_URI`, `NEXT_PUBLIC_APP_URL`, `DATABASE_URL`.

## Testing Approach

No test framework exists in this repo today (no Jest/Vitest, no `test` script) — not introducing
one speculatively. Verification is `tsc --noEmit` + `eslint` for correctness, then a manual
end-to-end walkthrough using a tunnel (ngrok/cloudflared) to expose localhost so Telegram can
actually deliver webhooks during dev: connect a real bot → message it from a personal Telegram
account → confirm it lands in the GHL Inbox → reply from the Inbox → confirm it arrives back in
Telegram.
