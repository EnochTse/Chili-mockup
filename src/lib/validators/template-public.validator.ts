import { z } from "zod";
import { productFinishOptions } from "@/lib/services/finish-option.service";
import type { TemplatePublicDto } from "@/lib/types";

const slugPattern = /^[a-z0-9][a-z0-9-]*$/;
const hexColorPattern = /^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/;
const productFinishSchema = z.enum(productFinishOptions);
const assetReferenceSchema = z.string().min(1).max(2048);

const pantoneOptionSchema = z.object({
  code: z.string().min(1).max(100),
  previewHex: z.string().regex(hexColorPattern),
  label: z.string().min(1).max(160)
});

const finishRuleSchema = z.object({
  colorOpacity: z.number().min(0).max(1),
  blendMode: z.enum([
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
  ]),
  highlightProtection: z.number().min(0).max(1).optional(),
  textureStrength: z.number().min(0).max(1).optional(),
  saturationBoost: z.number().min(0).max(0.5).optional()
});

const materialMapSchema = z
  .object({
    base: assetReferenceSchema.optional(),
    shadow: assetReferenceSchema.optional(),
    highlight: assetReferenceSchema.optional(),
    texture: assetReferenceSchema.optional(),
    specular: assetReferenceSchema.optional(),
    edgeAo: assetReferenceSchema.optional()
  })
  .partial();

const colorPartSchema = z.object({
  id: z.string().regex(slugPattern),
  label: z.string().min(1).max(160),
  description: z.string().min(1).max(1000),
  instructionCue: z.string().max(1000).optional(),
  instructionColorHex: z.string().regex(hexColorPattern).optional(),
  partMaskImageFileName: assetReferenceSchema.optional(),
  partMaskImageUrl: assetReferenceSchema.optional(),
  defaultPantoneCode: z.string().min(1).max(100).optional(),
  allowedFinishes: z.array(productFinishSchema).min(1).max(productFinishOptions.length).optional(),
  defaultFinish: productFinishSchema.optional(),
  indicatorAnchors: z
    .array(
      z.object({
        id: z.string().min(1).max(160),
        targetXPercent: z.number().min(0).max(100),
        targetYPercent: z.number().min(0).max(100),
        labelOffsetXPercent: z.number().min(-100).max(100),
        labelOffsetYPercent: z.number().min(-100).max(100)
      })
    )
    .max(3)
    .optional()
});

const layeredRenderSchema = z
  .object({
    enabled: z.boolean(),
    mode: z.literal("local-layered"),
    outputSize: z
      .object({
        width: z.number().int().positive().max(8192),
        height: z.number().int().positive().max(8192)
      })
      .optional(),
    fallbackFinish: productFinishSchema,
    finishBaseImages: z.partialRecord(productFinishSchema, assetReferenceSchema),
    materialMaps: z.partialRecord(productFinishSchema, materialMapSchema).optional(),
    partMasks: z.record(z.string().regex(slugPattern), assetReferenceSchema),
    finishRules: z.partialRecord(productFinishSchema, finishRuleSchema).optional()
  })
  .superRefine((value, context) => {
    if (!value.finishBaseImages[value.fallbackFinish]) {
      context.addIssue({
        code: "custom",
        path: ["finishBaseImages", value.fallbackFinish],
        message: "The fallback finish needs its own base image."
      });
    }
  });

export const templatePublicDtoSchema = z
  .object({
    id: z.string().regex(slugPattern),
    slug: z.string().regex(slugPattern),
    name: z.string().min(1).max(200),
    category: z.string().min(1).max(160),
    description: z.string().min(1).max(4000),
    size: z.string().max(500).optional(),
    specifications: z
      .array(
        z.object({
          label: z.string().min(1).max(200),
          value: z.string().min(1).max(500)
        })
      )
      .max(100)
      .optional(),
    baseImageUrl: assetReferenceSchema,
    instructionImageUrl: assetReferenceSchema,
    usageType: z.literal("visual_reference_only"),
    allowedLogoPrintColors: z.array(z.string().min(1).max(100)).min(1).max(20),
    defaultLogoPrintColor: z.string().min(1).max(100),
    allowedPrintingMethods: z.array(z.string().min(1).max(100)).min(1).max(30),
    pantoneOptions: z.array(pantoneOptionSchema).min(1).max(10000),
    colorParts: z.array(colorPartSchema).min(1).max(40),
    layeredRender: layeredRenderSchema.optional(),
    logoPlacement: z.object({
      description: z.string().min(1).max(2000),
      maxWidthMm: z.number().positive().max(10000),
      maxHeightMm: z.number().positive().max(10000),
      notes: z.string().min(1).max(4000),
      orientationPreset: z.enum(["horizontal", "vertical"]).optional(),
      printingAreaImages: z.record(z.string().min(1).max(100), assetReferenceSchema).optional()
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
  })
  .superRefine((value, context) => {
    if (value.id !== value.slug) {
      context.addIssue({
        code: "custom",
        path: ["id"],
        message: "Template id and slug must match."
      });
    }

    const partIds = new Set<string>();
    for (const [index, part] of value.colorParts.entries()) {
      if (partIds.has(part.id)) {
        context.addIssue({
          code: "custom",
          path: ["colorParts", index, "id"],
          message: "Product part ids must be unique."
        });
      }
      partIds.add(part.id);

      if (part.defaultFinish && !part.allowedFinishes?.includes(part.defaultFinish)) {
        context.addIssue({
          code: "custom",
          path: ["colorParts", index, "defaultFinish"],
          message: "The default finish must be included in allowed finishes."
        });
      }

      if (value.layeredRender && !value.layeredRender.partMasks[part.id]) {
        context.addIssue({
          code: "custom",
          path: ["layeredRender", "partMasks", part.id],
          message: `A part mask is required for ${part.label}.`
        });
      }

      for (const finish of part.allowedFinishes || []) {
        if (value.layeredRender && !value.layeredRender.finishBaseImages[finish]) {
          context.addIssue({
            code: "custom",
            path: ["layeredRender", "finishBaseImages", finish],
            message: `${part.label} requires a ${finish} base image.`
          });
        }
      }
    }
  });

export function parseTemplatePublicDto(value: unknown): TemplatePublicDto {
  return templatePublicDtoSchema.parse(value) as TemplatePublicDto;
}
