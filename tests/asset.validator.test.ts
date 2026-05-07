import { describe, expect, it } from "vitest";
import { assertNoPlaceholderAsset } from "@/lib/validators/asset.validator";

describe("asset.validator", () => {
  it("rejects template asset paths that look like starter, placeholder, demo, or sample assets", () => {
    expect(() =>
      assertNoPlaceholderAsset("public/mockup-templates/starter/base-product.png")
    ).toThrow("Placeholder asset detected");

    expect(() =>
      assertNoPlaceholderAsset("public/mockup-templates/umbrella/demo-instruction.jpg")
    ).toThrow("Placeholder asset detected");
  });

  it("rejects embedded placeholder metadata text", () => {
    expect(() =>
      assertNoPlaceholderAsset(
        "public/mockup-templates/umbrella/base-product.png",
        Buffer.from("Starter product photo for local mockup testing")
      )
    ).toThrow("Placeholder asset detected");
  });
});
