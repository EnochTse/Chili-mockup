import { AppError, toErrorResponse } from "@/lib/errors";
import {
  assertLocalStudioRequest,
  buildLocalProductPackage
} from "@/lib/services/local-library.service";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ slug: string }> }
) {
  try {
    assertLocalStudioRequest(request);
    const { slug } = await context.params;
    const rawVersion = new URL(request.url).searchParams.get("version");
    const version = rawVersion ? Number(rawVersion) : undefined;
    if (version !== undefined && (!Number.isInteger(version) || version <= 0)) {
      throw new AppError("INVALID_FORM_DATA", "Invalid export version.", 400);
    }

    const productPackage = await buildLocalProductPackage(slug, version);
    return new Response(new Uint8Array(productPackage.buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${productPackage.fileName}"`,
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
