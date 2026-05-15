import { describe, expect, it } from "vitest";
import { getPrintingMethodPrompt } from "@/lib/services/prompt.service";

describe("prompt.service", () => {
  it("defines the mirror laser engraving method copy", () => {
    expect(getPrintingMethodPrompt("mirror_laser_engraving")).toMatchObject({
      label: "Mirror laser engraving"
    });
    expect(getPrintingMethodPrompt("mirror_laser_engraving").prompt).toContain(
      "reflective black-to-white metallic gradient"
    );
  });

  it("falls back to a readable label for custom printing methods", () => {
    expect(getPrintingMethodPrompt("custom_pad_print")).toMatchObject({
      label: "custom_pad_print",
      prompt: "Apply the logo using the selected custom_pad_print method."
    });
  });
});
