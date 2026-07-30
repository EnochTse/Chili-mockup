import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/errors";
import {
  assertLocalStudioRequest,
  getLocalLibrarySnapshot,
  saveLocalReleaseFromFormData
} from "@/lib/services/local-library.service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    assertLocalStudioRequest(request);
    return NextResponse.json({
      success: true,
      snapshot: await getLocalLibrarySnapshot()
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    assertLocalStudioRequest(request);
    return NextResponse.json(await saveLocalReleaseFromFormData(await request.formData()));
  } catch (error) {
    return toErrorResponse(error);
  }
}
