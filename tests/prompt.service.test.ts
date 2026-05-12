import { describe, expect, it } from "vitest";
import { buildMockupPrompt, getImageReferenceLabel, getPrintingMethodPrompt } from "@/lib/services/prompt.service";
import { loadTemplate } from "@/lib/services/template.service";

describe("prompt.service", () => {
  it("builds the deterministic Gemini prompt with required production rules", async () => {
    const template = await loadTemplate("umbrella-classic-black");
    const pantone = template.pantoneOptions.find((option) => option.code === "Pantone 485 C")!;
    const prompt = buildMockupPrompt({
      template,
      selectedPartPantones: [
        {
          partId: template.colorParts[0].id,
          partLabel: template.colorParts[0].label,
          partDescription: template.colorParts[0].description,
          instructionCue: template.colorParts[0].instructionCue,
          instructionColorHex: template.colorParts[0].instructionColorHex,
          pantoneCode: pantone.code,
          pantone
        }
      ],
      logoPrintColor: "white",
      printingMethod: "silk_screen"
    });

    expect(prompt).toContain("Image A is the original product photo");
    expect(prompt).toContain("Image B is the full instruction image");
    expect(prompt).toContain("Authoritative part map:");
    expect(prompt).toContain("guide marks only");
    expect(prompt).toContain("applied later by the application as a separate locked overlay");
    expect(prompt).toContain("Do not create, draw, place, infer, reconstruct, or render any logo");
    expect(prompt).toContain(template.colorParts[0].label);
    expect(prompt).toContain(template.colorParts[0].description);
    expect(prompt).toContain(template.colorParts[0].instructionCue!);
    expect(prompt).toContain(template.colorParts[0].instructionColorHex!);
    expect(prompt).toContain(pantone.label);
    expect(prompt).toContain(pantone.previewHex);
    expect(prompt).toContain("Printing method selected for the later overlay step: Silk screen");
    expect(prompt).toContain("Leave the approved logo placement area empty");
    expect(prompt).toContain("Do not swap the selected Pantone assignments between parts.");
    expect(prompt).toContain("Do not show the green outlined logo box");
    expect(prompt).toContain("Do not add any logo, brand mark, watermark");
    expect(prompt).toContain("Do not add logo-shaped placeholders");
    expect(prompt).toContain("Do not add any text.");
    expect(prompt).toContain("Keep the product surface clean, neat, and production-ready");
    expect(prompt).toContain("Do not add dirt, stains, smudges, scratches");
    expect(prompt).toContain("Keep the material finish even, clean, crisp");
    expect(prompt).toContain(
      "This mockup is for visual reference only, not final production artwork."
    );
  });

  it("defines the mirror laser engraving method copy", () => {
    expect(getPrintingMethodPrompt("mirror_laser_engraving")).toMatchObject({
      label: "Mirror laser engraving"
    });
    expect(getPrintingMethodPrompt("mirror_laser_engraving").prompt).toContain(
      "reflective black-to-white metallic gradient"
    );
  });

  it("adds dynamic isolated part-mask references for any number of parts", () => {
    const prompt = buildMockupPrompt({
      template: {
        name: "Test Bottle",
        slug: "test-bottle",
        size: "500ml",
        specifications: [],
        constraints: {
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
      },
      selectedPartPantones: [
        {
          partId: "body",
          partLabel: "Body",
          partDescription: "Main bottle body",
          instructionCue: "Red body region",
          instructionColorHex: "#FF0000",
          partMaskImageUrl: "/mockup-templates/test-bottle/body-mask.png",
          pantoneCode: "Pantone 485 C",
          pantone: { code: "Pantone 485 C", label: "Pantone 485 C", previewHex: "#E0241D" }
        },
        {
          partId: "lid",
          partLabel: "Lid",
          partDescription: "Top lid",
          instructionCue: "Blue lid region",
          instructionColorHex: "#1450FF",
          partMaskImageUrl: "/mockup-templates/test-bottle/lid-mask.png",
          pantoneCode: "Pantone 300 C",
          pantone: { code: "Pantone 300 C", label: "Pantone 300 C", previewHex: "#0057B8" }
        },
        {
          partId: "loop",
          partLabel: "Loop",
          partDescription: "Handle loop",
          partMaskImageUrl: "/mockup-templates/test-bottle/loop-mask.png",
          pantoneCode: "Pantone 123 C",
          pantone: { code: "Pantone 123 C", label: "Pantone 123 C", previewHex: "#FFC72C" }
        }
      ],
      logoPrintColor: "white",
      printingMethod: "silk_screen"
    });

    expect(prompt).toContain("Additional isolated part-mask references:");
    expect(prompt).toContain(`${getImageReferenceLabel(2)} isolates only Body`);
    expect(prompt).toContain(`${getImageReferenceLabel(3)} isolates only Lid`);
    expect(prompt).toContain(`${getImageReferenceLabel(4)} isolates only Loop`);
    expect(prompt).toContain("Do not let one part's recolor bleed into an adjacent part.");
    expect(prompt).toContain("Isolated part mask reference: Image C");
    expect(prompt).toContain("Isolated part mask reference: Image D");
    expect(prompt).toContain("Isolated part mask reference: Image E");
  });
});
