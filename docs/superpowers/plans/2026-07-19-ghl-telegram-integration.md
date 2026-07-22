# GHL Telegram Two-Way Inbox Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn this repo from a GHL `llms.txt` generator into a GHL marketplace app where agencies connect Telegram bots per location and get real two-way messaging between Telegram and their native GHL Inbox.

**Architecture:** Stateless Next.js API routes handle two webhook directions — Telegram → `/api/telegram/webhook/[secret]` → GHL Conversations API, and GHL's Conversation Provider delivery webhook → `/api/ghl/conversation-provider/outbound` → Telegram send APIs. Postgres (via Prisma) stores bot configs, Telegram-contact-to-GHL-contact mappings, and a message log. No queue, no worker process.

**Tech Stack:** Next.js 16 (App Router), TypeScript, Prisma + Postgres, `@gohighlevel/api-client` SDK, Telegram Bot HTTP API via `axios`, shadcn/ui (base-ui style).

**Full design reference:** `docs/superpowers/specs/2026-07-19-ghl-telegram-integration-design.md` — read it if anything below is ambiguous.

## Global Constraints

- Bots are scoped per GHL location (sub-account), never shared across locations.
- New Telegram senders auto-create a GHL contact immediately — no manual linking step, no contact-share prompt.
- v1 syncs text **and** media (photos, documents, voice) both directions.
- Two-way delivery goes through a registered GHL **Conversation Provider** — not notes, not a custom in-app reply button.
- Bot tokens are stored in **plaintext** in Postgres (explicit project decision — do not add encryption).
- Keep a local `MessageLog` row for every send attempt, in both directions, for debugging/retry — GHL remains the source of truth for conversation content.
- Relay is **synchronous inside the webhook handler** — no queue, no worker, no Redis. Failures are logged as `FAILED` and retried manually via a dashboard button.
- v1 only supports Telegram **private 1:1 chats** — no group chat fan-out.
- No test framework exists in this repo and none is being added. **"Verify:" replaces "Test:" in every task below** — verification is `npx tsc --noEmit` (compile correctness), `pnpm lint`, and for API routes, `pnpm dev` + `curl` against error/validation paths that don't require live third-party credentials. Full happy-path proof (real Telegram bot + real authorized GHL location) is deferred to the final manual walkthrough task (Task 15).
- Package manager is **pnpm** (see `pnpm-lock.yaml`, `pnpm-workspace.yaml`). Use `pnpm`/`pnpm dlx`, not `npm`/`npx`, for all commands below unless a tool's own docs require `npx` specifically.
- Path alias `@/*` maps to `./src/*` (see `tsconfig.json`). Use `@/...` imports in routes/components; relative imports (`../prisma`) inside `src/lib/**` to match the existing style in `src/lib/ghl/client.ts`.
- Next.js 16 route handlers: dynamic segment `params` is a `Promise` — always `{ params }: { params: Promise<{ id: string }> }` then `const { id } = await params;`. Confirmed against `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md`.
- **One flagged external unknown:** the exact JSON payload shape GHL POSTs to a Conversation Provider's outbound delivery webhook isn't available in the local SDK (it's a webhook *we receive*, not an SDK method we call, so it isn't typed anywhere in `@gohighlevel/api-client`). Task 7 writes defensive field extraction plus a logging step, with an explicit instruction to confirm/adjust field names against the real payload during Task 15's live test. This is the only place in the plan where field names are a best-effort default rather than a confirmed contract.

---

### Task 1: Prisma schema and client setup

**Files:**
- Create: `prisma/schema.prisma`
- Create: `src/lib/prisma.ts`
- Modify: `package.json`
- Delete: `supabase_schema.sql`

**Interfaces:**
- Produces: `prisma` (singleton `PrismaClient` instance) from `src/lib/prisma.ts`, imported as `import { prisma } from "@/lib/prisma"` (routes/components) or `import { prisma } from "../prisma"` (files inside `src/lib/**`). Produces Prisma models `Session`, `TelegramBot`, `ContactMapping`, `MessageLog` and enums `MessageDirection`, `MessageStatus` from `@prisma/client`.

- [ ] **Step 1: Install Prisma**

```bash
pnpm add @prisma/client
pnpm add -D prisma
```

- [ ] **Step 2: Write the schema**

Create `prisma/schema.prisma`:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Session {
  locationId   String   @id @map("location_id")
  accessToken  String   @map("access_token")
  refreshToken String   @map("refresh_token")
  expiresAt    BigInt   @map("expires_at")
  userId       String?  @map("user_id")
  companyId    String?  @map("company_id")
  locationName String?  @map("location_name")
  email        String?
  phone        String?
  address      String?
  city         String?
  country      String?
  createdAt    DateTime @default(now()) @map("created_at")
  updatedAt    DateTime @updatedAt @map("updated_at")

  @@map("sessions")
}

model TelegramBot {
  id            String   @id @default(cuid())
  locationId    String   @map("location_id")
  botToken      String   @map("bot_token")
  telegramBotId String   @map("telegram_bot_id")
  botUsername   String   @map("bot_username")
  displayName   String?  @map("display_name")
  webhookSecret String   @unique @map("webhook_secret")
  isActive      Boolean  @default(true) @map("is_active")
  createdAt     DateTime @default(now()) @map("created_at")
  updatedAt     DateTime @updatedAt @map("updated_at")

  contacts ContactMapping[]
  messages MessageLog[]

  @@index([locationId])
  @@map("telegram_bots")
}

model ContactMapping {
  id                String   @id @default(cuid())
  botId             String   @map("bot_id")
  locationId        String   @map("location_id")
  telegramChatId    String   @map("telegram_chat_id")
  telegramUserId    String?  @map("telegram_user_id")
  telegramUsername  String?  @map("telegram_username")
  telegramName      String?  @map("telegram_name")
  ghlContactId      String   @map("ghl_contact_id")
  ghlConversationId String?  @map("ghl_conversation_id")
  createdAt         DateTime @default(now()) @map("created_at")
  updatedAt         DateTime @updatedAt @map("updated_at")

  bot      TelegramBot  @relation(fields: [botId], references: [id], onDelete: Cascade)
  messages MessageLog[]

  @@unique([botId, telegramChatId])
  @@index([locationId])
  @@map("contact_mappings")
}

enum MessageDirection {
  INBOUND
  OUTBOUND
}

enum MessageStatus {
  SENT
  FAILED
}

model MessageLog {
  id                String           @id @default(cuid())
  botId             String           @map("bot_id")
  locationId        String           @map("location_id")
  contactMappingId  String?          @map("contact_mapping_id")
  direction         MessageDirection
  contentType       String           @map("content_type")
  textContent       String?          @map("text_content")
  mediaUrl          String?          @map("media_url")
  telegramMessageId String?          @map("telegram_message_id")
  ghlMessageId      String?          @map("ghl_message_id")
  status            MessageStatus
  errorMessage      String?          @map("error_message")
  createdAt         DateTime         @default(now()) @map("created_at")

  bot            TelegramBot     @relation(fields: [botId], references: [id], onDelete: Cascade)
  contactMapping ContactMapping? @relation(fields: [contactMappingId], references: [id])

  @@index([locationId])
  @@index([botId, createdAt])
  @@map("message_logs")
}
```

- [ ] **Step 3: Write the Prisma client singleton**

Create `src/lib/prisma.ts`:

```typescript
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
```

- [ ] **Step 4: Generate the client and verify it compiles**

```bash
pnpm exec prisma generate
npx tsc --noEmit
```

Expected: both commands exit 0. `tsc` will still report errors elsewhere in the repo from unrelated files at this point — that's expected until later tasks; look specifically for no errors mentioning `prisma/schema.prisma` or `src/lib/prisma.ts`.

- [ ] **Step 5: Run the initial migration**

Ensure `.env` exists at the project root with a real `DATABASE_URL` (copy `.env.example` if you don't have one, fill in a Postgres connection string — Neon or any Postgres works). Then:

```bash
pnpm exec prisma migrate dev --name init
```

Expected: output ending in `Your database is now in sync with your schema` and a new `prisma/migrations/<timestamp>_init/` directory.

- [ ] **Step 6: Remove the superseded Supabase SQL file**

```bash
git rm supabase_schema.sql
```

- [ ] **Step 7: Commit**

```bash
git add prisma/ src/lib/prisma.ts package.json pnpm-lock.yaml
git commit -m "feat: add Prisma schema for Telegram integration data model"
```

---

### Task 2: Migrate session storage to Prisma; update OAuth scopes

**Files:**
- Modify: `src/lib/ghl/client.ts`
- Delete: `src/lib/db/client.ts`
- Modify: `package.json` (remove `pg`, `@types/pg`)

**Interfaces:**
- Consumes: `prisma` from `src/lib/prisma.ts` (Task 1).
- Produces: unchanged public interface of `sessionStorage` (`.get(locationId)`, `.set(locationId, session)`, `.delete(locationId)`, `.keys()`), `exchangeToken`, `getGhlClient`, `getGHLClient`, `buildAuthorizationUrl`, `TokenSession`, `TokenResponse` — all consumed as-is by `src/lib/api-utils.ts`, `src/app/api/auth/ghl/route.ts`, `src/app/api/auth/callback/route.ts`. No caller of these needs to change.

- [ ] **Step 1: Replace the storage backend inside `sessionStorage`**

In `src/lib/ghl/client.ts`, remove the `fs`, `path`, `os` imports and the `readLocalSessions`/`writeLocalSession`/`deleteLocalSession`/`LOCAL_STORAGE_FILE` block (lines 11-13, 109-143 in the current file), remove `import { db } from "../db/client";` (line 70), and replace the `sessionStorage` object (lines 145-276) with:

```typescript
import { prisma } from "../prisma";

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
```

- [ ] **Step 2: Update OAuth scopes in `buildAuthorizationUrl`**

In the same file, find the `scopes` array inside `buildAuthorizationUrl` and replace it:

```typescript
  const scopes = [
    "conversations/message.readonly",
    "conversations/message.write",
    "contacts.readonly",
    "contacts.write",
    "locations.readonly",
  ].join(" ");
