/**
 * lib/ghl/conversations.ts
 * --------------------------
 * Pushes Telegram messages into a location's GHL Inbox via the
 * registered Conversation Provider, and uploads Telegram media to the
 * GHL Media Library so GHL gets a stable, non-expiring attachment URL.
 */

import HighLevel from "@gohighlevel/api-client";
import axios from "axios";
import FormData from "form-data";
import { getGhlClient } from "./client";

const CONVERSATION_PROVIDER_ID = process.env.GHL_CONVERSATION_PROVIDER_ID!;

// GHL's `type` value for a message sent through a custom Conversation
// Provider. Confirmed via live testing this is neither "CUSTOM" (422 "type
// must be a valid enum value" — wrong casing/value) nor "SMS" (passes enum
// validation but 400s with CONVERSATIONS_MSG_CONVERSATION_PROVIDER_MISMATCH,
// even for a brand-new contact with zero conversation history — SMS is
// reserved for the default Twilio provider or SMS-replacement providers,
// not ones registered with "Is this a custom conversation provider?"
// checked). GHL's docs for custom providers specifically call for "Custom".
const MESSAGE_TYPE = "Custom";

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

export async function pushInboundMessage(params: {
  contactId: string;
  locationId: string;
  accessToken: string;
  text?: string;
  attachmentUrls?: string[];
}): Promise<{ messageId: string; conversationId: string }> {
  // Deliberately NOT using ghl.conversations.createConversation() first: a
  // conversation created that way has no provider/type tagged on it, so
  // posting a message into it fails live with "Incorrect
  // conversationProviderId/type" (CONVERSATIONS_MSG_CONVERSATION_PROVIDER_MISMATCH).
  // Passing contactId instead of conversationId lets GHL create (or find) a
  // conversation that's correctly associated with this provider from the
  // start. The SDK's typed addAnInboundMessage() doesn't expose a contactId
  // field, so this goes through the raw axios client instead.
  const client = getGhlClient(params.accessToken);
  try {
    const resp = await client.post("/conversations/messages/inbound", {
      type: MESSAGE_TYPE,
      contactId: params.contactId,
      locationId: params.locationId,
      conversationProviderId: CONVERSATION_PROVIDER_ID,
      message: params.text,
      attachments: params.attachmentUrls,
      date: new Date().toISOString(),
    });
    return { messageId: resp.data.messageId, conversationId: resp.data.conversationId };
  } catch (error) {
    if (axios.isAxiosError(error)) {
      throw new Error(
        `GHL addAnInboundMessage failed (${error.response?.status}): ${JSON.stringify(error.response?.data)}`,
      );
    }
    throw error;
  }
}

export async function updateMessageDeliveryStatus(
  messageId: string,
  status: "delivered" | "failed",
  accessToken: string,
  errorMessage?: string,
): Promise<void> {
  const ghl = ghlClient(accessToken);
  await ghl.conversations.updateMessageStatus(
    { messageId },
    // GHL rejects `status: "failed"` with 422 "error must be an object"
    // unless an `error` object is also present — confirmed via live testing.
    status === "failed"
      ? { status, error: { message: errorMessage ?? "Delivery failed" } }
      : { status },
  );
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
