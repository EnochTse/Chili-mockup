import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createLocalUploadReference,
  getLocalUploadFormField
} from "@/lib/local-library/asset-reference";
import {
  buildLocalProductPackage,
  getLocalLibrarySnapshot,
  getLocalTemplate,
  importLocalProductPackage,
  rollbackLocalProduct,
  saveLocalReleaseFromFormData
} from "@/lib/services/local-library.service";
import { defaultLayeredFinishRules } from "@/lib/services/finish-option.service";
import {
  createStoredZip,
  readStoredZip
} from "@/lib/services/zip-archive.service";
import type { TemplatePublicDto } from "@/lib/types";

function makePng(width: number, height: number, marker: number) {
  const buffer = Buffer.alloc(32, marker);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0);
  buffer.write("IHDR", 12, "ascii");
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

function makeJpeg(width: number, height: number) {
  const buffer = Buffer.alloc(23);
  buffer.set([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08]);
  buffer.writeUInt16BE(height, 7);
  buffer.writeUInt16BE(width, 9);
  buffer[11] = 3;
  buffer.set([0xff, 0xd9], 21);
  return buffer;
}

function makeTemplate(): {
  template: TemplatePublicDto;
  uploads: Array<{ reference: string; file: File }>;
} {
  const baseReference = createLocalUploadReference("base", "product-base");
  const instructionReference = createLocalUploadReference("instruction", "instruction");
  const partMaskReference = createLocalUploadReference("part-mask", "body");
  const matteReference = createLocalUploadReference("finish-base", "matte");
  const printAreaReference = createLocalUploadReference("printing-area", "silk_screen");

  return {
    template: {
      id: "test-bottle",
      slug: "test-bottle",
      name: "Test Bottle",
      category: "Drinkware",
      description: "A product used to verify the Local Asset Library.",
      size: "500 ml",
      specifications: [{ label: "Capacity", value: "500 ml" }],
      baseImageUrl: baseReference,
      instructionImageUrl: instructionReference,
      usageType: "visual_reference_only",
      allowedLogoPrintColors: ["white", "black"],
      defaultLogoPrintColor: "white",
      allowedPrintingMethods: ["silk_screen"],
      pantoneOptions: [
        {
          code: "Pantone Black C",
          label: "Pantone Black C",
          previewHex: "#000000"
        }
      ],
      colorParts: [
        {
          id: "body",
          label: "Body",
          description: "Main bottle body.",
          partMaskImageUrl: partMaskReference,
          partMaskImageFileName: partMaskReference,
          defaultPantoneCode: "Pantone Black C",
          allowedFinishes: ["matte"],
          defaultFinish: "matte"
        }
      ],
      layeredRender: {
        enabled: true,
        mode: "local-layered",
        outputSize: {
          width: 1024,
          height: 1024
        },
        fallbackFinish: "matte",
        finishBaseImages: {
          matte: matteReference
        },
        partMasks: {
          body: partMaskReference
        },
        finishRules: {
          matte: defaultLayeredFinishRules.matte
        }
      },
      logoPlacement: {
        description: "Keep the logo inside the print area.",
        maxWidthMm: 40,
        maxHeightMm: 20,
        notes: "Test placement.",
        orientationPreset: "horizontal",
        printingAreaImages: {
          silk_screen: printAreaReference
        }
      },
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
    uploads: [
      {
        reference: baseReference,
        file: new File([makePng(1200, 1200, 1)], "base.png", { type: "image/png" })
      },
      {
        reference: instructionReference,
        file: new File([makePng(1200, 1200, 2)], "instruction.png", {
          type: "image/png"
        })
      },
      {
        reference: partMaskReference,
        file: new File([makePng(1024, 1024, 3)], "body-mask.png", {
          type: "image/png"
        })
      },
      {
        reference: matteReference,
        file: new File([makePng(1024, 1024, 4)], "matte.png", {
          type: "image/png"
        })
      },
      {
        reference: printAreaReference,
        file: new File([makePng(1024, 1024, 5)], "print-area.png", {
          type: "image/png"
        })
      }
    ]
  };
}

function makeSaveForm(status: "draft" | "published", template: TemplatePublicDto) {
  const formData = new FormData();
  formData.append("status", status);
  formData.append("template", JSON.stringify(template));
  return formData;
}

describe("Local Asset Library", () => {
  let libraryRoot = "";
  const originalLibraryPath = process.env.CHILI_LOCAL_LIBRARY_PATH;

  beforeEach(async () => {
    libraryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "chili-local-library-test-"));
    process.env.CHILI_LOCAL_LIBRARY_PATH = libraryRoot;
  });

  afterEach(async () => {
    if (originalLibraryPath === undefined) {
      delete process.env.CHILI_LOCAL_LIBRARY_PATH;
    } else {
      process.env.CHILI_LOCAL_LIBRARY_PATH = originalLibraryPath;
    }
    await fs.rm(libraryRoot, { recursive: true, force: true });
  });

  it("saves immutable releases, publishes, rolls back, exports, and imports", async () => {
    const source = makeTemplate();
    const draftForm = makeSaveForm("draft", source.template);
    for (const upload of source.uploads) {
      draftForm.append(getLocalUploadFormField(upload.reference), upload.file);
    }

    const draft = await saveLocalReleaseFromFormData(draftForm);
    expect(draft.version).toBe(1);
    expect(draft.status).toBe("draft");
    expect(draft.snapshot.catalog.products[0].publishedVersion).toBeUndefined();
    expect(draft.snapshot.catalog.products[0].releases[0].warnings).toContain(
      "The product base image is below 2048px and may look soft in downloaded mockups."
    );

    const publishForm = makeSaveForm("published", draft.template);
    const published = await saveLocalReleaseFromFormData(publishForm);
    expect(published.version).toBe(2);
    expect(published.snapshot.catalog.products[0].publishedVersion).toBe(2);
    expect(published.snapshot.catalog.products[0].publishedSummary?.slug).toBe(
      "test-bottle"
    );
    expect(published.snapshot.publishedSummaries).toHaveLength(1);
    expect(published.snapshot).not.toHaveProperty("templates");
    expect(published.snapshot.catalog.products[0].releases).toHaveLength(2);

    const lightweightSnapshot = await getLocalLibrarySnapshot();
    expect(lightweightSnapshot.catalog.products[0].releaseCount).toBe(2);
    expect(lightweightSnapshot.catalog.products[0].releases).toHaveLength(1);

    const blobs = await fs.readdir(path.resolve(libraryRoot, "blobs"));
    expect(blobs).toHaveLength(5);

    const publishedTemplate = await getLocalTemplate("test-bottle", "published");
    expect(publishedTemplate?.version).toBe(2);
    expect(publishedTemplate?.product?.releases).toHaveLength(2);
    expect(publishedTemplate?.template.baseImageUrl).toMatch(
      /^\/api\/local-library\/assets\//
    );

    const productPackage = await buildLocalProductPackage("test-bottle", 2);
    expect(productPackage.fileName).toBe("test-bottle-v2.chili-product.zip");
    expect(productPackage.buffer.length).toBeGreaterThan(100);

    const rollback = await rollbackLocalProduct("test-bottle", 1);
    expect(rollback.publishedVersion).toBe(1);
    expect((await getLocalLibrarySnapshot()).catalog.products[0].publishedVersion).toBe(1);

    const importedRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "chili-local-library-import-test-")
    );
    process.env.CHILI_LOCAL_LIBRARY_PATH = importedRoot;
    try {
      const importForm = new FormData();
      importForm.append(
        "package",
        new File([productPackage.buffer], productPackage.fileName, {
          type: "application/zip"
        })
      );
      const imported = await importLocalProductPackage(importForm);
      expect(imported.version).toBe(1);
      expect(imported.template.slug).toBe("test-bottle");
      expect(imported.snapshot.catalog.products[0].latestDraftVersion).toBe(1);
    } finally {
      await fs.rm(importedRoot, { recursive: true, force: true });
      process.env.CHILI_LOCAL_LIBRARY_PATH = libraryRoot;
    }
  });

  it("rejects misaligned material assets before writing a release", async () => {
    const source = makeTemplate();
    const matteUpload = source.uploads.find((upload) =>
      upload.reference.includes("finish-base")
    );
    if (!matteUpload) throw new Error("Missing test material upload.");
    matteUpload.file = new File([makePng(800, 1024, 9)], "matte.png", {
      type: "image/png"
    });

    const formData = makeSaveForm("draft", source.template);
    for (const upload of source.uploads) {
      formData.append(getLocalUploadFormField(upload.reference), upload.file);
    }

    await expect(saveLocalReleaseFromFormData(formData)).rejects.toThrow(
      /every compositing layer in this view must use the 1024:1024 aspect ratio/
    );
    expect((await getLocalLibrarySnapshot()).catalog.products).toHaveLength(0);
    expect(await fs.readdir(path.resolve(libraryRoot, "blobs"))).toHaveLength(0);
  });

  it("keeps legacy JPEG print areas usable with a quality warning", async () => {
    const source = makeTemplate();
    const printAreaUpload = source.uploads.find((upload) =>
      upload.reference.includes("printing-area")
    );
    if (!printAreaUpload) throw new Error("Missing test printing-area upload.");
    printAreaUpload.file = new File([makeJpeg(1024, 1024)], "print-area.jpg", {
      type: "image/jpeg"
    });

    const formData = makeSaveForm("draft", source.template);
    for (const upload of source.uploads) {
      formData.append(getLocalUploadFormField(upload.reference), upload.file);
    }

    const result = await saveLocalReleaseFromFormData(formData);
    expect(result.snapshot.catalog.products[0].releases[0].warnings).toContain(
      "A printing-area mask uses legacy JPEG. It remains usable, but PNG or WebP will keep red-mask edges more accurate."
    );
  });

  it("stores product-specific calibrated material maps", async () => {
    const source = makeTemplate();
    const shadowReference = createLocalUploadReference(
      "material-map",
      "matte:shadow"
    );
    if (!source.template.layeredRender) {
      throw new Error("Missing test layered renderer.");
    }
    source.template.layeredRender.materialMaps = {
      matte: {
        shadow: shadowReference
      }
    };
    source.uploads.push({
      reference: shadowReference,
      file: new File([makePng(1024, 1024, 6)], "matte-shadow.png", {
        type: "image/png"
      })
    });

    const formData = makeSaveForm("draft", source.template);
    for (const upload of source.uploads) {
      formData.append(getLocalUploadFormField(upload.reference), upload.file);
    }

    const result = await saveLocalReleaseFromFormData(formData);
    expect(result.template.layeredRender?.materialMaps?.matte?.shadow).toMatch(
      /^\/api\/local-library\/assets\/[a-f0-9]{64}\.png$/
    );
    expect(result.snapshot.catalog.products[0].releases[0].warnings).not.toContain(
      "matte uses maps derived from its reference image. Add calibrated maps only if the visual reference is not accurate enough."
    );
    expect(await fs.readdir(path.resolve(libraryRoot, "blobs"))).toHaveLength(6);
  });

  it("treats a legacy base-only material map as automatic", async () => {
    const source = makeTemplate();
    const matteReference = source.template.layeredRender?.finishBaseImages.matte;
    if (!matteReference || !source.template.layeredRender) {
      throw new Error("Missing test matte reference.");
    }
    source.template.layeredRender.materialMaps = {
      matte: {
        base: matteReference
      }
    };

    const formData = makeSaveForm("draft", source.template);
    for (const upload of source.uploads) {
      formData.append(getLocalUploadFormField(upload.reference), upload.file);
    }

    const result = await saveLocalReleaseFromFormData(formData);
    expect(result.snapshot.catalog.products[0].releases[0].warnings).toContain(
      "matte uses maps derived from its reference image. Add calibrated maps only if the visual reference is not accurate enough."
    );
  });

  it("does not overwrite an orphaned release manifest", async () => {
    const orphanPath = path.resolve(
      libraryRoot,
      "products",
      "test-bottle",
      "releases",
      "v1.json"
    );
    await fs.mkdir(path.dirname(orphanPath), { recursive: true });
    await fs.writeFile(orphanPath, "orphaned release", "utf8");
    const source = makeTemplate();
    const formData = makeSaveForm("draft", source.template);
    for (const upload of source.uploads) {
      formData.append(getLocalUploadFormField(upload.reference), upload.file);
    }

    const result = await saveLocalReleaseFromFormData(formData);
    expect(result.version).toBe(2);
    expect(await fs.readFile(orphanPath, "utf8")).toBe("orphaned release");
  });

  it("rejects SVG product assets served from the Local Studio origin", async () => {
    const source = makeTemplate();
    const baseUpload = source.uploads.find(
      (upload) => upload.reference === source.template.baseImageUrl
    );
    if (!baseUpload) throw new Error("Missing test base upload.");
    baseUpload.file = new File(
      ['<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200"></svg>'],
      "base.svg",
      { type: "image/svg+xml" }
    );

    const formData = makeSaveForm("draft", source.template);
    for (const upload of source.uploads) {
      formData.append(getLocalUploadFormField(upload.reference), upload.file);
    }

    await expect(saveLocalReleaseFromFormData(formData)).rejects.toThrow(
      /SVG is not accepted for same-origin product assets/
    );
  });

  it("enforces lossless rules when one source is shared across multiple roles", async () => {
    const source = makeTemplate();
    const matteReference = source.template.layeredRender?.finishBaseImages.matte;
    if (!matteReference || !source.template.layeredRender) {
      throw new Error("Missing test matte reference.");
    }
    source.template.layeredRender.materialMaps = {
      matte: {
        base: matteReference
      }
    };
    const matteUpload = source.uploads.find((upload) => upload.reference === matteReference);
    if (!matteUpload) throw new Error("Missing test matte upload.");
    matteUpload.file = new File([makeJpeg(1024, 1024)], "matte.jpg", {
      type: "image/jpeg"
    });

    const formData = makeSaveForm("draft", source.template);
    for (const upload of source.uploads) {
      formData.append(getLocalUploadFormField(upload.reference), upload.file);
    }

    await expect(saveLocalReleaseFromFormData(formData)).rejects.toThrow(
      /must use lossless PNG or WebP/
    );
  });

  it("rejects a package manifest that omits a referenced asset binding", async () => {
    const source = makeTemplate();
    const formData = makeSaveForm("draft", source.template);
    for (const upload of source.uploads) {
      formData.append(getLocalUploadFormField(upload.reference), upload.file);
    }
    await saveLocalReleaseFromFormData(formData);

    const productPackage = await buildLocalProductPackage("test-bottle", 1);
    const entries = readStoredZip(productPackage.buffer);
    const tamperedEntries = entries.map((entry) => {
      if (!entry.name.endsWith("/manifest.json")) return entry;
      const manifest = JSON.parse(entry.data.toString("utf8")) as {
        assets: Array<{ roles: string[] }>;
      };
      manifest.assets = manifest.assets.filter((asset) => !asset.roles.includes("base"));
      return {
        ...entry,
        data: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8")
      };
    });
    const importForm = new FormData();
    importForm.append(
      "package",
      new File([createStoredZip(tamperedEntries)], "tampered.chili-product.zip", {
        type: "application/zip"
      })
    );

    await expect(importLocalProductPackage(importForm)).rejects.toThrow(
      /asset manifest is missing base/
    );
  });
});
