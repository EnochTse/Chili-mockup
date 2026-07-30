import { describe, expect, it } from "vitest";
import {
  createStoredZip,
  readStoredZip
} from "@/lib/services/zip-archive.service";

describe("stored ZIP product packages", () => {
  it("round-trips UTF-8 file names and binary data", () => {
    const archive = createStoredZip([
      {
        name: "chili-product/bottle/manifest.json",
        data: Buffer.from('{"slug":"bottle"}', "utf8")
      },
      {
        name: "chili-product/bottle/assets/test.png",
        data: Buffer.from([0, 1, 2, 3, 255])
      }
    ]);

    const entries = readStoredZip(archive);
    expect(entries.map((entry) => entry.name)).toEqual([
      "chili-product/bottle/manifest.json",
      "chili-product/bottle/assets/test.png"
    ]);
    expect(entries[1].data).toEqual(Buffer.from([0, 1, 2, 3, 255]));
  });

  it("rejects unsafe archive paths", () => {
    expect(() =>
      createStoredZip([
        {
          name: "../catalog.json",
          data: Buffer.from("unsafe")
        }
      ])
    ).toThrow(/Unsafe ZIP entry path/);
  });

  it("rejects truncated input with a stable validation error", () => {
    expect(() => readStoredZip(Buffer.from("not-a-zip"))).toThrow(
      "The product package is not a valid ZIP archive."
    );
  });
});
