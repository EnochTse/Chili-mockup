import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/errors";
import {
  assertLocalStudioRequest,
  getLocalTemplate
} from "@/lib/services/local-library.service";
import {
  loadTemplate,
  toTemplatePublicDto
} from "@/lib/services/template.service";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ slug: string }> }
) {
  try {
    assertLocalStudioRequest(request);
    const { slug } = await context.params;
    const requestUrl = new URL(request.url);
    const channel =
      requestUrl.searchParams.get("channel") === "latest" ? "latest" : "published";
    let result = await getLocalTemplate(slug, channel);
    if (!result && requestUrl.searchParams.get("repository") === "true") {
      result = {
        version: 0,
        template: toTemplatePublicDto(await loadTemplate(slug)),
        release: null,
        product: null
      };
    }

    return NextResponse.json({
      success: true,
      result
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
