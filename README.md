# Telegram for GHL

Two-way Telegram messaging inside your GoHighLevel Inbox. Connect one or more Telegram bots, or a
Phone Account, per sub-account; messages from Telegram show up as a native conversation channel in
the GHL Inbox, and replies sent from the Inbox go straight back to Telegram.

## Features

- **OAuth 2.0 Integration:** Secure connection to GHL sub-accounts using the official
  `@gohighlevel/api-client`.
- **Multiple Bots per Location:** Connect as many Telegram bots as a sub-account needs, each
  independently managed.
- **Phone Account Connections (self-hosted only):** Log in with a real Telegram phone number (no
  bot) to sync an entire personal or business account — DMs, groups, and channels — directly into
  the Inbox. Off by default and not offered by the hosted app — see
  [Phone Accounts](#phone-accounts-self-hosted-only) for why.
- **Automatic Contact Creation:** New Telegram senders become GHL contacts the moment they
  message a connected bot — no manual linking step.
- **Native Two-Way Inbox Sync:** Registered as a GHL Conversation Provider, so Telegram messages
  are a real channel in the Inbox, not a note or a side panel.
- **Text and Media:** Photos, documents, and voice notes sync both directions, not just text.
- **SSO Dashboard:** Deeply integrated into the GHL UI as a Custom Page with built-in onboarding.

---

## Setup & Installation

### 1. Prerequisites

- A GoHighLevel Developer Account.
- A Postgres database. [Supabase](https://supabase.com/) is what this is set up for; any Postgres
  works. See [Choosing a database](#choosing-a-database) before picking a free tier — they are
  not interchangeable for an always-on webhook app.
- An app created in the [GHL Marketplace](https://marketplace.gohighlevel.com/).

### 2. Environment Variables

Create a `.env` file in the root directory (use `.env.example` as a template) and fill in
`GHL_CLIENT_ID`, `GHL_CLIENT_SECRET`, `ENCRYPTION_KEY`, `DATABASE_URL`, and `DIRECT_URL`. Leave
`GHL_CONVERSATION_PROVIDER_ID` for step 4 below.

**`ENCRYPTION_KEY`** encrypts Telegram bot tokens and phone-account session strings at rest
(AES-256-GCM). Generate one with `openssl rand -hex 32` and **back it up** — if you lose it, every
connected bot and phone account has to be reconnected from scratch.

Reading a secret that isn't encrypted is treated as an error rather than passed through, so a
write path that forgot to encrypt can't sit unnoticed.

**Two database URLs.** Supabase doesn't hand you variables with these names — they're what this
app calls them, so you're renaming values you already have.

| Supabase | This app | Port | Used for |
| --- | --- | --- | --- |
| `POSTGRES_PRISMA_URL` / "Transaction pooler" | `DATABASE_URL` | 6543 | App queries |
| `POSTGRES_URL_NON_POOLING` / "Session pooler" | `DIRECT_URL` | 5432 | Prisma Migrate only |

Migrations need their own URL because the transaction pooler runs PgBouncer in transaction mode,
which can't execute the session-level statements Prisma Migrate issues.

Copying by hand from Supabase Dashboard → Project Settings → Database → Connection string? Avoid
the third option, **"Direct connection"** (`db.<project-ref>.supabase.co`) — Supabase made it
IPv6-only unless you buy the IPv4 add-on, so it fails on Render and most other hosts. The pooler
hostname on port 5432 is the one that works.

`TELEGRAM_API_ID` and `TELEGRAM_API_HASH` are optional and **self-hosted only** — see
[Phone Accounts](#phone-accounts-self-hosted-only). Leave them unset and the Phone Accounts
section is hidden from the dashboard; nothing else changes.

### 3. Install Dependencies and Run Migrations

```bash
pnpm install
pnpm exec prisma migrate dev
```

### 4. Register a Conversation Provider

Generate a random secret (`openssl rand -hex 24`) and set it as
`GHL_CONVERSATION_PROVIDER_WEBHOOK_SECRET` in `.env` — GHL doesn't sign or otherwise authenticate
its outbound delivery webhook, so this app checks for that secret itself.

In the GHL Marketplace Developer Portal, open your app's settings → **Conversation Providers** →
create a new provider (name it "Telegram", add an icon). Set its **Delivery URL** to:

```
https://<your-domain>/api/ghl/conversation-provider/outbound?secret=<your GHL_CONVERSATION_PROVIDER_WEBHOOK_SECRET>
```

Copy the generated provider ID into `.env` as `GHL_CONVERSATION_PROVIDER_ID`.

### 5. Run the Development Server

```bash
pnpm dev
```

---

## Testing the App

### Manual Testing (Local)

> **Use `pnpm start` (not `pnpm dev`) when testing Telegram webhooks locally.** Run
> `pnpm build && pnpm start` instead — with `pnpm dev`, the webhook won't work.

Telegram needs to reach your webhook over HTTPS, so expose localhost with a tunnel
(e.g. `ngrok http 3000` or `cloudflared tunnel --url http://localhost:3000`), and set
`NEXT_PUBLIC_APP_URL` to that tunnel URL while testing.

1. **Initialize OAuth:** Open the app and connect a GHL sub-account.
2. **Dashboard Access:** After redirect, you land on `/dashboard`.
3. **Connect a Bot:** Click "Add Telegram Bot" and paste a token from
   [@BotFather](https://t.me/BotFather).
4. **Message the bot** from a personal Telegram account — it should appear in the GHL Inbox as a
   Telegram conversation within a few seconds.
5. **Reply from the Inbox** — the reply should arrive back in Telegram.
6. **Connect a Phone Account** (optional, needs `TELEGRAM_API_ID`/`TELEGRAM_API_HASH` set): click
   "Add Phone Account", enter a real phone number, enter the code Telegram sends to it, and the
   2FA password if that account has one. Send/receive a message in a DM, a group, and a channel
   from that account and confirm it lands in the GHL Inbox; reply from the Inbox and confirm
   delivery back to Telegram.

### GHL Iframe Testing (SSO)

1. Go to your **GHL Marketplace App Settings**.
2. Set the **Iframe URL** to `http://localhost:3000/dashboard` (or your tunnel URL).
3. Open a GHL Sub-account → **Settings** → **Custom Pages**.
4. Launch your app. The dashboard will automatically detect your `locationId` via query
   parameters.

---

## Deployment

This app is built to run on free infrastructure: a single always-on Node process plus a small
Postgres database. The constraints below are what shape several design choices in the code, so
they're worth reading before changing hosts.

### Choosing a database

Every free Postgres tier sleeps. What matters is **how it wakes and whether staying awake is
metered**, and on that they differ sharply:

| Provider | Sleeps after | Wake | Awake time metered? |
| --- | --- | --- | --- |
| Supabase | 7 days of *zero* activity | manual restore | no |
| Neon | 5 min idle | automatic, ~300 ms | **yes — 100 CU-hours/month** |
| Aiven | inactivity period, emailed first | manual | no |

Neon looks like the better fit and isn't. Its smallest compute is 0.25 CU, so staying awake around
the clock costs 0.25 × 730 = ~182 CU-hours against a 100 CU-hour quota — the free allowance runs
out around day 17, after which the compute is suspended outright and no connection succeeds until
the next billing cycle. A webhook app with tenants in more than one timezone gets queried across
most of the day, which is exactly that pattern.

Supabase's pause is uglier when it happens (manual click to restore) but it is preventable for
free, because time spent awake costs nothing there. That is what `GET /api/health` is for.

### Put the app in the same region as the database

Not a preference — the webhook budget depends on it. `POST /api/telegram/webhook/[secret]`
authenticates by looking the bot up by its webhook secret, and that query has to complete *before*
the 200 goes back to Telegram, so one database round-trip is the floor on acknowledgement latency.
Same region that is single-digit milliseconds; across an ocean it was measured at ~1.7 s per query,
which turns a fast ack into a slow one and puts you back in retry territory.

The Supabase project's region is fixed when you create it. Match the host to it — a `us-east-1`
database wants a US East instance, not Oregon or Frankfurt.

### Keepalive: two pings, not one

They are deliberately separate:

| Ping | Interval | Purpose |
| --- | --- | --- |
| `/` | every 10 min | Keeps the host from spinning down after 15 min idle |
| `/api/health` | daily | Runs `SELECT 1` so the database's idle clock resets, and prunes old message logs |

`/` is a static page and touches no database. Keep it that way — pointing the frequent ping at
anything that queries Postgres is what turns a metered free tier into a dead one, and it buys
nothing.

Use a pinger that permits commercial use. **UptimeRobot's free plan is personal, non-commercial
use only** as of October 2024, which a Marketplace app is not; [cron-job.org](https://cron-job.org)
and BetterStack's free tier both allow it.

Point an alert at `/api/health` too — it returns 503 if the database is unreachable, which is how
you find out about a pause in minutes rather than from a customer.

### Retention

There are no cron jobs on most free tiers, so the daily `/api/health` ping doubles as the
scheduler: it deletes message logs older than `LOG_RETENTION_DAYS` (default 30), at most once per
24 hours. Free Postgres caps at 0.5–1 GB and the log tables otherwise grow forever, so this is not
optional maintenance — it's the difference between the app working next year and the project
suspending on a storage limit.

### Memory

Relaying an attachment holds it in memory roughly three times over (download buffer, copy,
multipart body), so `MAX_MEDIA_MB` (default 15) caps what gets relayed; anything larger posts a
note to the Inbox pointing the user at Telegram. On a 512 MB instance this is a hard requirement
rather than a nicety — the Bot API's own limit is 20 MB, but MTProto has no cap and will stream a
multi-gigabyte file straight into the heap, OOM-killing the process for every tenant at once.

### Telegram webhook timing

`POST /api/telegram/webhook/[secret]` authenticates the request, acknowledges it with 200, and
does the relay work in Next's `after()` callback. Doing the work inline meant Telegram timed out
and retried, and the retry repeated the same contact lookup, media transfer, and GHL write — a
pile-up a shared CPU cannot absorb.

## Phone Accounts (self-hosted only)

Phone Accounts log in as a real Telegram user over MTProto rather than as a bot. The feature is
fully implemented and disabled by default: set `TELEGRAM_API_ID` / `TELEGRAM_API_HASH` from
[my.telegram.org/apps](https://my.telegram.org/apps) to enable it on your own deployment.

The hosted/marketplace build deliberately runs without them, for two independent reasons:

1. **Telegram's API terms.** Credentials are issued for your own product, you may not make them
   available to others, and any action taken by anyone authenticating under them is treated as
   taken by you. Logging many customers' personal accounts in under one `api_id` is the pattern
   that gets an `api_id` flagged — and takes those customers' accounts down with it.
2. **It needs a process that never stops.** MTProto has no webhook equivalent, so every connected
   account holds a standing connection (`pnpm start`, not a serverless platform). Any spin-down,
   restart, or redeploy drops those connections, and inbound messages that arrive during the gap
   are gone — Telegram won't redeliver them the way it retries a bot webhook.

If you self-host with your own `api_id`, both risks are yours to hold knowingly, which is the only
arrangement that makes sense for this feature.

## Publishing to Marketplace

### Required Documentation

GHL requires public URLs for:

- **Privacy Policy:** [your-domain.com/privacy](/privacy)
- **Terms of Service:** [your-domain.com/terms](/terms)
- **Support Email:** add your own support address here before submitting to the marketplace

### Scopes Required

- `conversations.readonly`
- `conversations.write`
- `conversations/message.readonly`
- `conversations/message.write`
- `contacts.readonly`
- `contacts.write`
- `locations.readonly`
- `medias.readonly`
- `medias.write`

Note: `conversations.*` and `conversations/message.*` are separate scope groups in GHL —
`conversations.write` is required to create a conversation (`POST /conversations/`), while
`conversations/message.*` only covers messages within an existing conversation. Both groups must
also be enabled in your app's Scopes configuration in the Marketplace Developer Portal, not just
requested in code — and any location that authorized before this scope was added needs to
reconnect (disconnect + "Connect Platform" again) to get a token with the new scope.

---

## Project Structure

- `/app/api/auth`: OAuth initiation and callback handlers.
- `/app/api/health`: Database keepalive + message-log pruning; target of the daily cron ping.
- `/app/api/session`: SSO session-info lookup used by the dashboard.
- `/app/api/telegram/bots`: Bot connect/list/toggle/disconnect endpoints.
- `/app/api/telegram/phone-accounts`: Phone Account login/list/toggle/disconnect endpoints.
- `/app/api/telegram/webhook/[secret]`: Receives inbound Telegram messages.
- `/app/api/telegram/messages`: Message log and retry endpoints.
- `/app/api/ghl/conversation-provider/outbound`: Receives GHL's outbound-reply webhook.
- `/app/dashboard`: The main GHL-integrated UI.
- `/app/privacy` & `/app/terms`: Legal documentation pages.
- `/lib/ghl`: GHL SDK wrappers, OAuth/session logic, contact/conversation helpers.
- `/lib/telegram`: Telegram Bot API client.
- `/lib/crypto.ts`: AES-256-GCM encryption for bot tokens and phone-account session strings.
- `/lib/media-limits.ts`: The shared attachment size cap, applied on both inbound paths.
- `/instrumentation.ts`: Boots persistent Phone Account connections on server startup.
- `/prisma`: Database schema and migrations.

---

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
