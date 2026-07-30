import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/errors";
import {
  assertLocalStudioRequest,
  importLocalProductPackage
} from "@/lib/services/local-library.service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertLocalStudioRequest(request);
    return NextResponse.json(await importLocalProductPackage(await request.formData()));
  } catch (error) {
    return toErrorResponse(error);
  }
}
