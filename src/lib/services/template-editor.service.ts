import fs from "node:fs/promises";
import path from "node:path";
import { AppError } from "@/lib/errors";
import {
  normalizeProductFinishOption,
  productFinishOptions,
  resolvePartDefaultFinish,
  sanitizeAllowedFinishes
} from "@/lib/services/finish-option.service";
import { loadTemplate, toTemplatePublicDto } from "@/lib/services/template.service";
import type {
  LayeredMaterialMapKey,
  LayeredRenderConfig,
  LayeredRenderFinishRule,
  LogoOrientationPreset,
  PartIndicatorAnchor,
  ProductColorPart,
  ProductFinishOption,
  ProductSpecification,
  TemplatePublicDto
} from "@/lib/types";

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

const layeredMaterialMapKeys: LayeredMaterialMapKey[] = [
  "base",
  "shadow",
  "highlight",
  "texture",
  "specular",
  "edgeAo"
];

const defaultLayeredFinishRules: Record<ProductFinishOption, LayeredRenderFinishRule> = {
  matte: {
    colorOpacity: 0.98,
    blendMode: "source-over",
    highlightProtection: 0.18,
    textureStrength: 0.16,
    saturationBoost: 0.06
  },
  glossy: {
    colorOpacity: 0.97,
    blendMode: "source-over",
    highlightProtection: 0.28,
    textureStrength: 0.18,
    saturationBoost: 0.08
  },
  rubber: {
    colorOpacity: 0.98,
    blendMode: "source-over",
    highlightProtection: 0.2,
    textureStrength: 0.18,
    saturationBoost: 0.06
  },
  metallic: {
    colorOpacity: 0.96,
    blendMode: "source-over",
    highlightProtection: 0.34,
    textureStrength: 0.2,
    saturationBoost: 0.04
  },
  chrome: {
    colorOpacity: 0.16,
    blendMode: "source-over",
    highlightProtection: 0.72,
    textureStrength: 0.34,
    saturationBoost: 0
  }
};

type LayeredRenderFormPayload = {
  enabled?: unknown;
  mode?: unknown;
  outputSize?: {
    width?: unknown;
    height?: unknown;
  };
  fallbackFinish?: unknown;
  finishBaseImages?: Partial<Record<ProductFinishOption, unknown>>;
  materialMaps?: Partial<Record<ProductFinishOption, Partial<Record<LayeredMaterialMapKey, unknown>>>>;
  partMasks?: Record<string, unknown>;
  finishRules?: Partial<Record<ProductFinishOption, Partial<LayeredRenderFinishRule>>>;
};

type LogoPlacementFormPayload = {
  orientationPreset?: unknown;
  printingAreaImages?: Record<string, unknown>;
};

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

