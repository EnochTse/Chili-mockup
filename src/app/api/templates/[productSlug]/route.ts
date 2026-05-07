import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/errors";
import { loadTemplate, toTemplatePublicDto } from "@/lib/services/template.service";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ productSlug: string }> }
) {
  try {
    const { productSlug } = await context.params;
    const template = await loadTemplate(productSlug);

    return NextResponse.json({
      success: true,
      template: toTemplatePublicDto(template)
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
