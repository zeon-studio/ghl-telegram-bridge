# Telegram for GHL

Two-way Telegram messaging inside your GoHighLevel Inbox. Connect one or more Telegram bots, or a
Phone Account, per sub-account; messages from Telegram show up as a native conversation channel in
the GHL Inbox, and replies sent from the Inbox go straight back to Telegram.

## Features

- **OAuth 2.0 Integration:** Secure connection to GHL sub-accounts using the official
  `@gohighlevel/api-client`.
- **Multiple Bots per Location:** Connect as many Telegram bots as a sub-account needs, each
  independently managed.
- **Phone Account Connections:** Log in with a real Telegram phone number (no bot) to sync an
  entire personal or business account — DMs, groups, and channels — directly into the Inbox.
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
- A Postgres database (Neon or any Postgres instance works).
- An app created in the [GHL Marketplace](https://marketplace.gohighlevel.com/).

### 2. Environment Variables

Create a `.env` file in the root directory (use `.env.example` as a template) and fill in
`GHL_CLIENT_ID`, `GHL_CLIENT_SECRET`, `DATABASE_URL`. Leave `GHL_CONVERSATION_PROVIDER_ID` for
step 4 below.

`TELEGRAM_API_ID` and `TELEGRAM_API_HASH` (from [my.telegram.org/apps](https://my.telegram.org/apps))
are optional — only needed if you want the **Phone Account** connection type. Without them, "Add
Phone Account" shows as disabled in the dashboard and the rest of the app is unaffected. Phone
Account connections require the app to run as a long-running Node process (`pnpm start`, not a
serverless platform like Vercel) — MTProto has no webhook equivalent, so each connected account
needs a standing connection.

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
- `/instrumentation.ts`: Boots persistent Phone Account connections on server startup.
- `/prisma`: Database schema and migrations.

---

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