function parseOptionalJsonField<T>(formData: FormData, fieldName: string): T | undefined {
  const value = formData.get(fieldName);
  if (typeof value !== "string" || !value.trim()) return undefined;

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
    partMaskImageFileName?: string;
    defaultPantoneCode?: string;
    allowedFinishes?: unknown;
    defaultFinish?: string;
    indicatorAnchors?: Array<{
      id?: string;
      targetXPercent?: number | string;
      targetYPercent?: number | string;
      labelOffsetXPercent?: number | string;
      labelOffsetYPercent?: number | string;
    }>;
  }>
): ProductColorPart[] {
  const usedIds = new Set<string>();
  function sanitizeIndicatorAnchors(
    anchors: Array<{
      id?: string;
      targetXPercent?: number | string;
      targetYPercent?: number | string;
      labelOffsetXPercent?: number | string;
      labelOffsetYPercent?: number | string;
    }> | undefined,
    partIndex: number
  ): PartIndicatorAnchor[] | undefined {
    if (!anchors?.length) return undefined;

    const normalized = anchors
      .slice(0, 3)
      .map((anchor, anchorIndex) => {
        const targetXPercent = Number(anchor.targetXPercent);
        const targetYPercent = Number(anchor.targetYPercent);
        const labelOffsetXPercent = Number(anchor.labelOffsetXPercent ?? 0);
        const labelOffsetYPercent = Number(anchor.labelOffsetYPercent ?? 0);

        if (
          !Number.isFinite(targetXPercent) ||
          !Number.isFinite(targetYPercent) ||
          targetXPercent < 0 ||
          targetXPercent > 100 ||
          targetYPercent < 0 ||
          targetYPercent > 100
        ) {
          throw new AppError(
            "INVALID_FORM_DATA",
            `Indicator target position for part ${partIndex + 1} must be between 0 and 100.`,
            400
          );
        }

        if (
          !Number.isFinite(labelOffsetXPercent) ||
          !Number.isFinite(labelOffsetYPercent) ||
          labelOffsetXPercent < -100 ||
          labelOffsetXPercent > 100 ||
          labelOffsetYPercent < -100 ||
          labelOffsetYPercent > 100
        ) {
          throw new AppError(
            "INVALID_FORM_DATA",
            `Indicator label offset for part ${partIndex + 1} must be between -100 and 100.`,
            400
          );
        }

        return {
          id:
            (anchor.id || "").trim() ||
            `part-${partIndex + 1}-indicator-${anchorIndex + 1}`,
          targetXPercent,
          targetYPercent,
          labelOffsetXPercent,
          labelOffsetYPercent
        };
      });

    return normalized.length ? normalized : undefined;
  }

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
        partMaskImageFileName: (part.partMaskImageFileName || "").trim() || undefined,
        defaultPantoneCode: (part.defaultPantoneCode || "").trim() || undefined,
        allowedFinishes: sanitizeAllowedFinishes(part.allowedFinishes),
        defaultFinish: resolvePartDefaultFinish({
          allowedFinishes: sanitizeAllowedFinishes(part.allowedFinishes),
          defaultFinish: part.defaultFinish
        }),
        indicatorAnchors: sanitizeIndicatorAnchors(part.indicatorAnchors, index)
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
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
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

function buildPartMaskAssetFileName(partId: string, file: File, index: number) {
  const extension = path.extname(file.name).toLowerCase();
  return `layered/${partId}-mask-${Date.now()}-${index + 1}${extension}`;
}

function buildFinishBaseAssetFileName(finish: ProductFinishOption, file: File) {
  const extension = path.extname(file.name).toLowerCase();
  return `layered/${finish}-base-${Date.now()}${extension}`;
}

function buildPrintingAreaAssetFileName(method: string, file: File) {
  const extension = path.extname(file.name).toLowerCase();
  const safeMethod =
    method
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "printing-area";

  return `printing/${safeMethod}-area-${Date.now()}${extension}`;
}

function decodeAssetPath(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizeTemplateAssetReference(
  assetFolderPublicPath: string,
  assetReference: unknown,
  fieldName: string
) {
  if (typeof assetReference !== "string") return undefined;

  const normalized = assetReference.trim().replace(/\\/g, "/");
  if (!normalized) return undefined;

  const assetFolder = assetFolderPublicPath.replace(/\/$/, "");
  if (normalized.startsWith(`${assetFolder}/`)) {
    return decodeAssetPath(normalized.slice(assetFolder.length + 1));
  }

  if (normalized.startsWith("/")) {
    throw new AppError(
      "INVALID_FORM_DATA",
      `${fieldName} must point to this product's asset folder.`,
      400
    );
  }

  return decodeAssetPath(normalized.replace(/^\/+/, ""));
}

function normalizeLayeredOutputSize(raw: LayeredRenderFormPayload | undefined) {
  const width = Number(raw?.outputSize?.width);
  const height = Number(raw?.outputSize?.height);

  if (!Number.isFinite(width) || !Number.isFinite(height)) return undefined;
  if (width <= 0 || height <= 0) return undefined;

  return {
    width: Math.round(width),
    height: Math.round(height)
  };
}

function buildLayeredFinishRules(
  finishes: ProductFinishOption[],
  rawRules: LayeredRenderFormPayload["finishRules"]
): Partial<Record<ProductFinishOption, LayeredRenderFinishRule>> {
  const rules: Partial<Record<ProductFinishOption, LayeredRenderFinishRule>> = {};

  for (const finish of finishes) {
    const rawRule = rawRules?.[finish];
    rules[finish] = {
      ...defaultLayeredFinishRules[finish],
      ...(typeof rawRule?.colorOpacity === "number"
        ? { colorOpacity: Math.min(1, Math.max(0, rawRule.colorOpacity)) }
        : {}),
      ...(typeof rawRule?.highlightProtection === "number"
        ? { highlightProtection: Math.min(1, Math.max(0, rawRule.highlightProtection)) }
        : {}),
      ...(typeof rawRule?.textureStrength === "number"
        ? { textureStrength: Math.min(1, Math.max(0, rawRule.textureStrength)) }
        : {}),
      ...(typeof rawRule?.saturationBoost === "number"
        ? { saturationBoost: Math.min(0.5, Math.max(0, rawRule.saturationBoost)) }
        : {})
    };
  }

  return rules;
}

function normalizeLogoOrientationPreset(value: unknown): LogoOrientationPreset | undefined {
  return value === "vertical" || value === "horizontal" ? value : undefined;
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
        partMaskImageFileName?: string;
        defaultPantoneCode?: string;
        allowedFinishes?: unknown;
        defaultFinish?: string;
        indicatorAnchors?: Array<{
          id?: string;
          targetXPercent?: number | string;
          targetYPercent?: number | string;
          labelOffsetXPercent?: number | string;
          labelOffsetYPercent?: number | string;
        }>;
      }>
    >(formData, "colorParts")
  );
  const layeredRenderForm = parseOptionalJsonField<LayeredRenderFormPayload>(
    formData,
    "layeredRender"
  );
  const logoPlacementForm = parseOptionalJsonField<LogoPlacementFormPayload>(
    formData,
    "logoPlacement"
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

  const assetFolderPublicPath = `/mockup-templates/${slug}`;
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

  const colorPartsWithUploadedMasks = colorParts.map((part) => ({
    ...part,
    partMaskImageFileName: normalizeTemplateAssetReference(
      assetFolderPublicPath,
      part.partMaskImageFileName,
      `${part.label} part reference image`
    )
  }));

  for (const [index, part] of colorPartsWithUploadedMasks.entries()) {
    const uploadedPartMask = validateImageFile(
      formData.get(`partMaskImage:${index}`) as File | null,
      `part mask image for ${part.label}`
    );

    if (!uploadedPartMask) {
      continue;
    }

    const partMaskImageFileName = buildPartMaskAssetFileName(part.id, uploadedPartMask, index);
    await writeFileFromUpload(path.resolve(assetDir, partMaskImageFileName), uploadedPartMask);
    colorPartsWithUploadedMasks[index] = {
      ...part,
      partMaskImageFileName
    };
  }

  let layeredRender: LayeredRenderConfig | undefined;
  if (layeredRenderForm?.enabled) {
    const finishBaseImages: Partial<Record<ProductFinishOption, string>> = {};
    const rawFinishBaseImages = layeredRenderForm.finishBaseImages || {};

    for (const finish of productFinishOptions) {
      const existingAsset = normalizeTemplateAssetReference(
        assetFolderPublicPath,
        existingTemplate?.layeredRender?.finishBaseImages?.[finish],
        `${finish} finish base image`
      );
      const requestedAsset = normalizeTemplateAssetReference(
        assetFolderPublicPath,
        rawFinishBaseImages[finish],
        `${finish} finish base image`
      );

      if (existingAsset) finishBaseImages[finish] = existingAsset;
      if (requestedAsset) finishBaseImages[finish] = requestedAsset;

      const uploadedFinishBase = validateImageFile(
        formData.get(`finishBaseImage:${finish}`) as File | null,
        `${finish} finish base image`
      );

      if (uploadedFinishBase) {
        const finishBaseImageFileName = buildFinishBaseAssetFileName(finish, uploadedFinishBase);
        await writeFileFromUpload(path.resolve(assetDir, finishBaseImageFileName), uploadedFinishBase);
        finishBaseImages[finish] = finishBaseImageFileName;
      }
    }

    const materialMaps: NonNullable<LayeredRenderConfig["materialMaps"]> = {};
    const rawMaterialMaps = layeredRenderForm.materialMaps || {};
    for (const finish of productFinishOptions) {
      const existingMapSet = existingTemplate?.layeredRender?.materialMaps?.[finish] || {};
      const requestedMapSet = rawMaterialMaps[finish] || {};
      const normalizedMapSet: NonNullable<LayeredRenderConfig["materialMaps"]>[ProductFinishOption] = {};

      for (const mapKey of layeredMaterialMapKeys) {
        const existingMapAsset = normalizeTemplateAssetReference(
          assetFolderPublicPath,
          existingMapSet[mapKey],
          `${finish} ${mapKey} material map`
        );
        const requestedMapAsset = normalizeTemplateAssetReference(
          assetFolderPublicPath,
          requestedMapSet[mapKey],
          `${finish} ${mapKey} material map`
        );

        if (existingMapAsset) normalizedMapSet[mapKey] = existingMapAsset;
        if (requestedMapAsset) normalizedMapSet[mapKey] = requestedMapAsset;
      }

      if (Object.keys(normalizedMapSet).length) {
        materialMaps[finish] = normalizedMapSet;
      }
    }

    const fallbackFinish =
      normalizeProductFinishOption(layeredRenderForm.fallbackFinish) ||
      existingTemplate?.layeredRender?.fallbackFinish ||
      "matte";
    const availableFallbackFinish =
      finishBaseImages[fallbackFinish] ? fallbackFinish : productFinishOptions.find((finish) => finishBaseImages[finish]);

    if (!availableFallbackFinish) {
      throw new AppError(
        "INVALID_TEMPLATE_ASSET",
        "Please upload at least one material base image for local layered rendering.",
        400
      );
    }

    const requiredFinishes = Array.from(
      new Set([
        availableFallbackFinish,
        ...colorPartsWithUploadedMasks.flatMap((part) => part.allowedFinishes || [])
      ])
    );
    const missingFinish = requiredFinishes.find((finish) => !finishBaseImages[finish]);
    if (missingFinish) {
      throw new AppError(
        "INVALID_TEMPLATE_ASSET",
        `Please upload a ${missingFinish} base image before enabling local layered rendering.`,
        400
      );
    }

    const partMasks: Record<string, string> = {};
    const rawPartMasks = layeredRenderForm.partMasks || {};
    for (const [index, part] of colorPartsWithUploadedMasks.entries()) {
      const requestedPartMask = normalizeTemplateAssetReference(
        assetFolderPublicPath,
        rawPartMasks[part.id],
        `${part.label} part reference image`
      );
      const partMaskImageFileName = part.partMaskImageFileName || requestedPartMask;

      if (!partMaskImageFileName) {
        throw new AppError(
          "INVALID_TEMPLATE_ASSET",
          `Please upload a part reference image for ${part.label} before enabling local layered rendering.`,
          400
        );
      }

      partMasks[part.id] = partMaskImageFileName;
      colorPartsWithUploadedMasks[index] = {
        ...part,
        partMaskImageFileName
      };
    }

    const outputSize = normalizeLayeredOutputSize(layeredRenderForm) || existingTemplate?.layeredRender?.outputSize;
    const finishRules = buildLayeredFinishRules(requiredFinishes, layeredRenderForm.finishRules);

    layeredRender = {
      enabled: true,
      mode: "local-layered",
      ...(outputSize ? { outputSize } : {}),
      fallbackFinish: availableFallbackFinish,
      finishBaseImages,
      ...(Object.keys(materialMaps).length ? { materialMaps } : {}),
      partMasks,
      finishRules
    };
  }

  const printingAreaImages: Record<string, string> = {};
  const rawPrintingAreaImages = logoPlacementForm?.printingAreaImages || {};
  for (const method of defaultPrintingMethods) {
    const existingAsset = normalizeTemplateAssetReference(
      assetFolderPublicPath,
      existingTemplate?.logoPlacement.printingAreaImages?.[method],
      `${method} printing area image`
    );
    const requestedAsset = normalizeTemplateAssetReference(
      assetFolderPublicPath,
      rawPrintingAreaImages[method],
      `${method} printing area image`
    );

    if (existingAsset) printingAreaImages[method] = existingAsset;
    if (requestedAsset) printingAreaImages[method] = requestedAsset;

    const uploadedPrintingArea = validateImageFile(
      formData.get(`printingAreaImage:${method}`) as File | null,
      `${method} printing area image`
    );

    if (uploadedPrintingArea) {
      const printingAreaImageFileName = buildPrintingAreaAssetFileName(method, uploadedPrintingArea);
      await writeFileFromUpload(path.resolve(assetDir, printingAreaImageFileName), uploadedPrintingArea);
      printingAreaImages[method] = printingAreaImageFileName;
    }
  }

  const orientationPreset =
    normalizeLogoOrientationPreset(logoPlacementForm?.orientationPreset) ||
    existingTemplate?.logoPlacement.orientationPreset ||
    "horizontal";

  const template = {
    id: slug,
    slug,
    name,
    category,
    description,
    ...(size ? { size } : {}),
    specifications,
    assetFolderPublicPath,
    baseImageFileName,
    instructionImageFileName,
    usageType: "visual_reference_only" as const,
    allowedLogoPrintColors: existingTemplate?.allowedLogoPrintColors || defaultLogoPrintColors,
    defaultLogoPrintColor: existingTemplate?.defaultLogoPrintColor || "white",
    allowedPrintingMethods: existingTemplate?.allowedPrintingMethods || defaultPrintingMethods,
    pantoneLibrary: "pantone-solid-coated-v3",
    colorParts: colorPartsWithUploadedMasks,
    ...(layeredRender ? { layeredRender } : {}),
    logoPlacement: {
      ...(existingTemplate?.logoPlacement || {
        description: "Place the logo only inside the marked safe area from the instruction image.",
        maxWidthMm: 120,
        maxHeightMm: 45,
        notes: "Visual reference only; final artwork must be confirmed by Chili design team."
      }),
      orientationPreset,
      ...(Object.keys(printingAreaImages).length ? { printingAreaImages } : {})
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
