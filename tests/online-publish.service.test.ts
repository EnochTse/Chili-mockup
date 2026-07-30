import { afterEach, describe, expect, it } from "vitest";
import { defaultLayeredFinishRules } from "@/lib/services/finish-option.service";
import {
  buildOnlineTemplatePayload,
  getOnlineBlobObjectPath,
  getOnlinePublishConfiguration
} from "@/lib/services/online-publish.service";
import type { TemplatePublicDto } from "@/lib/types";

const originalEnvironment = {
  url: process.env.NEXT_PUBLIC_SUPABASE_URL,
  publishable: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  anon: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  secret: process.env.SUPABASE_SECRET_KEY,
  serviceRole: process.env.SUPABASE_SERVICE_ROLE_KEY
};

function restoreEnvironmentValue(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

afterEach(() => {
  restoreEnvironmentValue("NEXT_PUBLIC_SUPABASE_URL", originalEnvironment.url);
  restoreEnvironmentValue(
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    originalEnvironment.publishable
  );
  restoreEnvironmentValue("NEXT_PUBLIC_SUPABASE_ANON_KEY", originalEnvironment.anon);
  restoreEnvironmentValue("SUPABASE_SECRET_KEY", originalEnvironment.secret);
  restoreEnvironmentValue(
    "SUPABASE_SERVICE_ROLE_KEY",
    originalEnvironment.serviceRole
  );
});

function localReference(marker: string) {
  return `/api/local-library/assets/${marker.repeat(64)}.png`;
}

function makeTemplate(): TemplatePublicDto {
  const base = localReference("a");
  const instruction = localReference("b");
  const mask = localReference("c");
  const finish = localReference("d");
  const shadow = localReference("e");
  const printArea = localReference("f");

  return {
    id: "cloud-bottle",
    slug: "cloud-bottle",
    name: "Cloud Bottle",
    category: "Drinkware",
    description: "A complete online publishing fixture.",
    baseImageUrl: base,
    instructionImageUrl: instruction,
    usageType: "visual_reference_only",
    allowedLogoPrintColors: ["white"],
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
        description: "Bottle body.",
        partMaskImageFileName: mask,
        partMaskImageUrl: mask,
        defaultPantoneCode: "Pantone Black C",
        allowedFinishes: ["matte"],
        defaultFinish: "matte"
      }
    ],
    layeredRender: {
      enabled: true,
      mode: "local-layered",
      fallbackFinish: "matte",
      finishBaseImages: {
        matte: finish
      },
      materialMaps: {
        matte: {
          shadow
        }
      },
      partMasks: {
        body: mask
      },
      finishRules: {
        matte: defaultLayeredFinishRules.matte
      }
    },
    logoPlacement: {
      description: "Print area.",
      maxWidthMm: 40,
      maxHeightMm: 20,
      notes: "Keep inside the mask.",
      printingAreaImages: {
        silk_screen: printArea
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
  };
}

it("replaces every local asset reference and compacts the Pantone library", () => {
  const template = makeTemplate();
  const localReferences = Array.from(
    new Set(
      JSON.stringify(template).match(
        /\/api\/local-library\/assets\/[a-f0-9]{64}\.(?:png|jpe?g|webp)/g
      )
    )
  );
  const referenceMap = new Map(
    localReferences.map((reference, index) => [
      reference,
      `https://project.supabase.co/storage/v1/object/public/mockup-assets/blobs/${index}.png`
    ])
  );

  const payload = buildOnlineTemplatePayload(template, referenceMap);

  expect(JSON.stringify(payload)).not.toContain("/api/local-library/assets/");
  expect(payload.layeredRender?.materialMaps?.matte?.shadow).toContain(
    "project.supabase.co"
  );
  expect(payload.colorParts[0].partMaskImageFileName).toBe(
    payload.colorParts[0].partMaskImageUrl
  );
  expect(payload).not.toHaveProperty("pantoneOptions");
  expect(payload.pantoneLibrary).toBe("pantone-solid-coated-v3");
});

it("refuses to publish a template with unresolved localhost assets", () => {
  expect(() => buildOnlineTemplatePayload(makeTemplate(), new Map())).toThrow(
    /could not resolve/
  );
});

it("creates stable, content-addressed Supabase object paths", () => {
  const blobName = `${"a".repeat(64)}.png`;
  expect(getOnlineBlobObjectPath(blobName)).toBe(`blobs/aa/${blobName}`);
  expect(() => getOnlineBlobObjectPath("../unsafe.png")).toThrow(
    /invalid content hash/
  );
});

it("requires a public client key and a server-only secret key", () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
  delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  delete process.env.SUPABASE_SECRET_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;

  expect(getOnlinePublishConfiguration()).toMatchObject({
    configured: false,
    missing: [
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      "SUPABASE_SECRET_KEY"
    ]
  });

  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
  process.env.SUPABASE_SECRET_KEY = "sb_secret_test";
  expect(getOnlinePublishConfiguration()).toMatchObject({
    configured: true,
    missing: []
  });
});
