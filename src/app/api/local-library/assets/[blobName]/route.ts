import { toErrorResponse } from "@/lib/errors";
import {
  assertLocalStudioRequest,
  readLocalBlob
} from "@/lib/services/local-library.service";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ blobName: string }> }
) {
  try {
    assertLocalStudioRequest(request);
    const { blobName } = await context.params;
    const asset = await readLocalBlob(blobName);

    return new Response(new Uint8Array(asset.buffer), {
      status: 200,
      headers: {
        "Content-Type": asset.contentType,
        "Cache-Control": "private, max-age=31536000, immutable",
        "Cross-Origin-Resource-Policy": "same-origin",
        ETag: asset.etag,
        "X-Content-Type-Options": "nosniff"
      }
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
