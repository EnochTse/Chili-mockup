import path from "node:path";
import { resolveColorOption } from "@/lib/services/color-option.service";
import { AppError } from "@/lib/errors";
import {
  normalizeProductFinishOption,
  resolvePartFinishSelection
} from "@/lib/services/finish-option.service";
import type { ResolvedProductTemplate, ValidatedMockupRequest } from "@/lib/types";

const allowedLogoMimeTypes = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml"
]);

const allowedLogoExtensions = new Set([".png", ".jpg", ".jpeg", ".webp", ".svg"]);

function readRequiredString(formData: FormData, field: string) {
  const value = formData.get(field);
  if (typeof value !== "string" || !value.trim()) {
    throw new AppError("INVALID_FORM_DATA", "Please complete all required mockup fields.", 400);
  }

  return value.trim();
}

function readOptionalBoolean(formData: FormData, field: string) {
  const value = formData.get(field);
  if (typeof value !== "string") return false;
  return value === "true" || value === "1" || value === "on";
}

function readOptionalJsonRecord(formData: FormData, field: string) {
  const value = formData.get(field);
  if (typeof value !== "string" || !value.trim()) {
    return {};
  }

  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    throw new AppError("INVALID_FORM_DATA", "Please complete all required mockup fields.", 400);
  }
}

function getMaxUploadSizeBytes() {
  const mb = Number(process.env.MAX_UPLOAD_SIZE_MB || "10");
  return Math.max(1, mb) * 1024 * 1024;
}

function validateLogoFile(value: FormDataEntryValue | null): File {
  if (!(value instanceof File) || value.size <= 0) {
    throw new AppError("INVALID_LOGO_FILE", "Please upload a valid logo file.", 400);
  }

  const extension = path.extname(value.name).toLowerCase();
  if (!allowedLogoExtensions.has(extension) || !allowedLogoMimeTypes.has(value.type)) {
    throw new AppError("INVALID_LOGO_FILE", "Please upload a valid logo file.", 400);
  }

  if (value.size > getMaxUploadSizeBytes()) {
    throw new AppError("LOGO_FILE_TOO_LARGE", "This logo file is too large.", 400);
  }

  return value;
}

function validatePartPantones(
  formData: FormData,
  template: ResolvedProductTemplate
) {
  const raw = formData.get("partPantones");
  if (typeof raw !== "string" || !raw.trim()) {
    throw new AppError("INVALID_FORM_DATA", "Please complete all required mockup fields.", 400);
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new AppError("INVALID_FORM_DATA", "Please complete all required mockup fields.", 400);
  }

  const rawPartFinishes = readOptionalJsonRecord(formData, "partFinishes");

  return template.colorParts.map((part) => {
    const rawValue = parsed[part.id];
    const pantoneCode = typeof rawValue === "string" ? rawValue.trim() : "";
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

    const requestedFinish = rawPartFinishes[part.id];
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

export function validateMockupFormData(
  formData: FormData,
  template: ResolvedProductTemplate
): ValidatedMockupRequest {
  const productSlug = readRequiredString(formData, "productSlug");
  const logoPrintColor = readRequiredString(formData, "logoPrintColor");
  const printingMethod = readRequiredString(formData, "printingMethod");
  const removeBackground = readOptionalBoolean(formData, "removeBackground");
  const logoFile = validateLogoFile(formData.get("logoFile"));

  if (productSlug !== template.slug) {
    throw new AppError("PRODUCT_TEMPLATE_NOT_FOUND", "The product template could not be found.", 404);
  }
  const selectedPartPantones = validatePartPantones(formData, template);

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

  return {
    productSlug,
    logoPrintColor,
    printingMethod,
    removeBackground,
    logoFile,
    selectedPartPantones
  };
}
