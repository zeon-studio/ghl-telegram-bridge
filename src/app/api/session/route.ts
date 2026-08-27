import { getActiveSession, handleApiError } from "@/lib/api-utils";
import { agencySessionStorage } from "@/lib/ghl/client";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const locationId =
      request.nextUrl.searchParams.get("locationId") ?? undefined;
    const companyId =
      request.nextUrl.searchParams.get("companyId") ?? undefined;

    if (companyId && !locationId) {
      const agencySession = await agencySessionStorage.get(companyId);
      if (!agencySession) {
        return NextResponse.json(
          {
            error: "No active session for this agency. Please re-authorize.",
            code: "AGENCY_SESSION_NOT_FOUND",
          },
          { status: 401 },
        );
      }

      return NextResponse.json({
        success: true,
        isAgency: true,
        session: {
          companyId: agencySession.companyId,
          userId: agencySession.userId,
        },
      });
    }

    const { session, errorResponse } = await getActiveSession(locationId);
    if (errorResponse) return errorResponse;

    return NextResponse.json({
      success: true,
      isAgency: false,
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
