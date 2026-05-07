import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/errors";
import { saveTemplateFromFormData } from "@/lib/services/template-editor.service";
import { listTemplateSummaries } from "@/lib/services/template.service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const template = await saveTemplateFromFormData(formData);
    const templates = await listTemplateSummaries();

    return NextResponse.json({
      success: true,
      template,
      templates
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
