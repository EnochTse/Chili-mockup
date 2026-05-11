import { productFinishLabels } from "@/lib/services/finish-option.service";
import type { ProductFinishOption, ResolvedProductTemplate, SelectedPartPantone, TemplatePublicDto } from "@/lib/types";

type PromptTemplateInput =
  | ResolvedProductTemplate
  | Pick<
      TemplatePublicDto,
      "name" | "slug" | "size" | "specifications" | "constraints"
    >;

export const printingMethodPrompts: Record<
  string,
  { label: string; prompt: string }
> = {
  silk_screen: {
    label: "Silk screen",
    prompt:
      "Apply the logo as flat screen-printed ink with clean edges and a slight matte finish."
  },
  uv_print: {
    label: "UV print",
    prompt:
      "Apply the logo as crisp UV print with sharp edges and a slightly raised glossy finish."
  },
  heat_transfer: {
    label: "Heat transfer",
    prompt:
      "Apply the logo as a smooth heat-transfer print that follows the material curvature."
  },
  embroidery: {
    label: "Embroidery",
    prompt:
      "Render the logo as embroidered thread texture, slightly raised, with stitched edges."
  },
  laser_engraving: {
    label: "Laser engraving",
    prompt:
      "Render the logo as a subtle monochrome engraved mark etched into the material surface."
  },
  mirror_laser_engraving: {
    label: "Mirror laser engraving",
    prompt:
      "Render the logo as a polished mirror-finish laser engraving with a reflective black-to-white metallic gradient, crisp etched edges, and realistic chrome-like highlights that stay engraved in the material rather than printed on top."
  }
};

export function getPrintingMethodPrompt(method: string) {
  return (
    printingMethodPrompts[method] || {
      label: method,
      prompt: `Apply the logo using the selected ${method} method.`
    }
  );
}

const finishPromptMap: Record<ProductFinishOption, string> = {
  matte: "matte finish with low sheen and a non-reflective surface",
  glossy: "glossy finish with visible reflections and a polished surface",
  rubber: "rubberized soft-touch finish with muted reflections",
  metallic: "metallic finish with subtle specular highlights and a reflective material character"
};

export function buildMockupPrompt(params: {
  template: PromptTemplateInput;
  selectedPartPantones: SelectedPartPantone[];
  logoPrintColor: string;
  printingMethod: string;
}) {
  const method = getPrintingMethodPrompt(params.printingMethod);
  const constraints = params.template.constraints;
  const partLines = params.selectedPartPantones
    .map((selection, index) =>
      [
        `${index + 1}. Part label: ${selection.partLabel}`,
        `   Product area: ${selection.partDescription}`,
        selection.instructionCue
          ? `   Instruction image cue: ${selection.instructionCue}`
          : "",
        selection.instructionColorHex
          ? `   Instruction overlay color: ${selection.instructionColorHex}`
          : "",
        `   Requested color: ${selection.pantone.label} (${selection.pantone.previewHex})`,
        selection.selectedFinish
          ? `   Requested finish: ${productFinishLabels[selection.selectedFinish]} (${finishPromptMap[selection.selectedFinish]})`
          : ""
      ]
        .filter(Boolean)
        .join("\n")
    )
    .join("\n");
  const specificationLines =
    params.template.specifications?.length
      ? params.template.specifications
          .map((specification) => `- ${specification.label}: ${specification.value}`)
          .join("\n")
      : "- No extra product specifications provided.";

  return `
Create a photorealistic product mockup for Chili.

Image A is the original product photo. Use it as the base product photo.
Image B is the instruction image. Treat Image B as the authoritative part map. Match each requested color only to its corresponding part cue from Image B. Do not swap colors between parts, do not merge multiple parts into one recolor decision, and do not recolor any surface that is not explicitly listed below.
All colored masks, green boxes, outlines, rectangles, arrows, labels, and other instructional overlays in Image B are guide marks only. Use them only to locate the approved areas and never render, print, emboss, engrave, stitch, or leave those guide marks visible in the final mockup.
The uploaded client logo will be applied later by the application as a separate locked overlay. Do not create, draw, place, infer, reconstruct, or render any logo in this Gemini output.

Product: ${params.template.name}
Product slug: ${params.template.slug}
Product size: ${params.template.size || "Not specified"}
Product specifications:
${specificationLines}
Authoritative part map:
${partLines}
Logo print color selected for the later overlay step: ${params.logoPrintColor}
Printing method selected for the later overlay step: ${method.label}

Preserve the original product shape, proportions, lighting, background, shadows, seams, folds, texture, material, and hardware.
Keep the product surface clean, neat, and production-ready like Image A.
Preserve background: ${constraints.preserveBackground}
Preserve lighting: ${constraints.preserveLighting}
Preserve product shape: ${constraints.preserveProductShape}
Preserve material texture: ${constraints.preserveMaterialTexture}
Only recolor the defined blue region: ${constraints.allowOnlyDefinedRecolorRegion}
Leave the approved logo placement area empty for the later programmatic logo overlay: ${constraints.allowOnlyDefinedLogoRegion}

Do not redesign the product.
Do not swap the selected Pantone assignments between parts.
Do not recolor unmapped surfaces.
Do not show the green outlined logo box or any instruction overlay in the final image.
Do not add any logo, brand mark, watermark, wordmark, symbol, slogan, label, or customer artwork.
Do not add logo-shaped placeholders, faint logo guides, blank logo patches, text marks, residual marks, or ghost prints.
Do not add extra props, people, patterns, decorative elements, extra branding, unrelated marks, or extra text.
Do not add any text.
Do not add dirt, stains, smudges, scratches, scuffs, dust, lint, speckles, blotches, discoloration, wear, grime, dirty texture, grunge, random grain, or damaged material that is not already present in Image A.
Do not make the product texture look aged, contaminated, noisy, patchy, muddy, roughened, or dirty.
Keep the material finish even, clean, crisp, and faithful to the original product photo.
This mockup is for visual reference only, not final production artwork.
`.trim();
}
