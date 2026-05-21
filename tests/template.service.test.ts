import path from "node:path";
import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import {
  listTemplateSlugs,
  listTemplateSummaries,
  loadTemplate,
  toTemplatePublicDto
} from "@/lib/services/template.service";

describe("template.service", () => {
  it("resolves absolute backend paths and public frontend URLs", async () => {
    const template = await loadTemplate("umbrella-classic-black");

    expect(template.baseProductImagePath).toBe(
      path.resolve(
        process.cwd(),
        "public",
        "mockup-templates",
        "umbrella-classic-black",
        "base-product.png"
      )
    );
    expect(template.instructionImagePath).toBe(
      path.resolve(
        process.cwd(),
        "public",
        "mockup-templates",
        "umbrella-classic-black",
        "instruction-image.jpg"
      )
    );

    const dto = toTemplatePublicDto(template);
    expect(dto.baseImageUrl).toBe(
      "/mockup-templates/umbrella-classic-black/base-product.png"
    );
    expect(dto.pantoneOptions).toHaveLength(1846);
    expect(dto.colorParts).toEqual([
      {
        id: "canopy",
        label: "Part 1",
        description: "Main umbrella canopy area highlighted for recoloring in the instruction image.",
        instructionCue: "Blue umbrella canopy region",
        instructionColorHex: "#1450FF",
        defaultPantoneCode: "Pantone Black C",
        allowedFinishes: ["matte", "glossy", "rubber"],
        defaultFinish: "matte",
        indicatorAnchors: [
          {
            id: "canopy-indicator-1",
            targetXPercent: 24,
            targetYPercent: 34,
            labelOffsetXPercent: -14,
            labelOffsetYPercent: -14
          },
          {
            id: "canopy-indicator-2",
            targetXPercent: 50,
            targetYPercent: 26,
            labelOffsetXPercent: 0,
            labelOffsetYPercent: -18
          },
          {
            id: "canopy-indicator-3",
            targetXPercent: 76,
            targetYPercent: 34,
            labelOffsetXPercent: 14,
            labelOffsetYPercent: -14
          }
        ]
      }
    ]);
    expect(dto.pantoneOptions).toContainEqual({
      code: "Pantone 485 C",
      label: "Pantone 485 C",
      previewHex: "#E0241D"
    });
    expect(dto).not.toHaveProperty("baseProductImagePath");
  });

  it("throws PRODUCT_TEMPLATE_NOT_FOUND for unknown slugs", async () => {
    await expect(loadTemplate("unknown-product")).rejects.toMatchObject({
      errorCode: "PRODUCT_TEMPLATE_NOT_FOUND"
    } satisfies Partial<AppError>);
  });

  it("discovers available product slugs from the templates directory", async () => {
    await expect(listTemplateSlugs()).resolves.toContain("umbrella-classic-black");
  });

  it("returns template summaries for product browsing", async () => {
    const summaries = await listTemplateSummaries();

    expect(summaries).toContainEqual({
      id: "umbrella-classic-black",
      slug: "umbrella-classic-black",
      name: "Classic Umbrella",
      category: "umbrella",
      description: "Classic umbrella mockup generator using the real product photo and instruction guide.",
      size: "Standard full-size canopy",
      baseImageUrl: "/mockup-templates/umbrella-classic-black/base-product.png",
      instructionImageUrl: "/mockup-templates/umbrella-classic-black/instruction-image.jpg"
    });
  });

  it("publishes BND62 layered render assets for the browser renderer", async () => {
    const template = toTemplatePublicDto(await loadTemplate("bnd62"));

    expect(template.layeredRender).toMatchObject({
      enabled: true,
      mode: "local-layered",
      fallbackFinish: "matte",
      finishBaseImages: {
        matte: "/mockup-templates/bnd62/layered/BND62_Matt.png",
        glossy: "/mockup-templates/bnd62/layered/BND62_Glossy.png",
        rubber: "/mockup-templates/bnd62/layered/BND62_Rubber.png",
        chrome: "/mockup-templates/bnd62/layered/BND62_Chrome.png"
      },
      partMasks: {
        "part-1-nan6hb": "/mockup-templates/bnd62/layered/BND62_part_1.png",
        "part-2-3ckhru": "/mockup-templates/bnd62/layered/BND62_part_2.png",
        "part-3-tzd2o2": "/mockup-templates/bnd62/layered/BND62_part_3.png"
      },
      finishRules: {
        matte: {
          colorOpacity: 0.98,
          highlightProtection: 0.18,
          textureStrength: 0.16,
          saturationBoost: 0.06
        },
        glossy: {
          colorOpacity: 0.97,
          highlightProtection: 0.28,
          textureStrength: 0.18,
          saturationBoost: 0.08
        },
        rubber: {
          colorOpacity: 0.98,
          highlightProtection: 0.2,
          textureStrength: 0.18,
          saturationBoost: 0.06
        },
        chrome: {
          colorOpacity: 0.16,
          highlightProtection: 0.72,
          textureStrength: 0.34,
          saturationBoost: 0
        }
      }
    });
    expect(template.colorParts.map((part) => part.allowedFinishes)).toEqual([
      ["matte", "glossy", "rubber", "chrome"],
      ["matte", "glossy", "rubber", "chrome"],
      ["matte", "glossy", "rubber", "chrome"]
    ]);
  });
});
