import fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { AppError } from "@/lib/errors";
import { productFinishOptions } from "@/lib/services/finish-option.service";
import { loadPantoneLibrary } from "@/lib/services/pantone-library.service";
import { validateTemplateAsset } from "@/lib/validators/asset.validator";
import type {
  ProductTemplate,
  ResolvedProductColorPart,
  ResolvedProductTemplate,
  TemplateSummaryDto,
  TemplatePublicDto
} from "@/lib/types";

const slugPattern = /^[a-z0-9][a-z0-9-]*$/;
const libraryIdPattern = /^[a-z0-9][a-z0-9-]*$/;
const hexColorPattern = /^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/;
const templatesRoot = path.resolve(process.cwd(), "src", "lib", "templates");

const pantoneOptionSchema = z.object({
  code: z.string().min(1),
  previewHex: z.string().min(1),
  label: z.string().min(1)
});

const productSpecificationSchema = z.object({
  label: z.string().min(1),
  value: z.string().min(1)
});

const productFinishOptionSchema = z.enum(productFinishOptions);
const canvasBlendModeSchema = z.enum([
  "source-over",
  "multiply",
  "screen",
  "overlay",
  "darken",
  "lighten",
  "color-dodge",
  "color-burn",
  "hard-light",
  "soft-light",
  "difference",
  "exclusion",
  "hue",
  "saturation",
  "color",
  "luminosity"
]);

const layeredRenderSchema = z.object({
  enabled: z.boolean(),
  mode: z.literal("local-layered"),
  outputSize: z
    .object({
      width: z.number().int().positive(),
      height: z.number().int().positive()
    })
    .optional(),
  fallbackFinish: productFinishOptionSchema,
  finishBaseImages: z.partialRecord(productFinishOptionSchema, z.string().min(1)),
  partMasks: z.record(z.string().min(1), z.string().min(1)),
  finishRules: z
    .partialRecord(
      productFinishOptionSchema,
      z.object({
        colorOpacity: z.number().min(0).max(1),
        blendMode: canvasBlendModeSchema,
        highlightProtection: z.number().min(0).max(1).optional(),
        textureStrength: z.number().min(0).max(1).optional(),
        saturationBoost: z.number().min(0).max(0.5).optional()
      })
    )
    .optional()
});

const productColorPartSchema = z
  .object({
    id: z.string().regex(slugPattern),
    label: z.string().min(1),
    description: z.string().min(1),
    instructionCue: z.string().min(1).optional(),
    instructionColorHex: z.string().regex(hexColorPattern).optional(),
    partMaskImageFileName: z.string().min(1).optional(),
    defaultPantoneCode: z.string().min(1).optional(),
    allowedFinishes: z.array(productFinishOptionSchema).min(1).optional(),
    defaultFinish: productFinishOptionSchema.optional(),
    indicatorAnchors: z
      .array(
        z.object({
          id: z.string().min(1),
          targetXPercent: z.number().min(0).max(100),
          targetYPercent: z.number().min(0).max(100),
          labelOffsetXPercent: z.number().min(-100).max(100),
          labelOffsetYPercent: z.number().min(-100).max(100)
        })
      )
      .max(3)
      .optional()
  })
  .superRefine((part, context) => {
    if (part.defaultFinish && !part.allowedFinishes?.includes(part.defaultFinish)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "defaultFinish must be one of allowedFinishes.",
        path: ["defaultFinish"]
      });
    }
  });

const templateSchema = z.object({
  id: z.string().min(1),
  slug: z.string().regex(slugPattern),
  name: z.string().min(1),
  category: z.string().min(1),
  description: z.string().min(1),
  size: z.string().min(1).optional(),
  specifications: z.array(productSpecificationSchema).optional(),
  assetFolderPublicPath: z.string().startsWith("/"),
  baseImageFileName: z.string().min(1),
  instructionImageFileName: z.string().min(1),
  usageType: z.literal("visual_reference_only"),
  allowedLogoPrintColors: z.array(z.string().min(1)).min(1),
  defaultLogoPrintColor: z.string().min(1),
  allowedPrintingMethods: z.array(z.string().min(1)).min(1),
  pantoneLibrary: z.string().regex(libraryIdPattern).optional(),
  pantoneOptions: z.array(pantoneOptionSchema).min(1).optional(),
  colorParts: z.array(productColorPartSchema).min(1),
  layeredRender: layeredRenderSchema.optional(),
  logoPlacement: z.object({
    description: z.string().min(1),
    maxWidthMm: z.number().positive(),
    maxHeightMm: z.number().positive(),
    notes: z.string().min(1)
  }),
  constraints: z.object({
    preserveBackground: z.boolean(),
    preserveLighting: z.boolean(),
    preserveProductShape: z.boolean(),
    preserveMaterialTexture: z.boolean(),
    allowOnlyDefinedRecolorRegion: z.boolean(),
    allowOnlyDefinedLogoRegion: z.boolean(),
    noPeople: z.boolean(),
    noExtraProps: z.boolean(),
    noExtraBranding: z.boolean(),
    noExtraTextExceptLogo: z.boolean()
  })
}).refine((template) => template.pantoneLibrary || template.pantoneOptions?.length, {
  path: ["pantoneOptions"],
  message: "A template must define pantoneOptions or pantoneLibrary."
});

