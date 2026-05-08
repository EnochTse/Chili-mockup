import fs from "node:fs/promises";
import path from "node:path";
import { AppError } from "@/lib/errors";
import { loadTemplate, toTemplatePublicDto } from "@/lib/services/template.service";
import type { ProductColorPart, ProductSpecification, TemplatePublicDto } from "@/lib/types";

const slugPattern = /^[a-z0-9][a-z0-9-]*$/;
const hexColorPattern = /^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/;
const allowedImageMimeTypes = new Set(["image/png", "image/jpeg", "image/webp"]);
const allowedImageExtensions = new Set([".png", ".jpg", ".jpeg", ".webp"]);

const defaultLogoPrintColors = ["white", "black", "original", "pantone_match"];
const defaultPrintingMethods = [
  "silk_screen",
  "uv_print",
  "heat_transfer",
  "embroidery",
  "laser_engraving",
  "mirror_laser_engraving"
];

function normalizePartId(value: string, index: number) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || `part-${index + 1}`;
}

function validateImageFile(file: File | null, fieldName: string) {
  if (!file) return null;
  if (file.size <= 0) {
    throw new AppError("INVALID_TEMPLATE_ASSET", `The ${fieldName} file is empty.`, 400);
  }

  const extension = path.extname(file.name).toLowerCase();
  if (!allowedImageExtensions.has(extension) || !allowedImageMimeTypes.has(file.type)) {
    throw new AppError(
      "INVALID_TEMPLATE_ASSET",
      `The ${fieldName} must be a PNG, JPG, or WebP image.`,
      400
    );
  }

  return file;
}

function readRequiredString(formData: FormData, fieldName: string) {
  const value = formData.get(fieldName);
  if (typeof value !== "string" || !value.trim()) {
    throw new AppError("INVALID_FORM_DATA", "Please complete all required template fields.", 400);
  }

  return value.trim();
}

function readOptionalString(formData: FormData, fieldName: string) {
  const value = formData.get(fieldName);
  return typeof value === "string" ? value.trim() : "";
}

function parseJsonField<T>(formData: FormData, fieldName: string): T {
  const value = formData.get(fieldName);
  if (typeof value !== "string" || !value.trim()) {
    throw new AppError("INVALID_FORM_DATA", "Please complete all required template fields.", 400);
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    throw new AppError("INVALID_FORM_DATA", "Please complete all required template fields.", 400);
  }
}

function sanitizeSpecifications(raw: Array<{ label?: string; value?: string }>): ProductSpecification[] {
  return raw
    .map((specification) => ({
      label: (specification.label || "").trim(),
      value: (specification.value || "").trim()
    }))
    .filter((specification) => specification.label && specification.value);
}

function sanitizeColorParts(
  raw: Array<{
    id?: string;
    label?: string;
    description?: string;
    instructionCue?: string;
    instructionColorHex?: string;
    defaultPantoneCode?: string;
  }>
): ProductColorPart[] {
  const usedIds = new Set<string>();
  const parts = raw
    .map((part, index) => {
      const baseId = normalizePartId(part.id || part.label || "", index);
      let id = baseId;
      let suffix = 2;

      while (usedIds.has(id)) {
        id = `${baseId}-${suffix}`;
        suffix += 1;
      }
      usedIds.add(id);

      return {
        id,
        label: (part.label || "").trim() || `Part ${index + 1}`,
        description: (part.description || "").trim() || `Color-controlled region ${index + 1}.`,
        instructionCue: (part.instructionCue || "").trim() || undefined,
        instructionColorHex: (part.instructionColorHex || "").trim() || undefined,
        defaultPantoneCode: (part.defaultPantoneCode || "").trim() || undefined
      };
    })
    .filter((part) => part.label && part.description);

  if (!parts.length) {
    throw new AppError(
      "INVALID_FORM_DATA",
      "Please add at least one recolorable product part.",
      400
    );
  }

  for (const part of parts) {
    if (part.instructionColorHex && !hexColorPattern.test(part.instructionColorHex)) {
      throw new AppError(
        "INVALID_FORM_DATA",
        `Instruction color for ${part.label} must use a hex value such as #1450FF.`,
        400
      );
    }
  }

  return parts;
}

async function writeFileFromUpload(targetPath: string, file: File) {
  const bytes = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(targetPath, bytes);
}

async function ensureDirectory(targetPath: string) {
  await fs.mkdir(targetPath, { recursive: true });
}

