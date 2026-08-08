/**
 * lib/media-limits.ts
 * -------------------
 * One cap, shared by both inbound paths (Bot API and MTProto).
 *
 * A relayed file is held whole in memory while it moves from Telegram to
 * GHL's media library, so the practical ceiling on a 512 MB instance sits
 * well below what either Telegram API will hand us: the Bot API caps getFile
 * downloads at 20 MB, but MTProto has no such cap and will happily stream a
 * 2 GB video straight into the heap.
 *
 * So the guard is not optional politeness — without it, one large upload
 * from any connected account OOM-kills the process for every tenant.
 */

const DEFAULT_MAX_MEDIA_MB = 15;

export function maxMediaBytes(): number {
  const configured = Number(process.env.MAX_MEDIA_MB);
  const mb = Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_MAX_MEDIA_MB;
  return Math.floor(mb * 1024 * 1024);
}

/**
 * Telegram reports sizes as plain numbers on the Bot API and as big-integer
 * objects over MTProto, and omits them entirely for some media types.
 * Unknown size returns undefined — callers treat that as "let the transfer
 * itself enforce the cap" rather than blocking the message.
 */
export function normalizeSize(
  size: number | { toJSNumber(): number } | undefined | null,
): number | undefined {
  if (size === undefined || size === null) return undefined;
  if (typeof size === "number") return Number.isFinite(size) ? size : undefined;
  if (typeof size === "object" && typeof size.toJSNumber === "function") {
    const asNumber = size.toJSNumber();
    return Number.isFinite(asNumber) ? asNumber : undefined;
  }
  return undefined;
}

export function isOverMediaLimit(size: number | undefined): boolean {
  return size !== undefined && size > maxMediaBytes();
}

/**
 * Shown for Telegram message kinds neither inbound path parses yet (stickers,
 * polls, locations, video notes, ...). Without it an unhandled type reaches
 * GHL with no text and no attachment, surfacing as a blank row in the Inbox
 * instead of something staff can act on.
 */
const UNSUPPORTED_PLACEHOLDER = "[Unsupported Telegram message type — check Telegram directly]";

/**
 * Builds the text pushed to the GHL Inbox for one inbound message. Shared by
 * the Bot API webhook and the MTProto handler, which differ only in where the
 * body text comes from — everything after that (appending a skipped-media
 * notice, falling back to the placeholder) has to stay identical between them.
 */
export function composeInboundText(
  body: string | undefined | null,
  mediaNotice: string | undefined,
  hasAttachment: boolean,
): string | undefined {
  const parts = [body, mediaNotice].filter((part): part is string => Boolean(part));
  if (parts.length > 0) return parts.join("\n\n");
  return hasAttachment ? undefined : UNSUPPORTED_PLACEHOLDER;
}

/** User-facing note pushed into the GHL Inbox in place of a skipped file. */
function tooLargeNotice(size: number | undefined): string {
  const limitMb = Math.round(maxMediaBytes() / (1024 * 1024));
  const actual = size !== undefined ? ` (${(size / (1024 * 1024)).toFixed(1)} MB)` : "";
  return `[Telegram attachment too large to relay${actual} — limit is ${limitMb} MB. View it in Telegram directly.]`;
}

/**
 * Carries no size field: callers only ever relay `message` into the Inbox,
 * and tooLargeNotice() has already folded the size into it.
 */
export class MediaTooLargeError extends Error {
  constructor(size?: number) {
    super(tooLargeNotice(size));
    this.name = "MediaTooLargeError";
  }
}