type TemplateConfig = z.infer<typeof templateSchema>;

function assertSafeSlug(productSlug: string) {
  if (!slugPattern.test(productSlug)) {
    throw new AppError("PRODUCT_TEMPLATE_NOT_FOUND", "The product template could not be found.", 404);
  }
}

function getTemplatePath(productSlug: string) {
  return path.resolve(templatesRoot, productSlug, "template.json");
}

function toPublicAssetUrl(folder: string, fileName: string) {
  return `${folder.replace(/\/$/, "")}/${encodeURIComponent(fileName)}`;
}

function resolvePublicAssetPath(folder: string, fileName: string) {
  const publicRoot = path.resolve(process.cwd(), "public");
  const relativeFolder = folder.replace(/^\/+/, "");
  const resolved = path.resolve(publicRoot, relativeFolder, fileName);

  if (!resolved.startsWith(publicRoot + path.sep)) {
    throw new AppError("PRODUCT_TEMPLATE_NOT_FOUND", "The product template could not be found.", 404);
  }

  return resolved;
}

function resolveLayeredAssetPath(assetFolderPublicPath: string, assetReference: string) {
  if (assetReference.startsWith("/")) {
    const publicRoot = path.resolve(process.cwd(), "public");
    const resolved = path.resolve(publicRoot, assetReference.replace(/^\/+/, ""));

    if (!resolved.startsWith(publicRoot + path.sep)) {
      throw new AppError("PRODUCT_TEMPLATE_NOT_FOUND", "The product template could not be found.", 404);
    }

    return resolved;
  }

  return resolvePublicAssetPath(assetFolderPublicPath, assetReference);
}

function toLayeredAssetPublicUrl(assetFolderPublicPath: string, assetReference: string) {
  if (assetReference.startsWith("/")) return assetReference;
  const folder = assetFolderPublicPath.replace(/\/$/, "");
  const assetPath = assetReference
    .split(/[\\/]+/)
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `${folder}/${assetPath}`;
}

async function readTemplateConfig(productSlug: string): Promise<TemplateConfig> {
  let raw: string;
  try {
    raw = await fs.readFile(getTemplatePath(productSlug), "utf8");
  } catch {
    throw new AppError("PRODUCT_TEMPLATE_NOT_FOUND", "The product template could not be found.", 404);
  }

  try {
    return templateSchema.parse(JSON.parse(raw));
  } catch {
    throw new AppError("PRODUCT_TEMPLATE_NOT_FOUND", "The product template could not be found.", 404);
  }
}

async function exists(target: string) {
  try {
    await fs.stat(target);
    return true;
  } catch {
    return false;
  }
}

function hydrateTemplate(
  productSlug: string,
  templateConfig: TemplateConfig
): ProductTemplate {
  if (templateConfig.slug !== productSlug) {
    throw new AppError("PRODUCT_TEMPLATE_NOT_FOUND", "The product template could not be found.", 404);
  }

  const pantoneOptions = templateConfig.pantoneLibrary
    ? loadPantoneLibrary(templateConfig.pantoneLibrary)
    : templateConfig.pantoneOptions!;
  const template: ProductTemplate = {
    ...templateConfig,
    pantoneOptions
  };

  return template;
}

function resolveTemplatePartMasks(
  assetFolderPublicPath: string,
  colorParts: ProductTemplate["colorParts"]
): ResolvedProductColorPart[] {
  return colorParts.map((part) => {
    if (!part.partMaskImageFileName) {
      return part;
    }

    const partMaskImagePath = resolvePublicAssetPath(assetFolderPublicPath, part.partMaskImageFileName);

    return {
      ...part,
      partMaskImagePath,
      partMaskImagePublicUrl: toPublicAssetUrl(assetFolderPublicPath, part.partMaskImageFileName)
    };
  });
}