```

- [ ] **Step 3: Delete the raw `pg` client and remove the dependency**

```bash
git rm src/lib/db/client.ts
rmdir src/lib/db 2>/dev/null || true
pnpm remove pg @types/pg
```

- [ ] **Step 4: Verify**

```bash
npx tsc --noEmit
```

Expected: no errors referencing `src/lib/ghl/client.ts` or `src/lib/db/client.ts` (that path no longer exists). If Prisma's generated `BigInt` type causes a `JSON.stringify`/serialization complaint anywhere, it will only show up once routes consume `Session` rows directly — none do outside `sessionStorage` itself, so there should be no such error yet.

Also confirm no other file imports the deleted module:

```bash
grep -rn "lib/db/client" src
```

Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ghl/client.ts package.json pnpm-lock.yaml
git commit -m "refactor: migrate session storage to Prisma, update OAuth scopes for Conversations/Contacts"
```

---

### Task 3: Telegram Bot API client library

**Files:**
- Create: `src/lib/telegram/client.ts`

**Interfaces:**
- Produces: `getMe(token)`, `setWebhook(token, url, secretToken)`, `deleteWebhook(token)`, `sendMessage(token, chatId, text)`, `sendPhoto(token, chatId, photoUrl, caption?)`, `sendDocument(token, chatId, documentUrl, caption?)`, `sendVoice(token, chatId, voiceUrl)`, `getFile(token, fileId)`, `getFileDownloadUrl(token, filePath)`, `downloadFile(token, filePath)` — all from `src/lib/telegram/client.ts`. Types `TelegramUpdate`, `TelegramMessage`, `TelegramUser`, `TelegramChat`, `TelegramFile`.

- [ ] **Step 1: Write the client**

Create `src/lib/telegram/client.ts`:

```typescript
/**
 * lib/telegram/client.ts
 * -----------------------
 * Thin wrapper around the Telegram Bot HTTP API.
 * https://core.telegram.org/bots/api
 */

import axios from "axios";

const TELEGRAM_API_BASE = "https://api.telegram.org";

export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
}

export interface TelegramChat {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
  first_name?: string;
  last_name?: string;
  username?: string;
}

export interface TelegramPhotoSize {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
}

export interface TelegramDocument {
  file_id: string;
  file_unique_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

export interface TelegramVoice {
  file_id: string;
  file_unique_id: string;
  duration: number;
  mime_type?: string;
  file_size?: number;
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
  caption?: string;
  photo?: TelegramPhotoSize[];
  document?: TelegramDocument;
  voice?: TelegramVoice;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

export interface TelegramFile {
  file_id: string;
  file_unique_id: string;
  file_size?: number;
  file_path?: string;
}

function apiUrl(token: string, method: string): string {
  return `${TELEGRAM_API_BASE}/bot${token}/${method}`;
}

export async function getMe(token: string): Promise<TelegramUser> {
  const resp = await axios.post(apiUrl(token, "getMe"));
  return resp.data.result;
}

export async function setWebhook(token: string, url: string, secretToken: string): Promise<void> {
  await axios.post(apiUrl(token, "setWebhook"), {
    url,
    secret_token: secretToken,
    allowed_updates: ["message"],
  });
}

export async function deleteWebhook(token: string): Promise<void> {
  await axios.post(apiUrl(token, "deleteWebhook"));
}

export async function sendMessage(
  token: string,
  chatId: string | number,
  text: string,
): Promise<TelegramMessage> {
  const resp = await axios.post(apiUrl(token, "sendMessage"), { chat_id: chatId, text });
  return resp.data.result;
}

export async function sendPhoto(
  token: string,
  chatId: string | number,
  photoUrl: string,
  caption?: string,
): Promise<TelegramMessage> {
  const resp = await axios.post(apiUrl(token, "sendPhoto"), {
    chat_id: chatId,
    photo: photoUrl,
    caption,
  });
  return resp.data.result;
}

export async function sendDocument(
  token: string,
  chatId: string | number,
  documentUrl: string,
  caption?: string,
): Promise<TelegramMessage> {
  const resp = await axios.post(apiUrl(token, "sendDocument"), {
    chat_id: chatId,
    document: documentUrl,
    caption,
  });
  return resp.data.result;
}

export async function sendVoice(
  token: string,
  chatId: string | number,
  voiceUrl: string,
): Promise<TelegramMessage> {
  const resp = await axios.post(apiUrl(token, "sendVoice"), { chat_id: chatId, voice: voiceUrl });
  return resp.data.result;
}

export async function getFile(token: string, fileId: string): Promise<TelegramFile> {
  const resp = await axios.post(apiUrl(token, "getFile"), { file_id: fileId });
  return resp.data.result;
}

export function getFileDownloadUrl(token: string, filePath: string): string {
  return `${TELEGRAM_API_BASE}/file/bot${token}/${filePath}`;
}

export async function downloadFile(token: string, filePath: string): Promise<Buffer> {
  const resp = await axios.get(getFileDownloadUrl(token, filePath), {
    responseType: "arraybuffer",
  });
  return Buffer.from(resp.data);
}
```

- [ ] **Step 2: Verify**

```bash
npx tsc --noEmit
```

Expected: no errors referencing `src/lib/telegram/client.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/telegram/client.ts
git commit -m "feat: add Telegram Bot API client wrapper"
```

---

### Task 4: GHL contact, conversation, and media helper library

**Files:**
- Create: `src/lib/ghl/contacts.ts`
- Create: `src/lib/ghl/conversations.ts`

**Interfaces:**
- Consumes: `prisma` (Task 1), `getGhlClient` from `./client` (existing, unchanged), `ContactMapping` type from `@prisma/client`.
- Produces:
  - `findOrCreateContactMapping(botId, locationId, accessToken, sender: TelegramSender): Promise<ContactMapping>` from `src/lib/ghl/contacts.ts`.
  - `getOrCreateConversationId(mapping: ContactMapping, accessToken: string): Promise<string>` from `src/lib/ghl/conversations.ts`.
  - `pushInboundMessage(params: { conversationId, accessToken, text?, attachmentUrls? }): Promise<{ messageId: string }>` from `src/lib/ghl/conversations.ts`.
  - `uploadMediaToGhl(buffer, fileName, contentType, locationId, accessToken): Promise<string>` from `src/lib/ghl/conversations.ts`.
  - `updateMessageDeliveryStatus(messageId, status: "delivered" | "failed", accessToken): Promise<void>` from `src/lib/ghl/conversations.ts`.

This task uses `@gohighlevel/api-client`'s typed `Conversations`/`Contacts` services (confirmed by reading `node_modules/.pnpm/@gohighlevel+api-client@2.3.0/node_modules/@gohighlevel/api-client/dist/lib/code/{contacts,conversations}/models/*.d.ts`): `ghl.contacts.createContact(CreateContactDto)`, `ghl.conversations.createConversation({ locationId, contactId })`, `ghl.conversations.addAnInboundMessage(ProcessMessageBodyDto)`, `ghl.conversations.updateMessageStatus({ messageId }, { status })`.

- [ ] **Step 1: Write the contact-mapping helper**

Create `src/lib/ghl/contacts.ts`:

```typescript
/**
 * lib/ghl/contacts.ts
 * ---------------------
 * Resolves a Telegram sender to a GHL contact, auto-creating both the
 * contact and the local mapping row on first contact.
 */

import HighLevel from "@gohighlevel/api-client";
import { Prisma, type ContactMapping } from "@prisma/client";
import { prisma } from "../prisma";

export interface TelegramSender {
  chatId: string;
  userId?: string;
  username?: string;
  firstName?: string;
  lastName?: string;
}

function ghlClient(accessToken: string): HighLevel {
  // The SDK's constructor requires clientId+clientSecret or a
  // privateIntegrationToken to pass its own validation, even though a
  // locationAccessToken alone is all that's actually used to build the
  // Authorization header (clientId/clientSecret only back its own OAuth
  // refresh flow, which we never trigger — our accessToken is already
  // refreshed by sessionStorage.get() before it reaches here).
  return new HighLevel({
    clientId: process.env.GHL_CLIENT_ID!,
    clientSecret: process.env.GHL_CLIENT_SECRET!,
    locationAccessToken: accessToken,
  });
}

export async function findOrCreateContactMapping(
  botId: string,
  locationId: string,
  accessToken: string,
  sender: TelegramSender,
): Promise<ContactMapping> {
  const existing = await prisma.contactMapping.findUnique({
    where: { botId_telegramChatId: { botId, telegramChatId: sender.chatId } },
  });
  if (existing) return existing;

  const ghl = ghlClient(accessToken);
  const displayName =
    [sender.firstName, sender.lastName].filter(Boolean).join(" ") ||
    sender.username ||
    "Telegram User";

  const response = await ghl.contacts.createContact({
    locationId,
    firstName: sender.firstName,
    lastName: sender.lastName,
    name: displayName,
    source: "Telegram",
  });

  const ghlContactId = response.contact?.id;
  if (!ghlContactId) {
    throw new Error(`GHL contact creation returned no id: ${JSON.stringify(response)}`);
  }

  try {
    return await prisma.contactMapping.create({
      data: {
        botId,
        locationId,
        telegramChatId: sender.chatId,
        telegramUserId: sender.userId,
        telegramUsername: sender.username,
        telegramName: displayName,
        ghlContactId,
      },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const winner = await prisma.contactMapping.findUnique({
        where: { botId_telegramChatId: { botId, telegramChatId: sender.chatId } },
      });
      if (winner) return winner;
    }
    throw e;
  }
}
```

