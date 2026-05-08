import { describe, expect, it } from "vitest";
import { buildMockupPrompt, getPrintingMethodPrompt } from "@/lib/services/prompt.service";
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
    expect(prompt).toContain("Image B is the instruction image");
    expect(prompt).toContain("authoritative part map");
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
});