async function exists(targetPath: string) {
  try {
    await fs.stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function saveTemplateFromFormData(formData: FormData): Promise<TemplatePublicDto> {
  const originalSlug = readOptionalString(formData, "originalSlug");
  const slug = readRequiredString(formData, "slug");
  const name = readRequiredString(formData, "name");
  const category = readRequiredString(formData, "category");
  const description = readRequiredString(formData, "description");
  const size = readOptionalString(formData, "size");
  const specifications = sanitizeSpecifications(
    parseJsonField<Array<{ label?: string; value?: string }>>(formData, "specifications")
  );
  const colorParts = sanitizeColorParts(
    parseJsonField<
      Array<{
        id?: string;
        label?: string;
        description?: string;
        instructionCue?: string;
        instructionColorHex?: string;
        defaultPantoneCode?: string;
      }>
    >(formData, "colorParts")
  );
  const baseImage = validateImageFile(formData.get("baseImage") as File | null, "base image");
  const instructionImage = validateImageFile(
    formData.get("instructionImage") as File | null,
    "instruction image"
  );

  if (!slugPattern.test(slug)) {
    throw new AppError(
      "INVALID_FORM_DATA",
      "The product slug must use lowercase letters, numbers, and hyphens only.",
      400
    );
  }

  if (originalSlug && originalSlug !== slug) {
    throw new AppError(
      "INVALID_FORM_DATA",
      "Changing the product slug is not supported in the setup UI yet.",
      400
    );
  }

  const templateDir = path.resolve(process.cwd(), "src", "lib", "templates", slug);
  const assetDir = path.resolve(process.cwd(), "public", "mockup-templates", slug);
  await ensureDirectory(templateDir);
  await ensureDirectory(assetDir);

  const existingTemplate = originalSlug && (await exists(path.resolve(templateDir, "template.json")))
    ? await loadTemplate(slug)
    : null;

  let baseImageFileName = existingTemplate?.baseImageFileName || "";
  let instructionImageFileName = existingTemplate?.instructionImageFileName || "";

  if (baseImage) {
    baseImageFileName = `base-product-${Date.now()}${path.extname(baseImage.name).toLowerCase()}`;
    await writeFileFromUpload(path.resolve(assetDir, baseImageFileName), baseImage);
  }

  if (instructionImage) {
    instructionImageFileName = `instruction-image-${Date.now()}${path.extname(instructionImage.name).toLowerCase()}`;
    await writeFileFromUpload(path.resolve(assetDir, instructionImageFileName), instructionImage);
  }

  if (!baseImageFileName || !instructionImageFileName) {
    throw new AppError(
      "INVALID_TEMPLATE_ASSET",
      "Please upload both the product image and the instruction image for a new product.",
      400
    );
  }

  const template = {
    id: slug,
    slug,
    name,
    category,
    description,
    ...(size ? { size } : {}),
    specifications,
    assetFolderPublicPath: `/mockup-templates/${slug}`,
    baseImageFileName,
    instructionImageFileName,
    usageType: "visual_reference_only" as const,
    allowedLogoPrintColors: existingTemplate?.allowedLogoPrintColors || defaultLogoPrintColors,
    defaultLogoPrintColor: existingTemplate?.defaultLogoPrintColor || "white",
    allowedPrintingMethods: existingTemplate?.allowedPrintingMethods || defaultPrintingMethods,
    pantoneLibrary: "pantone-solid-coated-v3",
    colorParts,
    logoPlacement:
      existingTemplate?.logoPlacement || {
        description: "Place the logo only inside the marked safe area from the instruction image.",
        maxWidthMm: 120,
        maxHeightMm: 45,
        notes: "Visual reference only; final artwork must be confirmed by Chili design team."
      },
    constraints:
      existingTemplate?.constraints || {
        preserveBackground: true,
        preserveLighting: true,
        preserveProductShape: true,
        preserveMaterialTexture: true,
        allowOnlyDefinedRecolorRegion: true,
        allowOnlyDefinedLogoRegion: true,
        noPeople: true,
        noExtraProps: true,
        noExtraBranding: true,
        noExtraTextExceptLogo: true
      }
  };

  await fs.writeFile(
    path.resolve(templateDir, "template.json"),
    `${JSON.stringify(template, null, 2)}\n`,
    "utf8"
  );

  return toTemplatePublicDto(await loadTemplate(slug));
}
