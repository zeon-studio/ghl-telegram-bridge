import { NextResponse } from "next/server";
import axios from "axios";
import { sessionStorage } from "@/lib/ghl/client";

export interface SessionData {
  locationId: string;
  accessToken: string;
  locationName?: string;
  userId?: string;
  email?: string;
}

/**
 * Wraps an API handler with standard error handling and formatting.
 */
export function handleApiError(
  error: unknown,
  defaultMessage = "API request failed",
): NextResponse {
  console.error("[API Error]", error);

  let status = 500;
  let message = defaultMessage;
  let details = null;

  if (axios.isAxiosError(error)) {
    const ghlError = error.response?.data;
    status = error.response?.status || 500;
    message = ghlError?.message || error.message || "External API error";
    details = ghlError?.errors || ghlError || null;
  } else if (error instanceof Error) {
    message = error.message;
  }

  return NextResponse.json(
    {
      success: false,
      error: message,
      details: details,
    },
    { status },
  );
}

/**
 * Validates `locationId` and retrieves the active session.
 */
export async function getActiveSession(locationId?: string): Promise<{
  session?: SessionData;
  errorResponse?: NextResponse;
}> {
  if (!locationId) {
    return {
      errorResponse: NextResponse.json(
        { error: "locationId is required" },
        { status: 400 },
      ),
    };
  }

  const session = await sessionStorage.get(locationId);
  if (!session) {
    return {
      errorResponse: NextResponse.json(
        {
          error: "No active session for this location. Please re-authorize.",
          code: "SESSION_NOT_FOUND",
        },
        { status: 401 },
      ),
    };
  }

  return {
    session: {
      locationId: session.locationId,
      accessToken: session.accessToken,
      locationName: session.locationName,
      userId: session.userId,
      email: session.email,
    },
  };
}
