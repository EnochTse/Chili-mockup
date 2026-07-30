import { describe, expect, it } from "vitest";
import {
  parseLocalBlobReference,
  parseLocalUploadReference
} from "@/lib/local-library/asset-reference";
import { assertLocalStudioRequest } from "@/lib/services/local-library.service";

describe("Local asset references", () => {
  it("accepts calibrated material-map upload references", () => {
    expect(
      parseLocalUploadReference("local-upload://material-map/matte%3Ashadow")
    ).toEqual({
      group: "material-map",
      key: "matte:shadow"
    });
  });

  it("rejects SVG from the same-origin content-addressed asset route", () => {
    const hash = "a".repeat(64);
    expect(parseLocalBlobReference(`/api/local-library/assets/${hash}.svg`)).toBeNull();
    expect(parseLocalBlobReference(`/api/local-library/assets/${hash}.webp`)).toBe(
      `${hash}.webp`
    );
  });

  it("rejects browser requests from another origin", () => {
    expect(() =>
      assertLocalStudioRequest(
        new Request("http://127.0.0.1:3000/api/local-library", {
          method: "POST",
          headers: {
            origin: "https://example.com",
            "sec-fetch-site": "cross-site"
          }
        })
      )
    ).toThrow(/Cross-origin Local Studio requests are not allowed/);

    expect(() =>
      assertLocalStudioRequest(
        new Request("http://127.0.0.1:3000/api/local-library", {
          method: "POST",
          headers: {
            origin: "http://127.0.0.1:3000",
            "sec-fetch-site": "same-origin"
          }
        })
      )
    ).not.toThrow();
  });
});
