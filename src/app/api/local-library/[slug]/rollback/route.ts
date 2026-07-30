import { NextResponse } from "next/server";
import { AppError, toErrorResponse } from "@/lib/errors";
import {
  assertLocalStudioRequest,
  rollbackLocalProduct
} from "@/lib/services/local-library.service";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ slug: string }> }
) {
  try {
    assertLocalStudioRequest(request);
    const { slug } = await context.params;
    const payload = (await request.json()) as { version?: unknown };
    const version = Number(payload.version);
    if (!Number.isInteger(version) || version <= 0) {
      throw new AppError("INVALID_FORM_DATA", "Choose a valid release to restore.", 400);
    }

    return NextResponse.json(await rollbackLocalProduct(slug, version));
  } catch (error) {
    return toErrorResponse(error);
  }
}
