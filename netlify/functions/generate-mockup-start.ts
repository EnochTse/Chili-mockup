import path from "node:path";
import { AppError } from "../../src/lib/errors";
import { resolveColorOption } from "../../src/lib/services/color-option.service";
import { createAiProvider } from "../../src/lib/services/ai.service";
import {
  normalizeProductFinishOption,
  resolvePartFinishSelection
} from "../../src/lib/services/finish-option.service";
import { buildMockupPrompt } from "../../src/lib/services/prompt.service";
import { getGeneratedOutputDir } from "../../src/lib/services/storage.service";
import { loadTemplate } from "../../src/lib/services/template.service";

interface GenerateMockupJsonBody {
  productSlug?: string;
  partPantones?: Record<string, string>;
  partFinishes?: Record<string, string>;
  logoPrintColor?: string;
  printingMethod?: string;
  removeBackground?: boolean;
  logoFile?: {
    fileName?: string;
    mimeType?: string;
    data?: string;
  };
}

const allowedLogoMimeTypes = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml"
]);

const allowedLogoExtensions = new Set([".png", ".jpg", ".jpeg", ".webp", ".svg"]);

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store"
    }
  });
}

function errorResponse(error: unknown) {
  if (error instanceof AppError) {
    return jsonResponse(
      {
        success: false,
        errorCode: error.errorCode,
        error: error.message
      },
      error.statusCode
    );
  }

  console.error(error);

  return jsonResponse(
    {
      success: false,
      errorCode: "AI_GENERATION_FAILED",
      error: "We could not start the mockup job. Please try again or contact Chili."
    },
    500
  );
}

function readRequiredString(value: unknown, errorCode = "INVALID_FORM_DATA") {
  if (typeof value !== "string" || !value.trim()) {
    throw new AppError(
      errorCode as any,
      "Please complete all required mockup fields.",
      400
    );
  }

  return value.trim();
}

function validatePartPantones(
  body: GenerateMockupJsonBody,
  template: Awaited<ReturnType<typeof loadTemplate>>
) {
  const raw = body.partPantones;
  const rawFinishes = body.partFinishes || {};
  if (!raw || typeof raw !== "object") {
    throw new AppError("INVALID_FORM_DATA", "Please complete all required mockup fields.", 400);
  }

  return template.colorParts.map((part) => {
    const pantoneCode = typeof raw[part.id] === "string" ? raw[part.id].trim() : "";
    if (!pantoneCode) {
      throw new AppError(
        "INVALID_FORM_DATA",
        `Please select a Pantone color for ${part.label}.`,
        400
      );
    }

    const pantone = resolveColorOption(template.pantoneOptions, pantoneCode);
    if (!pantone) {
      throw new AppError(
        "INVALID_PANTONE",
        "The selected Pantone color is not available for this product.",
        400
      );
    }

    const requestedFinish = rawFinishes[part.id];
    const normalizedRequestedFinish = normalizeProductFinishOption(requestedFinish);
    const hasRequestedFinish =
      typeof requestedFinish === "string" ? Boolean(requestedFinish.trim()) : Boolean(requestedFinish);

    if (hasRequestedFinish && !normalizedRequestedFinish) {
      throw new AppError(
        "INVALID_FORM_DATA",
        `The selected finish for ${part.label} is invalid.`,
        400
      );
    }

    if (
      normalizedRequestedFinish &&
      (!part.allowedFinishes || !part.allowedFinishes.includes(normalizedRequestedFinish))
    ) {
      throw new AppError(
        "INVALID_FORM_DATA",
        `The selected finish is not available for ${part.label}.`,
        400
      );
    }

    return {
      partId: part.id,
      partLabel: part.label,
      partDescription: part.description,
      instructionCue: part.instructionCue,
      instructionColorHex: part.instructionColorHex,
      pantoneCode,
      pantone,
      selectedFinish: resolvePartFinishSelection(part, requestedFinish)
    };
  });
}

function getMaxUploadSizeBytes() {
  const mb = Number(process.env.MAX_UPLOAD_SIZE_MB || "4");
  return Math.max(1, mb) * 1024 * 1024;
}

function validateLogoFromJson(body: GenerateMockupJsonBody) {
  const logo = body.logoFile;
  const fileName = readRequiredString(logo?.fileName, "INVALID_LOGO_FILE");
  const mimeType = readRequiredString(logo?.mimeType, "INVALID_LOGO_FILE");
  const data = readRequiredString(logo?.data, "INVALID_LOGO_FILE");
  const extension = path.extname(fileName).toLowerCase();

  if (!allowedLogoExtensions.has(extension) || !allowedLogoMimeTypes.has(mimeType)) {
    throw new AppError("INVALID_LOGO_FILE", "Please upload a valid logo file.", 400);
  }

  const bytes = Buffer.from(data, "base64");
  if (!bytes.length) {
    throw new AppError("INVALID_LOGO_FILE", "Please upload a valid logo file.", 400);
  }

  if (bytes.length > getMaxUploadSizeBytes()) {
    throw new AppError("LOGO_FILE_TOO_LARGE", "This logo file is too large.", 400);
  }

  return {
    logoFileName: fileName
  };
}

function showDebug() {
  return process.env.NODE_ENV === "development" || process.env.NEXT_PUBLIC_SHOW_DEBUG === "true";
}

export default async function handler(request: Request) {
  if (request.method !== "POST") {
    return jsonResponse(
      {
        success: false,
        errorCode: "INVALID_FORM_DATA",
        error: "Use POST to start a mockup job."
      },
      405
    );
  }

  try {
    const body = (await request.json()) as GenerateMockupJsonBody;
    const productSlug = readRequiredString(body.productSlug, "PRODUCT_TEMPLATE_NOT_FOUND");
    const logoPrintColor = readRequiredString(body.logoPrintColor);
    const printingMethod = readRequiredString(body.printingMethod);
    const template = await loadTemplate(productSlug);
    const selectedPartPantones = validatePartPantones(body, template);
    const validatedLogo = validateLogoFromJson(body);

    if (!template.allowedLogoPrintColors.includes(logoPrintColor)) {
      throw new AppError(
        "INVALID_LOGO_PRINT_COLOR",
        "The selected logo print color is not available for this product.",
        400
      );
    }

    if (!template.allowedPrintingMethods.includes(printingMethod)) {
      throw new AppError(
        "INVALID_PRINTING_METHOD",
        "The selected printing method is not available for this product.",
        400
      );
    }

    const prompt = buildMockupPrompt({
      template,
      selectedPartPantones,
      logoPrintColor,
      printingMethod
    });

    const result = await createAiProvider().createMockupJob({
      prompt,
      baseProductImagePath: template.baseProductImagePath,
      instructionImagePath: template.instructionImagePath,
      productSlug,
      outputDir: getGeneratedOutputDir()
    });

    return jsonResponse({
      success: true,
      jobName: result.jobName,
      state: result.state,
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
              logoFileName: validatedLogo.logoFileName,
              promptUsed: prompt
            }
          }
        : {})
    });
  } catch (error) {
    return errorResponse(error);
  }
}
