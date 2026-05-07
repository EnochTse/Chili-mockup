import { afterEach, describe, expect, it } from "vitest";
import handler from "../netlify/functions/generate-mockup";

const originalEnv = { ...process.env };

function makeLogo() {
  return {
    fileName: "client-logo.png",
    mimeType: "image/png",
    data: Buffer.from(new Uint8Array([137, 80, 78, 71])).toString("base64")
  };
}

function makeValidBody() {
  return {
    productSlug: "umbrella-classic-black",
    partPantones: {
      canopy: "Pantone 485 C"
    },
    logoPrintColor: "white",
    printingMethod: "silk_screen",
    logoFile: makeLogo()
  };
}

function makeRequest(body: unknown) {
  return new Request("http://localhost/.netlify/functions/generate-mockup", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });
}

describe("Netlify generate-mockup function", () => {
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("rejects missing logoFile", async () => {
    process.env.AI_STUB_MODE = "true";
    const body = makeValidBody() as any;
    delete body.logoFile;

    const response = await handler(makeRequest(body));
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json).toMatchObject({
      success: false,
      errorCode: "INVALID_LOGO_FILE"
    });
  });

  it("rejects invalid productSlug", async () => {
    process.env.AI_STUB_MODE = "true";
    const body = makeValidBody();
    body.productSlug = "missing-template";

    const response = await handler(makeRequest(body));
    const json = await response.json();

    expect(response.status).toBe(404);
    expect(json).toMatchObject({
      success: false,
      errorCode: "PRODUCT_TEMPLATE_NOT_FOUND"
    });
  });

  it("rejects unsupported logo file types", async () => {
    process.env.AI_STUB_MODE = "true";
    const body = makeValidBody();
    body.logoFile = {
      fileName: "logo.txt",
      mimeType: "text/plain",
      data: Buffer.from("plain").toString("base64")
    };

    const response = await handler(makeRequest(body));
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json).toMatchObject({
      success: false,
      errorCode: "INVALID_LOGO_FILE"
    });
  });

  it("rejects stub mode instead of returning a copied reference image", async () => {
    process.env.AI_STUB_MODE = "true";
    process.env.OUTPUT_STORAGE_MODE = "data_url";

    const response = await handler(makeRequest(makeValidBody()));
    const json = await response.json();

    expect(response.status).toBe(500);
    expect(json).toMatchObject({
      success: false,
      errorCode: "REAL_AI_REQUIRED"
    });
  });

  it("rejects real mode when GEMINI_API_KEY is missing", async () => {
    process.env.AI_STUB_MODE = "false";
    delete process.env.GEMINI_API_KEY;

    const response = await handler(makeRequest(makeValidBody()));
    const json = await response.json();

    expect(response.status).toBe(500);
    expect(json).toMatchObject({
      success: false,
      errorCode: "MISSING_GEMINI_API_KEY"
    });
  });
});
