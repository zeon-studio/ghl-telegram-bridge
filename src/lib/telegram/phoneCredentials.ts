/**
 * TELEGRAM_API_ID/TELEGRAM_API_HASH are optional at the process level —
 * the app must start and the Bot flow must work fully without them.
 * Every Phone Account code path checks isPhoneAccountEnabled() first.
 */

export function isPhoneAccountEnabled(): boolean {
  return Boolean(process.env.TELEGRAM_API_ID) && Boolean(process.env.TELEGRAM_API_HASH);
}

export function getTelegramApiCredentials(): { apiId: number; apiHash: string } {
  const apiId = Number(process.env.TELEGRAM_API_ID);
  const apiHash = process.env.TELEGRAM_API_HASH;
  if (!apiId || !apiHash) {
    throw new Error("TELEGRAM_API_ID/TELEGRAM_API_HASH are not configured");
  }
  return { apiId, apiHash };
}
