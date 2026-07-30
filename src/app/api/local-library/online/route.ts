import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/errors";
import { assertLocalStudioRequest } from "@/lib/services/local-library.service";
import { getOnlinePublishConfiguration } from "@/lib/services/online-publish.service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    assertLocalStudioRequest(request);
    return NextResponse.json({
      success: true,
      configuration: getOnlinePublishConfiguration()
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
