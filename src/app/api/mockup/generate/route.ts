import { NextResponse } from "next/server";
import { AppError, toErrorResponse } from "@/lib/errors";
import { createAiProvider } from "@/lib/services/ai.service";
import { buildMockupPrompt } from "@/lib/services/prompt.service";
import { getGeneratedOutputDir } from "@/lib/services/storage.service";
import { loadTemplate } from "@/lib/services/template.service";
import { validateMockupFormData } from "@/lib/services/validation.service";

export const runtime = "nodejs";

function showDebug() {
  return process.env.NODE_ENV === "development" || process.env.NEXT_PUBLIC_SHOW_DEBUG === "true";
}

function readProductSlug(formData: FormData) {
  const value = formData.get("productSlug");
  if (typeof value !== "string" || !value.trim()) {
    throw new AppError("PRODUCT_TEMPLATE_NOT_FOUND", "The product template could not be found.", 404);
  }

  return value.trim();
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const productSlug = readProductSlug(formData);
    const template = await loadTemplate(productSlug);
    const validated = validateMockupFormData(formData, template);
    const prompt = buildMockupPrompt({
      template,
      selectedPartPantones: validated.selectedPartPantones,
      logoPrintColor: validated.logoPrintColor,
      printingMethod: validated.printingMethod
    });

    const result = await createAiProvider().generateMockup({
      prompt,
      baseProductImagePath: template.baseProductImagePath,
      instructionImagePath: template.instructionImagePath,
      partMaskImagePaths: validated.selectedPartPantones
        .map((selection) => selection.partMaskImagePath)
        .filter(Boolean) as string[],
      productSlug,
      outputDir: getGeneratedOutputDir()
    });

    if (result.provider !== "gemini" || result.stubMode) {
      throw new AppError(
        "REAL_AI_REQUIRED",
        "Real Gemini image generation is required. Stub output is not allowed for generated mockups.",
        500
      );
    }

    return NextResponse.json({
      success: true,
      imageUrl: result.imageUrl,
      provider: result.provider,
      model: result.model,
      stubMode: result.stubMode,
      ...(showDebug()
        ? {
            debug: {
              provider: result.provider,
              model: result.model,
              stubMode: result.stubMode,
              templateId: template.id,
              productSlug,
              selectedPartPantones: validated.selectedPartPantones.map((selection) => ({
                partId: selection.partId,
                partLabel: selection.partLabel,
                pantoneCode: selection.pantoneCode
              })),
              baseImagePath: template.baseProductImagePath,
              baseProductImagePath: template.baseProductImagePath,
              instructionImagePath: template.instructionImagePath,
              partMaskImagePaths: validated.selectedPartPantones
                .map((selection) => selection.partMaskImagePath)
                .filter(Boolean),
              logoFileName: validated.logoFile.name,
              promptUsed: prompt
            }
          }
        : {})
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
