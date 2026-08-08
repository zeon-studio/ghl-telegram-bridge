/**
 * lib/telegram/client.ts
 * -----------------------
 * Thin wrapper around the Telegram Bot HTTP API.
 * https://core.telegram.org/bots/api
 */

import axios from "axios";
import {
  MediaTooLargeError,
  isOverMediaLimit,
  maxMediaBytes,
  normalizeSize,
} from "@/lib/media-limits";

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

export interface TelegramVideo {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
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
  video?: TelegramVideo;
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

// Internal to this module — callers go through downloadFileWithinLimit, which
// is the only form that applies the size cap.
async function getFile(token: string, fileId: string): Promise<TelegramFile> {
  const resp = await axios.post(apiUrl(token, "getFile"), { file_id: fileId });
  return resp.data.result;
}

function getFileDownloadUrl(token: string, filePath: string): string {
  return `${TELEGRAM_API_BASE}/file/bot${token}/${filePath}`;
}

async function downloadFile(token: string, filePath: string): Promise<Buffer> {
  const limit = maxMediaBytes();
  const resp = await axios.get(getFileDownloadUrl(token, filePath), {
    responseType: "arraybuffer",
    // Backstop for the size check callers do up front: `file_size` is
    // optional on every Bot API media type, so a file whose size Telegram
    // didn't report would otherwise land in the heap unchecked. axios aborts
    // the transfer once the body exceeds this.
    maxContentLength: limit,
    maxBodyLength: limit,
  });
  // axios's Node adapter already returns a Buffer for responseType
  // "arraybuffer"; Buffer.from() would allocate and memcpy a second full-size
  // copy, doubling peak memory for every attachment relayed.
  return Buffer.isBuffer(resp.data) ? resp.data : Buffer.from(resp.data);
}

/**
 * getFile + downloadFile with the size cap applied before a single byte is
 * buffered. Throws MediaTooLargeError so callers can relay a note to the
 * Inbox instead of dropping the message on the floor.
 */
export async function downloadFileWithinLimit(
  token: string,
  fileId: string,
  declaredSize?: number,
): Promise<Buffer> {
  if (isOverMediaLimit(declaredSize)) {
    throw new MediaTooLargeError(declaredSize);
  }

  const file = await getFile(token, fileId);
  // getFile's own file_size is authoritative where the message-level one was
  // absent — check it too before committing to the download.
  const size = normalizeSize(file.file_size) ?? declaredSize;
  if (isOverMediaLimit(size)) {
    throw new MediaTooLargeError(size);
  }
  if (!file.file_path) {
    throw new Error(`Telegram returned no file_path for file_id ${fileId}`);
  }

  try {
    return await downloadFile(token, file.file_path);
  } catch (error) {
    // axios reports the maxContentLength abort as a generic message; convert
    // it so the caller's MediaTooLargeError branch handles it uniformly.
    if (axios.isAxiosError(error) && /maxContentLength|maxBodyLength/i.test(error.message)) {
      throw new MediaTooLargeError(size);
    }
    throw error;
  }
}
