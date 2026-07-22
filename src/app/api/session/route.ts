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