- [ ] **Step 2: Write the conversation/media helper**

Create `src/lib/ghl/conversations.ts`:

```typescript
/**
 * lib/ghl/conversations.ts
 * --------------------------
 * Pushes Telegram messages into a location's GHL Inbox via the
 * registered Conversation Provider, and uploads Telegram media to the
 * GHL Media Library so GHL gets a stable, non-expiring attachment URL.
 */

import HighLevel from "@gohighlevel/api-client";
import FormData from "form-data";
import type { ContactMapping } from "@prisma/client";
import { getGhlClient } from "./client";
import { prisma } from "../prisma";

const CONVERSATION_PROVIDER_ID = process.env.GHL_CONVERSATION_PROVIDER_ID!;

// GHL's `type` value for a message sent through a custom Conversation
// Provider. Not documented in the local SDK types — confirm this against
// the real API response the first time Task 15's manual test pushes an
// inbound message; GHL returns a 400 naming the accepted value if wrong.
const MESSAGE_TYPE = "CUSTOM";

function ghlClient(accessToken: string): HighLevel {
  // Same rationale as the identical helper in contacts.ts: the SDK
  // requires clientId+clientSecret or a privateIntegrationToken to
  // construct without throwing, even though only locationAccessToken
  // ends up in the Authorization header.
  return new HighLevel({
    clientId: process.env.GHL_CLIENT_ID!,
    clientSecret: process.env.GHL_CLIENT_SECRET!,
    locationAccessToken: accessToken,
  });
}

export async function getOrCreateConversationId(
  mapping: ContactMapping,
  accessToken: string,
): Promise<string> {
  if (mapping.ghlConversationId) return mapping.ghlConversationId;

  const ghl = ghlClient(accessToken);
  const response = await ghl.conversations.createConversation({
    locationId: mapping.locationId,
    contactId: mapping.ghlContactId,
  });
  const conversationId = (response.conversation as { id: string }).id;

  await prisma.contactMapping.update({
    where: { id: mapping.id },
    data: { ghlConversationId: conversationId },
  });

  return conversationId;
}

export async function pushInboundMessage(params: {
  conversationId: string;
  accessToken: string;
  text?: string;
  attachmentUrls?: string[];
}): Promise<{ messageId: string }> {
  const ghl = ghlClient(params.accessToken);
  const response = await ghl.conversations.addAnInboundMessage({
    type: MESSAGE_TYPE,
    conversationId: params.conversationId,
    conversationProviderId: CONVERSATION_PROVIDER_ID,
    message: params.text,
    attachments: params.attachmentUrls,
    date: new Date().toISOString(),
  });
  return { messageId: response.messageId };
}

export async function updateMessageDeliveryStatus(
  messageId: string,
  status: "delivered" | "failed",
  accessToken: string,
): Promise<void> {
  const ghl = ghlClient(accessToken);
  await ghl.conversations.updateMessageStatus({ messageId }, { status });
}

export async function uploadMediaToGhl(
  buffer: Buffer,
  fileName: string,
  contentType: string,
  locationId: string,
  accessToken: string,
): Promise<string> {
  const client = getGhlClient(accessToken);
  const form = new FormData();
  form.append("file", buffer, { filename: fileName, contentType });
  form.append("name", fileName);
  form.append("locationId", locationId);

  const resp = await client.post("/medias/upload-file", form, {
    headers: form.getHeaders(),
  });

  const url: string = resp.data?.url ?? resp.data?.fileUrl ?? resp.data?.data?.url ?? "";
  if (!url) {
    throw new Error(`Media upload succeeded but no URL returned: ${JSON.stringify(resp.data)}`);
  }
  return url;
}
```

- [ ] **Step 3: Verify**

```bash
npx tsc --noEmit
```

