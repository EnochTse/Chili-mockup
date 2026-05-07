import { describe, expect, it } from "vitest";
import { loadPantoneLibrary } from "@/lib/services/pantone-library.service";

describe("pantone-library.service", () => {
  it("loads the imported Pantone Solid Coated library", () => {
    const colors = loadPantoneLibrary("pantone-solid-coated-v3");

    expect(colors).toHaveLength(1846);
    expect(colors[0]).toMatchObject({
      code: "Pantone Yellow 012 C",
      label: "Pantone Yellow 012 C",
      previewHex: "#FFD700"
    });
    expect(colors).toContainEqual({
      code: "Pantone 485 C",
      label: "Pantone 485 C",
      previewHex: "#E0241D"
    });
    expect(colors).toContainEqual({
      code: "Pantone 286 C",
      label: "Pantone 286 C",
      previewHex: "#0033A0"
    });
  });
});
