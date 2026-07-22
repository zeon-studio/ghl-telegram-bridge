export interface GHLSession {
  locationId: string;
  userId: string;
  companyId?: string;
  userName?: string;
  email?: string;
  locationName?: string;
}

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

export interface TelegramPhoneAccount {
  id: string;
  phoneNumber: string;
  telegramUsername: string | null;
  displayName: string | null;
  isActive: boolean;
  needsAttention: boolean;
  createdAt: string;
}