Expected: no errors referencing `src/lib/ghl/contacts.ts` or `src/lib/ghl/conversations.ts`. (`GHL_CONVERSATION_PROVIDER_ID` being unset in `.env` at this point is fine — it's only read at request time, not at compile time.)

- [ ] **Step 4: Commit**

```bash
git add src/lib/ghl/contacts.ts src/lib/ghl/conversations.ts
git commit -m "feat: add GHL contact/conversation/media helpers for Telegram bridging"
```

---

### Task 5: Bot management API routes

**Files:**
- Create: `src/app/api/telegram/bots/route.ts`
- Create: `src/app/api/telegram/bots/[id]/route.ts`

**Interfaces:**
- Consumes: `prisma` (Task 1), `getMe`/`setWebhook`/`deleteWebhook` (Task 3), `getActiveSession`/`handleApiError` from `@/lib/api-utils` (existing, unchanged).
- Produces: `GET /api/telegram/bots?locationId=` → `{ success: true, bots: SerializedBot[] }`. `POST /api/telegram/bots` (body `{ locationId, botToken, displayName? }`) → `{ success: true, bot: SerializedBot }`. `PATCH /api/telegram/bots/[id]` (body `{ isActive: boolean }`) → `{ success: true, bot: { id, isActive } }`. `DELETE /api/telegram/bots/[id]` → `{ success: true }`. Where `SerializedBot = { id: string, botUsername: string, displayName: string | null, isActive: boolean, createdAt: string }` — matches the `TelegramBot` type Task 10 defines in `src/app/dashboard/types.ts`.

- [ ] **Step 1: Write the collection route**

Create `src/app/api/telegram/bots/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { getMe, setWebhook } from "@/lib/telegram/client";
import { getActiveSession, handleApiError } from "@/lib/api-utils";

export const runtime = "nodejs";

function serializeBot(bot: {
  id: string;
  botUsername: string;
  displayName: string | null;
  isActive: boolean;
  createdAt: Date;
}) {
  return {
    id: bot.id,
    botUsername: bot.botUsername,
    displayName: bot.displayName,
    isActive: bot.isActive,
    createdAt: bot.createdAt.toISOString(),
  };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const locationId = request.nextUrl.searchParams.get("locationId");
    if (!locationId) {
      return NextResponse.json({ error: "locationId is required" }, { status: 400 });
    }

    const bots = await prisma.telegramBot.findMany({
      where: { locationId },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json({ success: true, bots: bots.map(serializeBot) });
  } catch (error) {
    return handleApiError(error, "Failed to fetch bots");
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = (await request.json()) as {
      locationId?: string;
      botToken?: string;
      displayName?: string;
    };
    const { locationId, botToken, displayName } = body;

    if (!locationId || !botToken) {
      return NextResponse.json(
        { error: "locationId and botToken are required" },
        { status: 400 },
      );
    }

    const { errorResponse } = await getActiveSession(locationId);
    if (errorResponse) return errorResponse;

    let me;
    try {
      me = await getMe(botToken);
    } catch {
      return NextResponse.json(
        { error: "Invalid bot token — Telegram rejected it" },
        { status: 400 },
      );
    }

    const webhookSecret = crypto.randomBytes(24).toString("hex");
    const webhookUrl = `${process.env.NEXT_PUBLIC_APP_URL}/api/telegram/webhook/${webhookSecret}`;
    await setWebhook(botToken, webhookUrl, webhookSecret);

    const bot = await prisma.telegramBot.create({
      data: {
        locationId,
        botToken,
        telegramBotId: String(me.id),
        botUsername: me.username ?? me.first_name,
        displayName: displayName || null,
        webhookSecret,
      },
    });

    return NextResponse.json({ success: true, bot: serializeBot(bot) });
  } catch (error) {
    return handleApiError(error, "Failed to add bot");
  }
}
```

- [ ] **Step 2: Write the single-bot route**

Create `src/app/api/telegram/bots/[id]/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { deleteWebhook } from "@/lib/telegram/client";
import { handleApiError } from "@/lib/api-utils";

export const runtime = "nodejs";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const { isActive } = (await request.json()) as { isActive?: boolean };

    if (typeof isActive !== "boolean") {
      return NextResponse.json({ error: "isActive must be a boolean" }, { status: 400 });
    }

    const bot = await prisma.telegramBot.update({ where: { id }, data: { isActive } });
    return NextResponse.json({ success: true, bot: { id: bot.id, isActive: bot.isActive } });
  } catch (error) {
    return handleApiError(error, "Failed to update bot");
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const bot = await prisma.telegramBot.findUnique({ where: { id } });
    if (!bot) {
      return NextResponse.json({ error: "Bot not found" }, { status: 404 });
    }

    try {
      await deleteWebhook(bot.botToken);
    } catch (e) {
      console.error("[Bots] Failed to delete Telegram webhook (continuing):", e);
    }

    await prisma.telegramBot.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error, "Failed to delete bot");
  }
}
```

- [ ] **Step 3: Verify**

```bash
npx tsc --noEmit
pnpm lint
```

Expected: both clean for these two new files.

Then start the dev server and check the validation paths that don't need a live Telegram token:

```bash
pnpm dev &
sleep 3
curl -s -X POST http://localhost:3000/api/telegram/bots -H "Content-Type: application/json" -d '{}'
curl -s "http://localhost:3000/api/telegram/bots"
kill %1
```

Expected: first call → `{"error":"locationId and botToken are required"}` with 400. Second call → `{"error":"locationId is required"}` with 400.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/telegram/bots
git commit -m "feat: add Telegram bot management API routes"
```

---

### Task 6: Telegram inbound webhook route

**Files:**
- Create: `src/app/api/telegram/webhook/[secret]/route.ts`

**Interfaces:**
- Consumes: `prisma` (Task 1); `TelegramUpdate`, `getFile`, `downloadFile` (Task 3); `findOrCreateContactMapping` (Task 4); `getOrCreateConversationId`, `pushInboundMessage`, `uploadMediaToGhl` (Task 4); `sessionStorage` from `@/lib/ghl/client` (Task 2).
- Produces: a live endpoint `POST /api/telegram/webhook/[secret]` that Task 5's `setWebhook` call points bots at.

- [ ] **Step 1: Write the route**

Create `src/app/api/telegram/webhook/[secret]/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import * as telegram from "@/lib/telegram/client";
import { findOrCreateContactMapping } from "@/lib/ghl/contacts";
import {
  getOrCreateConversationId,
  pushInboundMessage,
  uploadMediaToGhl,
} from "@/lib/ghl/conversations";
import { sessionStorage } from "@/lib/ghl/client";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ secret: string }> },
): Promise<NextResponse> {
  const { secret } = await params;

  const bot = await prisma.telegramBot.findUnique({ where: { webhookSecret: secret } });
  if (!bot || !bot.isActive) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const secretHeader = request.headers.get("x-telegram-bot-api-secret-token");
  if (secretHeader !== bot.webhookSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const update = (await request.json()) as telegram.TelegramUpdate;
  const message = update.message;
  if (!message) {
    return NextResponse.json({ ok: true });
  }

  const telegramMessageId = String(message.message_id);

  const existingLog = await prisma.messageLog.findFirst({
    where: { botId: bot.id, telegramMessageId, direction: "INBOUND", status: "SENT" },
  });
  if (existingLog) {
    return NextResponse.json({ ok: true });
  }

  const session = await sessionStorage.get(bot.locationId);
  if (!session) {
    await prisma.messageLog.create({
      data: {
        botId: bot.id,
        locationId: bot.locationId,
        direction: "INBOUND",
        contentType: "text",
        textContent: message.text ?? message.caption ?? null,
        telegramMessageId,
        status: "FAILED",
        errorMessage: "GHL session expired — reconnect this location",
      },
    });
    return NextResponse.json({ ok: true });
  }

  try {
    const mapping = await findOrCreateContactMapping(
      bot.id,
      bot.locationId,
      session.accessToken,
      {
        chatId: String(message.chat.id),
        userId: message.from ? String(message.from.id) : undefined,
        username: message.from?.username,
        firstName: message.from?.first_name ?? message.chat.first_name,
        lastName: message.from?.last_name ?? message.chat.last_name,
      },
    );

    const conversationId = await getOrCreateConversationId(mapping, session.accessToken);

    let contentType = "text";
    let mediaUrl: string | undefined;
    const attachmentUrls: string[] = [];

    if (message.photo && message.photo.length > 0) {
      contentType = "photo";
      const largest = message.photo[message.photo.length - 1];
      const file = await telegram.getFile(bot.botToken, largest.file_id);
      if (file.file_path) {
        const buffer = await telegram.downloadFile(bot.botToken, file.file_path);
        mediaUrl = await uploadMediaToGhl(
          buffer,
          `telegram-photo-${message.message_id}.jpg`,
          "image/jpeg",
          bot.locationId,
          session.accessToken,
        );
        attachmentUrls.push(mediaUrl);
      }
    } else if (message.document) {
      contentType = "document";
      const file = await telegram.getFile(bot.botToken, message.document.file_id);
      if (file.file_path) {
        const buffer = await telegram.downloadFile(bot.botToken, file.file_path);
        mediaUrl = await uploadMediaToGhl(
          buffer,
          message.document.file_name ?? `telegram-document-${message.message_id}`,
          message.document.mime_type ?? "application/octet-stream",
          bot.locationId,
          session.accessToken,
        );
        attachmentUrls.push(mediaUrl);
      }
    } else if (message.voice) {
      contentType = "voice";
      const file = await telegram.getFile(bot.botToken, message.voice.file_id);
      if (file.file_path) {
        const buffer = await telegram.downloadFile(bot.botToken, file.file_path);
        mediaUrl = await uploadMediaToGhl(
          buffer,
          `telegram-voice-${message.message_id}.ogg`,
          message.voice.mime_type ?? "audio/ogg",
          bot.locationId,
          session.accessToken,
        );
        attachmentUrls.push(mediaUrl);
      }
    }

    const text = message.text ?? message.caption;

    const { messageId } = await pushInboundMessage({
      conversationId,
      accessToken: session.accessToken,
      text,
      attachmentUrls: attachmentUrls.length > 0 ? attachmentUrls : undefined,
    });

    await prisma.messageLog.create({
      data: {
        botId: bot.id,
        locationId: bot.locationId,
        contactMappingId: mapping.id,
        direction: "INBOUND",
        contentType,
        textContent: text,
        mediaUrl,
        telegramMessageId,
        ghlMessageId: messageId,
        status: "SENT",
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("[Telegram Webhook] Failed to process message:", error);
    await prisma.messageLog.create({
      data: {
        botId: bot.id,
        locationId: bot.locationId,
        direction: "INBOUND",
        contentType: "text",
        textContent: message.text ?? message.caption ?? null,
        telegramMessageId,
        status: "FAILED",
        errorMessage,
      },
    });
  }

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Verify**

```bash
npx tsc --noEmit
```

Expected: no errors referencing this file.

```bash
pnpm dev &
sleep 3
curl -s -X POST http://localhost:3000/api/telegram/webhook/does-not-exist -H "Content-Type: application/json" -d '{}'
kill %1
```

Expected: `{"error":"Not found"}` with a 404 status (no bot has that `webhookSecret` yet).

- [ ] **Step 3: Commit**

```bash
git add src/app/api/telegram/webhook
git commit -m "feat: add Telegram inbound webhook route pushing messages into GHL Inbox"
```

---

### Task 7: GHL Conversation Provider outbound webhook route

**Files:**
- Create: `src/app/api/ghl/conversation-provider/outbound/route.ts`

**Interfaces:**
- Consumes: `prisma` (Task 1); `sendMessage`/`sendPhoto`/`sendDocument` (Task 3); `sessionStorage` (Task 2); `updateMessageDeliveryStatus` (Task 4).
- Produces: a live endpoint `POST /api/ghl/conversation-provider/outbound` — this exact URL is what you paste into the GHL Marketplace Developer Portal's Conversation Provider "Delivery URL" field (see `docs/superpowers/specs/2026-07-19-ghl-telegram-integration-design.md`, GHL Side section).

**Note on the payload shape:** see the flagged unknown in Global Constraints. The `ConversationProviderOutboundPayload` interface below is a best-effort guess at common field names; confirm/adjust it during Task 15 using the raw payload this route logs.

- [ ] **Step 1: Write the route**

Create `src/app/api/ghl/conversation-provider/outbound/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import * as telegram from "@/lib/telegram/client";
import { sessionStorage } from "@/lib/ghl/client";
import { updateMessageDeliveryStatus } from "@/lib/ghl/conversations";

export const runtime = "nodejs";

interface ConversationProviderOutboundPayload {
  locationId?: string;
  contactId?: string;
  conversationId?: string;
  messageId?: string;
  message?: {
    id?: string;
    body?: string;
    message?: string;
    attachments?: string[];
  };
  body?: string;
  attachments?: string[];
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const payload = (await request.json()) as ConversationProviderOutboundPayload;
  console.log("[Conversation Provider Outbound] Raw payload:", JSON.stringify(payload));

  const locationId = payload.locationId;
  const contactId = payload.contactId;
  const text = payload.message?.body ?? payload.message?.message ?? payload.body;
  const attachments = payload.message?.attachments ?? payload.attachments ?? [];
  const messageId = payload.messageId ?? payload.message?.id;

  if (!locationId || !contactId) {
    return NextResponse.json({ error: "Missing locationId or contactId" }, { status: 400 });
  }

  const mapping = await prisma.contactMapping.findFirst({
    where: { locationId, ghlContactId: contactId },
  });
  if (!mapping) {
    return NextResponse.json({ error: "No Telegram mapping for this contact" }, { status: 404 });
  }

  const bot = await prisma.telegramBot.findUnique({ where: { id: mapping.botId } });
  if (!bot || !bot.isActive) {
    return NextResponse.json({ error: "Bot not found or inactive" }, { status: 404 });
  }

  let status: "SENT" | "FAILED" = "SENT";
  let errorMessage: string | undefined;

  try {
    if (text) {
      await telegram.sendMessage(bot.botToken, mapping.telegramChatId, text);
    }
    for (const url of attachments) {
      if (/\.(jpe?g|png|gif|webp)$/i.test(url)) {
        await telegram.sendPhoto(bot.botToken, mapping.telegramChatId, url);
      } else {
        await telegram.sendDocument(bot.botToken, mapping.telegramChatId, url);
      }
    }
    if (!text && attachments.length === 0) {
      throw new Error("Outbound payload had no text or attachments to relay");
    }
  } catch (error) {
    status = "FAILED";
    errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("[Conversation Provider Outbound] Failed to relay to Telegram:", error);
  }

  await prisma.messageLog.create({
    data: {
      botId: bot.id,
      locationId,
      contactMappingId: mapping.id,
      direction: "OUTBOUND",
      contentType: attachments.length > 0 ? "document" : "text",
      textContent: text,
      mediaUrl: attachments[0],
      ghlMessageId: messageId,
      status,
      errorMessage,
    },
  });

  if (messageId) {
    const session = await sessionStorage.get(locationId);
    if (session) {
      try {
        await updateMessageDeliveryStatus(
          messageId,
          status === "SENT" ? "delivered" : "failed",
          session.accessToken,
        );
      } catch (e) {
        console.error("[Conversation Provider Outbound] Failed to update GHL message status:", e);
      }
    }
  }

  return NextResponse.json({ success: status === "SENT" });
}
```

- [ ] **Step 2: Verify**

```bash
npx tsc --noEmit
```

Expected: no errors referencing this file.

```bash
pnpm dev &
sleep 3
curl -s -X POST http://localhost:3000/api/ghl/conversation-provider/outbound -H "Content-Type: application/json" -d '{}'
kill %1
```

Expected: `{"error":"Missing locationId or contactId"}` with 400.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/ghl/conversation-provider
git commit -m "feat: add GHL Conversation Provider outbound webhook route"
```

---

### Task 8: Message log and retry API routes

**Files:**
- Create: `src/app/api/telegram/messages/route.ts`
- Create: `src/app/api/telegram/messages/[id]/retry/route.ts`

**Interfaces:**
- Consumes: `prisma` (Task 1); `sendMessage`/`sendDocument` (Task 3); `sessionStorage` (Task 2); `getOrCreateConversationId`/`pushInboundMessage` (Task 4).
- Produces: `GET /api/telegram/messages?locationId=&limit=&offset=` → `{ success: true, messages: MessageLogEntry[] }`. `POST /api/telegram/messages/[id]/retry` → `{ success: true }` or `{ error }`. Where `MessageLogEntry` matches the type Task 10 defines in `src/app/dashboard/types.ts`.

- [ ] **Step 1: Write the list route**

Create `src/app/api/telegram/messages/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { handleApiError } from "@/lib/api-utils";

export const runtime = "nodejs";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const locationId = request.nextUrl.searchParams.get("locationId");
    if (!locationId) {
      return NextResponse.json({ error: "locationId is required" }, { status: 400 });
    }

    const limit = Number(request.nextUrl.searchParams.get("limit") ?? "50");
    const offset = Number(request.nextUrl.searchParams.get("offset") ?? "0");

    const messages = await prisma.messageLog.findMany({
      where: { locationId },
      orderBy: { createdAt: "desc" },
      take: Math.min(limit, 100),
      skip: offset,
      include: { contactMapping: true },
    });

    return NextResponse.json({
      success: true,
      messages: messages.map((m) => ({
        id: m.id,
        direction: m.direction,
        contentType: m.contentType,
        textContent: m.textContent,
        mediaUrl: m.mediaUrl,
        status: m.status,
        errorMessage: m.errorMessage,
        createdAt: m.createdAt.toISOString(),
        contactName: m.contactMapping?.telegramName ?? null,
      })),
    });
  } catch (error) {
    return handleApiError(error, "Failed to fetch messages");
  }
}
```

- [ ] **Step 2: Write the retry route**

Create `src/app/api/telegram/messages/[id]/retry/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import * as telegram from "@/lib/telegram/client";
import { sessionStorage } from "@/lib/ghl/client";
import { getOrCreateConversationId, pushInboundMessage } from "@/lib/ghl/conversations";

export const runtime = "nodejs";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;

  const log = await prisma.messageLog.findUnique({
    where: { id },
    include: { contactMapping: true, bot: true },
  });

  if (!log || log.status !== "FAILED") {
    return NextResponse.json({ error: "Message not found or not retryable" }, { status: 404 });
  }

  const session = await sessionStorage.get(log.locationId);
  if (!session) {
    return NextResponse.json(
      { error: "GHL session expired — reconnect this location" },
      { status: 401 },
    );
  }

  try {
    if (!log.contactMapping) {
      return NextResponse.json({ error: "No contact mapping for this message" }, { status: 400 });
    }

    if (log.direction === "INBOUND") {
      const conversationId = await getOrCreateConversationId(log.contactMapping, session.accessToken);
      const { messageId } = await pushInboundMessage({
        conversationId,
        accessToken: session.accessToken,
        text: log.textContent ?? undefined,
        attachmentUrls: log.mediaUrl ? [log.mediaUrl] : undefined,
      });
      await prisma.messageLog.update({
        where: { id },
        data: { status: "SENT", errorMessage: null, ghlMessageId: messageId },
      });
    } else {
      if (log.textContent) {
        await telegram.sendMessage(log.bot.botToken, log.contactMapping.telegramChatId, log.textContent);
      }
      if (log.mediaUrl) {
        await telegram.sendDocument(log.bot.botToken, log.contactMapping.telegramChatId, log.mediaUrl);
      }
      await prisma.messageLog.update({
        where: { id },
        data: { status: "SENT", errorMessage: null },
      });
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: `Retry failed: ${errorMessage}` }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
```

- [ ] **Step 3: Verify**

```bash
npx tsc --noEmit
pnpm lint
```

Expected: clean for both new files.

```bash
pnpm dev &
sleep 3
curl -s "http://localhost:3000/api/telegram/messages"
curl -s -X POST "http://localhost:3000/api/telegram/messages/does-not-exist/retry"
kill %1
```

Expected: first → `{"error":"locationId is required"}` 400. Second → `{"error":"Message not found or not retryable"}` 404.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/telegram/messages
git commit -m "feat: add message log and retry API routes"
```

---

### Task 9: Remove old llms.txt code; add /api/session route

**Files:**
- Create: `src/app/api/session/route.ts`
- Delete: `src/app/api/llms/` (entire directory: `domains/route.ts`, `generate/route.ts`, `upload/route.ts`, `session/route.ts`)
- Delete: `src/lib/ghl/domains.ts`, `src/lib/ghl/funnels.ts`, `src/lib/ghl/llms-generator.ts`, `src/lib/ghl/media.ts`, `src/lib/ghl/redirects.ts`

**Interfaces:**
- Produces: `GET /api/session?locationId=` → `{ success: true, session: { locationId, locationName, userId, email } }` (identical contract to the old `/api/llms/session`, just relocated — this is what Task 13's `page.tsx` fetches for SSO bootstrap).

Nothing else in the codebase imports the five deleted `lib/ghl/*.ts` files or the deleted API routes by TypeScript `import` (routes are invoked over HTTP from dashboard components, not imported) — confirmed by the grep in Step 3.

- [ ] **Step 1: Move the session-info route**

Create `src/app/api/session/route.ts` with the same content as the current `src/app/api/llms/session/route.ts`:

```typescript
import { getActiveSession, handleApiError } from "@/lib/api-utils";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const locationId = request.nextUrl.searchParams.get("locationId") ?? undefined;

    const { session, errorResponse } = await getActiveSession(locationId);
    if (errorResponse) return errorResponse;

    return NextResponse.json({
      success: true,
      session: {
        locationId: session!.locationId,
        locationName: session!.locationName,
        userId: session!.userId,
        email: session!.email,
      },
    });
  } catch (error: unknown) {
    return handleApiError(error, "Failed to fetch session info");
  }
}
```

- [ ] **Step 2: Delete the old llms.txt lib files and API routes**

```bash
git rm -r src/app/api/llms
git rm src/lib/ghl/domains.ts src/lib/ghl/funnels.ts src/lib/ghl/llms-generator.ts src/lib/ghl/media.ts src/lib/ghl/redirects.ts
```

- [ ] **Step 3: Confirm nothing still references the deleted files**

```bash
grep -rn "lib/ghl/domains\|lib/ghl/funnels\|lib/ghl/llms-generator\|lib/ghl/media\|lib/ghl/redirects\|api/llms" src
```

Expected: no output. (`src/app/dashboard/components/GenerateForm.tsx`, `PreviewCard.tsx`, `ResultCard.tsx`, `StatusDisplay.tsx` still call `/api/llms/*` by URL string at runtime — that's fine, those components are deleted in Task 13 in the same pass that removes their last usages from `page.tsx`. This grep only checks TypeScript `import` relationships, which is what `tsc` cares about.)

- [ ] **Step 4: Verify**

```bash
npx tsc --noEmit
```

Expected: no new errors introduced by this task (any pre-existing errors about `GenerateResult`/`Status` types or old components are expected until Task 13 — this task doesn't touch those).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/session
git commit -m "chore: remove llms.txt-specific routes and libs, relocate session-info route"
```

---

### Task 10: Dashboard types

**Files:**
- Modify: `src/app/dashboard/types.ts`

**Interfaces:**
- Produces: `TelegramBot { id, botUsername, displayName: string | null, isActive, createdAt: string }`, `MessageLogEntry { id, direction: "INBOUND" | "OUTBOUND", contentType: string, textContent: string | null, mediaUrl: string | null, status: "SENT" | "FAILED", errorMessage: string | null, createdAt: string, contactName: string | null }`. `GHLSession` is unchanged. `GenerateResult`/`Status` are removed in Task 13 (kept for now so the not-yet-deleted old components still compile).

- [ ] **Step 1: Add the new types**

In `src/app/dashboard/types.ts`, keep `GHLSession`, `GenerateResult`, and `Status` exactly as they are, and append:

```typescript
export interface TelegramBot {
  id: string;
  botUsername: string;
  displayName: string | null;
  isActive: boolean;
  createdAt: string;
}

export interface MessageLogEntry {
  id: string;
  direction: "INBOUND" | "OUTBOUND";
  contentType: string;
  textContent: string | null;
  mediaUrl: string | null;
  status: "SENT" | "FAILED";
  errorMessage: string | null;
  createdAt: string;
  contactName: string | null;
}
```

- [ ] **Step 2: Verify**

```bash
npx tsc --noEmit
```

Expected: no new errors (this change is purely additive).

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboard/types.ts
git commit -m "feat: add TelegramBot and MessageLogEntry dashboard types"
```

---

### Task 11: BotList and AddBotDialog components

**Files:**
- Create: `src/app/dashboard/components/BotList.tsx`
- Create: `src/app/dashboard/components/AddBotDialog.tsx`
- Modify: `components.json`-driven shadcn components — adds `src/components/ui/dialog.tsx` and `src/components/ui/switch.tsx`

**Interfaces:**
- Consumes: `TelegramBot` type (Task 10). Calls `POST /api/telegram/bots` (Task 5).
- Produces: `<BotList bots={TelegramBot[]} onToggleActive={(botId, isActive) => void} onDelete={(botId) => void} />`, `<AddBotDialog locationId={string} onAdded={(bot: TelegramBot) => void} />` — both consumed by Task 13's `page.tsx`.

- [ ] **Step 1: Add the shadcn primitives this task needs**

```bash
pnpm dlx shadcn@latest add dialog switch
```

Expected: creates `src/components/ui/dialog.tsx` and `src/components/ui/switch.tsx` (this project's `components.json` uses the `base-nova` style, so these will be `@base-ui/react`-backed like the existing `button.tsx`/`input.tsx`). After it finishes, open the generated `src/components/ui/switch.tsx` and confirm the `onCheckedChange` prop signature is `(checked: boolean) => void` — that's what Step 2 below assumes; if the generated component differs, adjust the call site in `BotList.tsx` to match.

- [ ] **Step 2: Write BotList**

Create `src/app/dashboard/components/BotList.tsx`:

```tsx
"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Bot, Trash2 } from "lucide-react";
import { TelegramBot } from "../types";

interface BotListProps {
  bots: TelegramBot[];
  onToggleActive: (botId: string, isActive: boolean) => void;
  onDelete: (botId: string) => void;
}

export function BotList({ bots, onToggleActive, onDelete }: BotListProps) {
  if (bots.length === 0) {
    return (
      <Card className="w-full">
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          No Telegram bots connected yet. Add one below to start receiving messages in your Inbox.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {bots.map((bot) => (
        <Card key={bot.id} className="w-full">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Bot className="w-4 h-4 text-primary" />
              {bot.displayName || `@${bot.botUsername}`}
            </CardTitle>
            <Badge variant={bot.isActive ? "outline" : "secondary"} className="text-[10px] uppercase">
              {bot.isActive ? "Active" : "Paused"}
            </Badge>
          </CardHeader>
          <CardContent className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">@{bot.botUsername}</p>
            <div className="flex items-center gap-2">
              <Switch
                checked={bot.isActive}
                onCheckedChange={(checked: boolean) => onToggleActive(bot.id, checked)}
              />
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-destructive hover:text-destructive"
                onClick={() => onDelete(bot.id)}
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Write AddBotDialog**

Create `src/app/dashboard/components/AddBotDialog.tsx`:

```tsx
"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Plus } from "lucide-react";
import { useState } from "react";
import { TelegramBot } from "../types";

interface AddBotDialogProps {
  locationId: string;
  onAdded: (bot: TelegramBot) => void;
}

export function AddBotDialog({ locationId, onAdded }: AddBotDialogProps) {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!token.trim()) return;
    setSubmitting(true);
    setError(null);

    try {
      const resp = await fetch("/api/telegram/bots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          locationId,
          botToken: token.trim(),
          displayName: displayName.trim() || undefined,
        }),
      });
      const data = await resp.json();
      if (!resp.ok || !data.success) {
        setError(data.error ?? "Failed to add bot");
        return;
      }
      onAdded(data.bot);
      setToken("");
      setDisplayName("");
      setOpen(false);
    } catch {
      setError("Network error while adding bot");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button>
            <Plus className="w-4 h-4" />
            Add Telegram Bot
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Connect a Telegram Bot</DialogTitle>
          <DialogDescription>
            Paste the token you got from{" "}
            <code className="bg-muted px-1 py-0.5 rounded text-xs">@BotFather</code>. We&apos;ll
            validate it and set up the webhook automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="botToken">Bot Token *</Label>
            <Input
              id="botToken"
              type="password"
              placeholder="123456789:AAExampleTokenValueHere"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              disabled={submitting}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="displayName">Label (optional)</Label>
            <Input
              id="displayName"
              type="text"
              placeholder="Support Bot"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              disabled={submitting}
            />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button onClick={handleSubmit} disabled={submitting || !token.trim()}>
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Connecting…
              </>
            ) : (
              "Connect Bot"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Verify**

```bash
npx tsc --noEmit
pnpm lint
```

Expected: clean for these two new files and the two new `src/components/ui/*` files (neither `BotList` nor `AddBotDialog` is imported anywhere yet, so this is a pure additive compile check).

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/dialog.tsx src/components/ui/switch.tsx src/app/dashboard/components/BotList.tsx src/app/dashboard/components/AddBotDialog.tsx components.json
git commit -m "feat: add BotList and AddBotDialog dashboard components"
```

---

### Task 12: MessageActivity component

**Files:**
- Create: `src/app/dashboard/components/MessageActivity.tsx`

**Interfaces:**
- Consumes: `MessageLogEntry` type (Task 10). Calls `GET /api/telegram/messages` and `POST /api/telegram/messages/[id]/retry` (Task 8).
- Produces: `<MessageActivity locationId={string} />`, consumed by Task 13's `page.tsx`.

- [ ] **Step 1: Write the component**

Create `src/app/dashboard/components/MessageActivity.tsx`:

```tsx
"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowDownLeft, ArrowUpRight, Loader2, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { MessageLogEntry } from "../types";

export function MessageActivity({ locationId }: { locationId: string }) {
  const [messages, setMessages] = useState<MessageLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [retryingId, setRetryingId] = useState<string | null>(null);

  const loadMessages = async () => {
    setLoading(true);
    try {
      const resp = await fetch(`/api/telegram/messages?locationId=${encodeURIComponent(locationId)}`);
      const data = await resp.json();
      if (data.success) setMessages(data.messages);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMessages();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationId]);

  const handleRetry = async (id: string) => {
    setRetryingId(id);
    try {
      await fetch(`/api/telegram/messages/${id}/retry`, { method: "POST" });
      await loadMessages();
    } finally {
      setRetryingId(null);
    }
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="text-base">Recent Activity</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading messages…
          </div>
        ) : messages.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">No messages yet.</p>
        ) : (
          messages.map((m) => (
            <div
              key={m.id}
              className="flex items-start justify-between gap-3 py-2 border-b last:border-b-0 text-sm"
            >
              <div className="flex items-start gap-2 min-w-0">
                {m.direction === "INBOUND" ? (
                  <ArrowDownLeft className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
                ) : (
                  <ArrowUpRight className="w-4 h-4 text-green-500 shrink-0 mt-0.5" />
                )}
                <div className="min-w-0">
                  <p className="truncate">{m.textContent || `[${m.contentType}]`}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {m.contactName ?? "Unknown contact"} · {new Date(m.createdAt).toLocaleString()}
                  </p>
                </div>
              </div>
              <div className="shrink-0 flex items-center gap-2">
                <Badge variant={m.status === "FAILED" ? "outline" : "secondary"} className="text-[10px]">
                  {m.status}
                </Badge>
                {m.status === "FAILED" && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => handleRetry(m.id)}
                    disabled={retryingId === m.id}
                  >
                    {retryingId === m.id ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <RotateCcw className="w-3.5 h-3.5" />
                    )}
                  </Button>
                )}
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Verify**

```bash
npx tsc --noEmit
pnpm lint
```

Expected: clean (additive, not yet imported anywhere).

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboard/components/MessageActivity.tsx
git commit -m "feat: add MessageActivity dashboard component"
```

---

### Task 13: Wire the dashboard together; remove old components

**Files:**
- Modify: `src/app/dashboard/page.tsx` (full rewrite)
- Modify: `src/app/dashboard/components/Onboarding.tsx` (content rewrite)
- Modify: `src/app/dashboard/components/DashboardHeader.tsx` (branding text)
- Modify: `src/app/dashboard/types.ts` (remove `GenerateResult`, `Status`)
- Delete: `src/app/dashboard/components/GenerateForm.tsx`, `PreviewCard.tsx`, `ResultCard.tsx`, `StatusDisplay.tsx`

**Interfaces:**
- Consumes: `BotList` (Task 11), `AddBotDialog` (Task 11), `MessageActivity` (Task 12), `GHLSession`/`TelegramBot` types (Task 10), `GET /api/session` (Task 9), `GET /api/telegram/bots` (Task 5), `PATCH`/`DELETE /api/telegram/bots/[id]` (Task 5).

- [ ] **Step 1: Rewrite page.tsx**

Replace the full contents of `src/app/dashboard/page.tsx`:

```tsx
"use client";

/**
 * app/dashboard/page.tsx
 * -----------------------
 * GHL Custom Page — embedded as an iframe inside GoHighLevel.
 */

import { useEffect, useState } from "react";
import { AddBotDialog } from "./components/AddBotDialog";
import { BotList } from "./components/BotList";
import { DashboardHeader } from "./components/DashboardHeader";
import { MessageActivity } from "./components/MessageActivity";
import { Onboarding } from "./components/Onboarding";
import { PromoCard } from "./components/PromoCard";
import { GHLSession, TelegramBot } from "./types";

export default function DashboardPage() {
  const [session, setSession] = useState<GHLSession | null>(null);
  const [bots, setBots] = useState<TelegramBot[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");

  // ── Mount: attempt GHL SSO ─────────────────────────────────────────────────

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    let locationId = params.get("locationId");

    if (!locationId) {
      locationId = localStorage.getItem("ghl_location_id");
    }

    if (!locationId) {
      setErrorMsg("Could not obtain location context. Ensure the page is opened from within the CRM.");
      setLoading(false);
      return;
    }

    localStorage.setItem("ghl_location_id", locationId);

    fetch(`/api/session?locationId=${encodeURIComponent(locationId)}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.success && data.session) {
          setSession(data.session);
        } else {
          setSession({ locationId: locationId as string, userId: "user" });
        }
      })
      .catch(() => {
        setSession({ locationId: locationId as string, userId: "user" });
      })
      .finally(() => setLoading(false));
  }, []);

  // ── Load bots once we have a location ──────────────────────────────────────

  useEffect(() => {
    if (!session?.locationId) return;
    fetch(`/api/telegram/bots?locationId=${encodeURIComponent(session.locationId)}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.success) setBots(data.bots);
      });
  }, [session?.locationId]);

  const handleToggleActive = async (botId: string, isActive: boolean) => {
    setBots((prev) => prev.map((b) => (b.id === botId ? { ...b, isActive } : b)));
    await fetch(`/api/telegram/bots/${botId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive }),
    });
  };

  const handleDelete = async (botId: string) => {
    setBots((prev) => prev.filter((b) => b.id !== botId));
    await fetch(`/api/telegram/bots/${botId}`, { method: "DELETE" });
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <main className="min-h-screen bg-background flex flex-col">
      <DashboardHeader session={session} />

      <div className="flex-1 w-full p-4 md:p-8 flex flex-col gap-6 mx-auto max-w-6xl">
        {loading ? (
          <p className="text-sm text-muted-foreground text-center py-10">Loading…</p>
        ) : errorMsg ? (
          <p className="text-sm text-destructive text-center py-10">{errorMsg}</p>
        ) : session ? (
          <div className="grid grid-cols-1 md:grid-cols-[1fr,360px] gap-6 items-start">
            <div className="flex flex-col gap-6 w-full">
              <Onboarding />

              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">Your Bots</h2>
                <AddBotDialog
                  locationId={session.locationId}
                  onAdded={(bot) => setBots((prev) => [...prev, bot])}
                />
              </div>

              <BotList bots={bots} onToggleActive={handleToggleActive} onDelete={handleDelete} />

              <MessageActivity locationId={session.locationId} />
            </div>

            <aside className="w-full md:sticky md:top-4">
              <PromoCard />
            </aside>
          </div>
        ) : null}
      </div>

      <footer className="w-full text-center py-4 text-sm text-muted-foreground">
        Built by{" "}
        <a href="https://zeon.studio" target="_blank" rel="noopener">
          Zeon Studio
        </a>
        . Marketing Automation Agency
      </footer>
    </main>
  );
}
```

- [ ] **Step 2: Rewrite Onboarding content**

In `src/app/dashboard/components/Onboarding.tsx`, keep the component structure exactly as-is and replace only the `steps` array and the closing tip paragraph:

```typescript
  const steps = [
    {
      n: "1",
      title: "Create a Bot",
      desc: "Message @BotFather on Telegram, run /newbot, and copy the token it gives you.",
    },
    {
      n: "2",
      title: "Paste the Token",
      desc: 'Click "Add Telegram Bot" below and paste it in. We validate it and set up the webhook for you.',
    },
    {
      n: "3",
      title: "Reply from your Inbox",
      desc: "Messages from that bot now show up in your GHL Inbox as a Telegram conversation — reply right there.",
    },
  ];
```

And replace the closing `<p>` tip:

```tsx
        <p className="mt-6 text-xs text-center text-muted-foreground bg-background/40 py-2 rounded-md border border-primary/5">
          New Telegram contacts are created in GHL automatically the moment they message your bot.
        </p>
```

- [ ] **Step 3: Update DashboardHeader branding**

In `src/app/dashboard/components/DashboardHeader.tsx`, replace both occurrences of `"LLMS.txt Generator"` (the `alt` prop on line 17 and the `<span>` text on line 23) with `"Telegram for GHL"`.

- [ ] **Step 4: Remove the old generation-pipeline types**

In `src/app/dashboard/types.ts`, delete the `GenerateResult` interface and the `Status` type, leaving only `GHLSession`, `TelegramBot`, `MessageLogEntry`.

- [ ] **Step 5: Delete the old components**

```bash
git rm src/app/dashboard/components/GenerateForm.tsx
git rm src/app/dashboard/components/PreviewCard.tsx
git rm src/app/dashboard/components/ResultCard.tsx
git rm src/app/dashboard/components/StatusDisplay.tsx
```

- [ ] **Step 6: Verify**

```bash
npx tsc --noEmit
pnpm lint
```

Expected: **zero errors** — this is the task where the whole dashboard must compile clean end to end. If `tsc` reports a leftover reference to `GenerateResult`, `Status`, or one of the deleted components, grep for it and fix before moving on:

```bash
grep -rn "GenerateResult\|GenerateForm\|PreviewCard\|ResultCard\|StatusDisplay" src
```

Expected after fixes: no output.

- [ ] **Step 7: Manually smoke-test the dashboard shell in a browser**

```bash
pnpm dev
```

Visit `http://localhost:3000/dashboard?locationId=test-location-id` (a location that hasn't gone through OAuth will show the "ready" fallback session state, not a hard error — that's expected; the goal here is confirming the page renders without a React crash). Confirm: the header shows "Telegram for GHL", the Onboarding card shows the 3 Telegram steps, an empty "Your Bots" section with a working "Add Telegram Bot" dialog trigger, and a "Recent Activity" card showing "No messages yet."

- [ ] **Step 8: Commit**

```bash
git add src/app/dashboard
git commit -m "feat: wire Telegram dashboard UI, remove llms.txt-era components"
```

---

### Task 14: Update .env.example and README

**Files:**
- Modify: `.env.example`
- Modify: `README.md`

- [ ] **Step 1: Update .env.example**

Replace the full contents of `.env.example`:

```env
# GHL OAuth App Credentials
GHL_CLIENT_ID="your_ghl_client_id"
GHL_CLIENT_SECRET="your_ghl_client_secret"
GHL_REDIRECT_URI="http://localhost:3000/api/auth/callback"

# GHL Conversation Provider — from the Marketplace Developer Portal:
# App Settings > Conversation Providers > (create one) > copy its ID here.
GHL_CONVERSATION_PROVIDER_ID="your_conversation_provider_id"

# App Configuration
NEXT_PUBLIC_APP_URL="http://localhost:3000"

# Database Configuration (Postgres, via Prisma)
DATABASE_URL=""
```

- [ ] **Step 2: Rewrite README.md**

Replace the full contents of `README.md`:

```markdown
# Telegram for GHL

Two-way Telegram messaging inside your GoHighLevel Inbox. Connect one or more Telegram bots per
sub-account; messages from Telegram show up as a native conversation channel in the GHL Inbox, and
replies sent from the Inbox go straight back to Telegram.

## Features

- **OAuth 2.0 Integration:** Secure connection to GHL sub-accounts using the official
  `@gohighlevel/api-client`.
- **Multiple Bots per Location:** Connect as many Telegram bots as a sub-account needs, each
  independently managed.
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

### 3. Install Dependencies and Run Migrations

```bash
pnpm install
pnpm exec prisma migrate dev
```

### 4. Register a Conversation Provider

In the GHL Marketplace Developer Portal, open your app's settings → **Conversation Providers** →
create a new provider (name it "Telegram", add an icon). Set its **Delivery URL** to:

```
https://<your-domain>/api/ghl/conversation-provider/outbound
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
- **Support Email:** `zeonstudiohq@gmail.com`

### Scopes Required

- `conversations/message.readonly`
- `conversations/message.write`
- `contacts.readonly`
- `contacts.write`
- `locations.readonly`

---

## Project Structure

- `/app/api/auth`: OAuth initiation and callback handlers.
- `/app/api/session`: SSO session-info lookup used by the dashboard.
- `/app/api/telegram/bots`: Bot connect/list/toggle/disconnect endpoints.
- `/app/api/telegram/webhook/[secret]`: Receives inbound Telegram messages.
- `/app/api/telegram/messages`: Message log and retry endpoints.
- `/app/api/ghl/conversation-provider/outbound`: Receives GHL's outbound-reply webhook.
- `/app/dashboard`: The main GHL-integrated UI.
- `/app/privacy` & `/app/terms`: Legal documentation pages.
- `/lib/ghl`: GHL SDK wrappers, OAuth/session logic, contact/conversation helpers.
- `/lib/telegram`: Telegram Bot API client.
- `/prisma`: Database schema and migrations.

---

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

Developed with ❤️ by [Zeon Studio](https://zeon.studio).
```

- [ ] **Step 3: Verify**

```bash
grep -n "GHL_CONVERSATION_PROVIDER_ID" .env.example README.md
```

Expected: both files mention it.

- [ ] **Step 4: Commit**

```bash
git add .env.example README.md
git commit -m "docs: update README and env example for Telegram integration"
```

---

### Task 15: Manual end-to-end verification

This task has no code changes — it's the live-system proof the spec's Testing Approach section
calls for, and the point where Task 7's flagged payload-shape assumption gets confirmed against
reality.

**Files:** none.

- [ ] **Step 1: Expose localhost over HTTPS**

```bash
ngrok http 3000
```

(or `cloudflared tunnel --url http://localhost:3000`). Set `NEXT_PUBLIC_APP_URL` in `.env` to the
resulting HTTPS URL and restart `pnpm dev`.

- [ ] **Step 2: Complete the one-time GHL setup**

- Register the Conversation Provider in the Marketplace Developer Portal (Task 14, Step 2) with
  the delivery URL `https://<tunnel-domain>/api/ghl/conversation-provider/outbound`.
- Set `GHL_CONVERSATION_PROVIDER_ID` in `.env` from the value the portal gives you.
- Set the app's Custom Page iframe URL to `https://<tunnel-domain>/dashboard`.
- Restart `pnpm dev` so the new env vars are picked up.

- [ ] **Step 3: Connect a GHL sub-account**

Go through the OAuth flow from `/`, land on `/dashboard`, confirm the header shows the
connected location's name.

- [ ] **Step 4: Connect a real Telegram bot**

Create a bot via [@BotFather](https://t.me/BotFather) if you don't have a test one, copy its
token, and add it through the dashboard's "Add Telegram Bot" dialog. Confirm it appears in the
bot list as "Active."

- [ ] **Step 5: Send an inbound message**

From a personal Telegram account, message the bot with plain text. Watch the `pnpm dev` server
logs for `[Telegram Webhook]` output. Confirm:
- No `FAILED` errors logged.
- A new contact appears in the GHL location (Contacts).
- The message appears in the GHL Inbox as a Telegram-channel conversation.

Then send a photo and a document to the same bot and confirm both arrive as attachments in the
Inbox conversation, not just a text placeholder.

- [ ] **Step 6: Send an outbound reply**

From the GHL Inbox, reply to that conversation. Watch the server logs for
`[Conversation Provider Outbound] Raw payload:` — inspect the logged JSON.

**If the field names logged don't match `ConversationProviderOutboundPayload` in**
**`src/app/api/ghl/conversation-provider/outbound/route.ts` (Task 7), update that interface and**
**the `locationId`/`contactId`/`text`/`attachments`/`messageId` extraction lines to match the real**
**payload, then repeat this step.**

Confirm the reply arrives in the Telegram chat.

- [ ] **Step 7: Verify the retry path**

Temporarily set `GHL_CLIENT_SECRET` to an invalid value, restart the dev server, send another
Telegram message, and confirm it shows up as `FAILED` with an error in the dashboard's "Recent
Activity" list. Restore the correct `GHL_CLIENT_SECRET`, restart, and click the retry button on
that failed row — confirm it moves to a `SENT` state and the message shows up in the GHL Inbox.

- [ ] **Step 8: Disconnect a bot**

Delete the bot from the dashboard. Confirm it disappears from the list, and (optionally, via
`https://api.telegram.org/bot<token>/getWebhookInfo` in a browser) confirm Telegram no longer has
a webhook registered for that token.

Once all eight steps pass, the feature is functionally complete end to end.

---

## Plan Self-Review Notes

- **Spec coverage:** every section of `docs/superpowers/specs/2026-07-19-ghl-telegram-integration-design.md` maps to a task — Architecture → Tasks 1-9, Data Model → Task 1, GHL Side → Tasks 2, 4, 6, 7, Telegram Side → Tasks 3, 5, 6, Dashboard UI → Tasks 10-13, Edge Cases (dedupe, race, expired session, revoked token) → Task 6/7/8 code, Config → Task 14, Testing Approach → Task 15.
- **Placeholder scan:** no `TBD`/`TODO` left in this document; the one place code is a best-effort default rather than a confirmed contract (the outbound webhook payload shape, Task 7) is explicitly flagged in Global Constraints and re-surfaced as a concrete fix-it step in Task 15 rather than hidden.
- **Type consistency:** `TelegramBot`/`MessageLogEntry` shapes are defined once in Task 10 and referenced identically by Tasks 5, 8, 11, 12; `findOrCreateContactMapping`/`getOrCreateConversationId`/`pushInboundMessage`/`uploadMediaToGhl`/`updateMessageDeliveryStatus` are defined once in Task 4 and consumed with matching signatures by Tasks 6, 7, 8.

---

## Post-Implementation Amendments

All 15 tasks were executed via subagent-driven-development (implement-and-commit per task, no
per-task review, one consolidated final whole-branch review). Three corrections surfaced during
execution and one security gap surfaced during the final review — all fixed, documented here since
the task bodies above still show the original (in two cases, buggy) code:

1. **Prisma pinned to 6.x, not "latest."** Prisma 7 dropped `datasource.url` support in
   `schema.prisma` in favor of a `prisma.config.ts` + driver-adapter setup — a bigger shift than
   this plan's schema assumed. Task 1's `pnpm add` steps should read `@prisma/client@6` /
   `prisma@6` if re-run.
2. **`lib/ghl/contacts.ts` / `lib/ghl/conversations.ts` (Task 4) construction bug.** The plan's
   `new HighLevel({ locationAccessToken: accessToken })` throws `GHLError: Invalid configuration`
   at runtime — the SDK's constructor requires `clientId`+`clientSecret` or a
   `privateIntegrationToken` regardless of `locationAccessToken` being present. Both files now use
   a local `ghlClient(accessToken)` helper that also passes `clientId`/`clientSecret` (env vars
   already used elsewhere); the Authorization header still resolves to `locationAccessToken` per
   the SDK's own priority order, so behavior is otherwise unchanged.
3. **`AddBotDialog.tsx` (Task 11) `DialogTrigger` composition bug.** The plan's
   `<DialogTrigger asChild><Button>…</Button></DialogTrigger>` doesn't type-check — `asChild` is a
   Radix concept and doesn't exist on this project's base-ui-backed `DialogTrigger`. The fix is
   base-ui's own polymorphic API: `<DialogTrigger render={<Button>…</Button>} />` (same pattern
   already used by the generated `dialog.tsx`'s own `DialogClose`). Confirmed at the DOM level via
   browser smoke test — zero nested `<button>` elements.
4. **Missing authorization on several routes + unauthenticated outbound webhook (found by the**
   **final whole-branch review, not caught by any task).** `GET /api/telegram/bots`,
   `GET /api/telegram/messages`, and `PATCH`/`DELETE /api/telegram/bots/[id]` had no session gate —
   only `POST /api/telegram/bots` and the retry route did. Since `locationId` arrives as a plain,
   non-secret iframe query param, this let any caller who learned a connected `locationId` read
   that location's bots/messages or mutate/delete bots. Fixed by adding the same
   `getActiveSession(locationId)` gate used elsewhere to all four routes (fetching the bot row
   first in `PATCH`/`DELETE` to get its `locationId`). Separately,
   `POST /api/ghl/conversation-provider/outbound` (Task 7) had no authentication at all — anyone
   who guessed a valid `(locationId, contactId)` pair could relay arbitrary text to a real
   Telegram user. Fixed with a shared secret: a new `GHL_CONVERSATION_PROVIDER_WEBHOOK_SECRET` env
   var, checked against a `?secret=` query param on the registered Delivery URL (documented in
   `.env.example` and the README's Conversation Provider setup step). Also fixed in passing: the
   retry route's outbound branch always used `sendDocument` for media, so a retried photo arrived
   as a file attachment instead of inline — now uses the same photo/document extension heuristic
   as the primary outbound route. Note: this closes the most obvious gaps but is still
   `locationId`-trust-based, not a cryptographic verification of the calling GHL session — treat as
   sufficient for this template, not as a substitute for validating GHL's actual SSO signal before
   a real marketplace launch.

Also flagged by the final review as legitimate but explicitly deferred (not part of this pass):
`src/lib/scraper.ts` and the `cheerio` dependency were genuinely dead (only used by the deleted
llms.txt generator) and have been removed; but a handful of pre-existing "LLMS.txt Generator"
branding references in `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/terms/page.tsx`, and
`src/app/privacy/page.tsx` remain — out of scope for this plan (only the dashboard was), left for
a follow-up pass.

### Findings from the first live end-to-end test (Task 15)

Running the full flow against a real GHL location and Telegram bot surfaced several more issues,
all fixed:

- **`conversations.readonly`/`conversations.write` scopes were missing** — needed for
  `createConversation`/general conversation access, distinct from the `conversations/message.*`
  group already requested. Live 401 "token is not authorized for this scope."
- **`medias.readonly`/`medias.write` scopes were missing** — needed for the inbound media upload
  path (`uploadMediaToGhl`), never added when the scopes list was rewritten around
  conversations/contacts. Live 401 on the first photo message.
- **Pre-creating a conversation via `createConversation` doesn't work for custom providers.** A
  conversation created that way has no provider/type association, so posting into it fails with
  `CONVERSATIONS_MSG_CONVERSATION_PROVIDER_MISMATCH`. Fixed by dropping
  `getOrCreateConversationId` entirely — `pushInboundMessage` now sends `contactId` (not a
  pre-made `conversationId`) via the raw axios client (the SDK's typed `addAnInboundMessage()`
  doesn't expose `contactId`), letting GHL create/find a correctly-tagged conversation itself.
  `ContactMapping.ghlConversationId` is now an unused/dead column — left in place rather than
  doing a live schema migration mid-test.
- **`MESSAGE_TYPE` needed a second correction: `"Custom"`, not `"SMS"`.** `"CUSTOM"` (the original
  guess) fails enum validation; `"SMS"` passes enum validation but still hits the same provider
  mismatch, even for a brand-new contact with zero conversation history. GHL's docs for custom
  conversation providers specifically call for `type: "Custom"`.
- **Outbound relay needs a real error surfaced.** Bypassing the SDK for `pushInboundMessage` lost
  its automatic `GHLError` message extraction; a raw `AxiosError`'s `.message` is just "Request
  failed with status code 400". Now wraps and rethrows with `error.response.data` included.
- **The Conversation Provider's outbound payload shape is now confirmed** (resolving the flagged
  unknown from Task 7): `message` is a **plain string**, not the nested `{ body }` object
  originally guessed — `{ locationId, contactId, conversationId, messageId, type, message,
  attachments, userId, customUserId, timestamp, webhookId }`. `ConversationProviderOutboundPayload`
  and its extraction logic in `src/app/api/ghl/conversation-provider/outbound/route.ts` were
  updated to match.
- **`updateMessageStatus` rejects `status: "failed"` with 422 "error must be an object"** unless
  an `error` object is also included. `updateMessageDeliveryStatus` now takes an optional
  `errorMessage` and includes `{ error: { message } }` when marking a delivery failed.
- **GHL's Inbox reply composer defaults to "Internal Comment" mode**, which never triggers any
  Conversation Provider webhook — staff must explicitly switch the composer to the provider's own
  channel option before sending, or the message never leaves GHL. Also: the **"Always show this
  conversation provider?"** checkbox (unchecked by default when registering the provider) controls
  whether that channel option appears in the composer at all — without it, "Internal Comment" is
  the *only* option shown, so replies silently never reach the app no matter what the code does.
  Worth a callout in onboarding docs for anyone setting this up.
- **Naming the Conversation Provider literally "Telegram" appears to collide with GHL's own**
  **native, official Telegram Messaging Connector** (a separate first-party marketplace app) —
  produced a "No Telegram chat mapped" error (that connector's own error, unrelated to this app)
  when selecting it as the reply channel. Renaming the provider to "Telegram Bridge" resolved it.
  Worth naming any future custom provider something that doesn't collide with a native GHL
  integration name.