function resolveLayeredRenderAssets(template: ProductTemplate): ProductTemplate["layeredRender"] {
  const layeredRender = template.layeredRender;
  if (!layeredRender) return undefined;

  return {
    ...layeredRender,
    finishBaseImages: Object.fromEntries(
      Object.entries(layeredRender.finishBaseImages).map(([finish, assetReference]) => [
        finish,
        toLayeredAssetPublicUrl(template.assetFolderPublicPath, assetReference)
      ])
    ),
    partMasks: Object.fromEntries(
      Object.entries(layeredRender.partMasks).map(([partId, assetReference]) => [
        partId,
        toLayeredAssetPublicUrl(template.assetFolderPublicPath, assetReference)
      ])
    )
  };
}

export async function loadTemplate(productSlug: string): Promise<ResolvedProductTemplate> {
  assertSafeSlug(productSlug);
  const templateConfig = await readTemplateConfig(productSlug);
  const template = hydrateTemplate(productSlug, templateConfig);

  const baseProductImagePath = resolvePublicAssetPath(
    template.assetFolderPublicPath,
    template.baseImageFileName
  );
  const instructionImagePath = resolvePublicAssetPath(
    template.assetFolderPublicPath,
    template.instructionImageFileName
  );

  await validateTemplateAsset(baseProductImagePath, "base");
  await validateTemplateAsset(instructionImagePath, "instruction");

  const colorParts = resolveTemplatePartMasks(template.assetFolderPublicPath, template.colorParts);
  const layeredRender = resolveLayeredRenderAssets(template);
  await Promise.all(
    colorParts.map(async (part) => {
      if (part.partMaskImagePath) {
        await validateTemplateAsset(part.partMaskImagePath, "part_mask");
      }
    })
  );
  if (template.layeredRender) {
    await Promise.all([
      ...Object.values(template.layeredRender.finishBaseImages).map((assetReference) =>
        validateTemplateAsset(
          resolveLayeredAssetPath(template.assetFolderPublicPath, assetReference),
          "base"
        )
      ),
      ...Object.values(template.layeredRender.partMasks).map((assetReference) =>
        validateTemplateAsset(
          resolveLayeredAssetPath(template.assetFolderPublicPath, assetReference),
          "part_mask"
        )
      )
    ]);
  }

  return {
    ...template,
    colorParts,
    layeredRender,
    baseImagePublicUrl: toPublicAssetUrl(
      template.assetFolderPublicPath,
      template.baseImageFileName
    ),
    instructionImagePublicUrl: toPublicAssetUrl(
      template.assetFolderPublicPath,
      template.instructionImageFileName
    ),
    baseProductImagePath,
    instructionImagePath
  };
}

export async function listTemplateSlugs(): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(templatesRoot, { withFileTypes: true });
  } catch {
    return [];
  }

  const candidates = entries
    .filter((entry) => entry.isDirectory() && slugPattern.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
  const discovered: string[] = [];

  for (const productSlug of candidates) {
    if (await exists(getTemplatePath(productSlug))) {
      discovered.push(productSlug);
    }
  }

  return discovered;
}

export function toTemplateSummaryDto(template: ResolvedProductTemplate): TemplateSummaryDto {
  return {
    id: template.id,
    slug: template.slug,
    name: template.name,
    category: template.category,
    description: template.description,
    size: template.size,
    baseImageUrl: template.baseImagePublicUrl,
    instructionImageUrl: template.instructionImagePublicUrl
  };
}

export async function listTemplateSummaries(): Promise<TemplateSummaryDto[]> {
  const productSlugs = await listTemplateSlugs();
  const templates = await Promise.all(productSlugs.map((productSlug) => loadTemplate(productSlug)));

  return templates.map(toTemplateSummaryDto);
}

export function toTemplatePublicDto(template: ResolvedProductTemplate): TemplatePublicDto {
  return {
    id: template.id,
    slug: template.slug,
    name: template.name,
    category: template.category,
    description: template.description,
    size: template.size,
    specifications: template.specifications,
    baseImageUrl: template.baseImagePublicUrl,
    instructionImageUrl: template.instructionImagePublicUrl,
    usageType: template.usageType,
    allowedLogoPrintColors: template.allowedLogoPrintColors,
    defaultLogoPrintColor: template.defaultLogoPrintColor,
    allowedPrintingMethods: template.allowedPrintingMethods,
    pantoneOptions: template.pantoneOptions,
    colorParts: template.colorParts.map((part) => ({
      id: part.id,
      label: part.label,
      description: part.description,
      instructionCue: part.instructionCue,
      instructionColorHex: part.instructionColorHex,
      partMaskImageFileName: part.partMaskImageFileName,
      partMaskImageUrl: part.partMaskImagePublicUrl,
      defaultPantoneCode: part.defaultPantoneCode,
      allowedFinishes: part.allowedFinishes,
      defaultFinish: part.defaultFinish,
      indicatorAnchors: part.indicatorAnchors
    })),
    layeredRender: template.layeredRender,
    logoPlacement: template.logoPlacement,
    constraints: template.constraints
  };
}
