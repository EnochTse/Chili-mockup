import { afterEach, describe, expect, it } from "vitest";
import {
  buildGeminiBatchCreateRequest,
  buildGeminiContentParts,
  combineGeminiStreamResponses,
  createAiProvider,
  extractGeminiBatchResponse,
  findInlineImagePart,
  GeminiImageProvider,
  normalizeGeminiError,
  summarizeGeminiNoImageResponse,
  StubAiImageProvider
} from "@/lib/services/ai.service";
import { getGeminiImageModel, getGeminiImageSize } from "@/lib/validators/env.validator";
import { loadTemplate } from "@/lib/services/template.service";

const originalEnv = { ...process.env };

describe("ai.service", () => {
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("blocks stub mode so copied product photos cannot be returned as generated results", () => {
    process.env.AI_STUB_MODE = "true";
    delete process.env.GEMINI_API_KEY;

    expect(() => createAiProvider()).toThrow("Real Gemini image generation is required");
  });

  it("keeps the stub provider class from returning copied images", async () => {
    const provider = new StubAiImageProvider();

    await expect(provider.generateMockup()).rejects.toThrow(
      "Stub mode no longer returns copied product photos"
    );
  });

  it("throws when real mode is selected without GEMINI_API_KEY", () => {
    process.env.AI_STUB_MODE = "false";
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    delete process.env.GOOGLE_GENAI_API_KEY;

    expect(() => createAiProvider()).toThrow(
      "Gemini API key is missing in the server runtime."
    );
  });

  it("selects Gemini provider when real mode has GEMINI_API_KEY", () => {
    process.env.AI_STUB_MODE = "false";
    process.env.GEMINI_API_KEY = "test-key";

    expect(createAiProvider()).toBeInstanceOf(GeminiImageProvider);
  });

  it("accepts GOOGLE_API_KEY as a Gemini API key alias", () => {
    process.env.AI_STUB_MODE = "false";
    delete process.env.GEMINI_API_KEY;
    process.env.GOOGLE_API_KEY = "test-key";

    expect(createAiProvider()).toBeInstanceOf(GeminiImageProvider);
  });

  it("defaults to the Nano Banana 2 model", () => {
    delete process.env.GEMINI_IMAGE_MODEL;

    expect(getGeminiImageModel()).toBe("gemini-3.1-flash-image-preview");
  });

  it("defaults Gemini image output to 1K to keep generation faster and lower cost", () => {
    delete process.env.GEMINI_IMAGE_SIZE;

    expect(getGeminiImageSize()).toBe("1K");
  });

  it("builds prompt plus exactly two inline image inputs for Gemini", async () => {
    const template = await loadTemplate("umbrella-classic-black");
    const parts = buildGeminiContentParts({
      prompt: "test prompt",
      baseProductImagePath: template.baseProductImagePath,
      instructionImagePath: template.instructionImagePath,
      productSlug: template.slug,
      outputDir: "public/generated"
    });

    expect(parts).toHaveLength(3);
    expect(parts.filter((part) => "inlineData" in part)).toHaveLength(2);
  });

  it("builds a single inlined batch request for Gemini image generation", async () => {
    const template = await loadTemplate("umbrella-classic-black");
    const request = buildGeminiBatchCreateRequest("gemini-test-image", {
      prompt: "test prompt",
      baseProductImagePath: template.baseProductImagePath,
      instructionImagePath: template.instructionImagePath,
      productSlug: template.slug,
      outputDir: "public/generated"
    }) as any;

    expect(request.model).toBe("gemini-test-image");
    expect(request.src).toHaveLength(1);
    expect(request.src[0].contents).toHaveLength(3);
    expect(request.src[0].config).toMatchObject({
      responseModalities: ["IMAGE"],
      imageConfig: {
        imageSize: "1K"
      }
    });
    expect(request.src[0].config.httpOptions).toBeUndefined();
    expect(request.config.httpOptions.timeout).toBeGreaterThanOrEqual(5000);
  });

  it("finds image output from streamed Gemini response chunks", () => {
    const imagePart = { inlineData: { mimeType: "image/png", data: "abc123" } };
    const response = combineGeminiStreamResponses([
      {
        candidates: [
          {
            content: {
              parts: [{ text: "working" }]
            }
          }
        ]
      },
      {
        candidates: [
          {
            finishReason: "STOP",
            content: {
              parts: [imagePart]
            }
          }
        ]
      }
    ]);

    expect(findInlineImagePart(response)).toBe(imagePart);
  });

  it("extracts image responses from completed Gemini batch jobs", () => {
    const response = {
      candidates: [
        {
          content: {
            parts: [{ inlineData: { mimeType: "image/png", data: "abc123" } }]
          }
        }
      ]
    };

    expect(
      extractGeminiBatchResponse({
        dest: {
          inlinedResponses: [{ response }]
        }
      })
    ).toMatchObject({ response });
  });

  it("keeps streamed no-image details useful for debugging", () => {
    const response = combineGeminiStreamResponses([
      {
        candidates: [
          {
            content: {
              parts: [{ text: "I cannot generate this." }]
            }
          }
        ]
      },
      {
        candidates: [
          {
            finishReason: "SAFETY",
            safetyRatings: [{ category: "HARM_CATEGORY_TEST", probability: "MEDIUM" }]
          }
        ]
      }
    ]);

    expect(summarizeGeminiNoImageResponse(response)).toMatchObject({
      finishReason: "SAFETY",
      text: "I cannot generate this.",
      safetyRatings: "HARM_CATEGORY_TEST:MEDIUM",
      partTypes: "text"
    });
  });

  it("normalizes Gemini quota errors into clear API responses", () => {
    const error = normalizeGeminiError({
      status: 429,
      message:
        '{"error":{"code":429,"message":"You exceeded your current quota. Please retry in 8s.","status":"RESOURCE_EXHAUSTED"}}'
    });

    expect(error).toMatchObject({
      errorCode: "AI_QUOTA_EXCEEDED",
      statusCode: 429
    });
    expect(error.message).toContain("no available quota");
  });

  it("normalizes temporary Gemini model demand errors into retryable busy responses", () => {
    const error = normalizeGeminiError({
      name: "ApiError",
      status: 503,
      message:
        '{"error":{"code":503,"message":"This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.","status":"UNAVAILABLE"}}'
    });

    expect(error).toMatchObject({
      errorCode: "AI_MODEL_UNAVAILABLE",
      statusCode: 503
    });
    expect(error.message).toContain("high demand");
  });

  it("normalizes Gemini socket closures into clear network retry responses", () => {
    const error = normalizeGeminiError({
      name: "TypeError",
      message: "fetch failed",
      cause: {
        code: "UND_ERR_SOCKET",
        name: "SocketError",
        message: "other side closed"
      }
    });

    expect(error).toMatchObject({
      errorCode: "AI_NETWORK_ERROR",
      statusCode: 502
    });
    expect(error.message).toContain("connection closed");
  });

  it("summarizes text-only Gemini responses for deploy debugging", () => {
    const summary = summarizeGeminiNoImageResponse({
      candidates: [
        {
          finishReason: "STOP",
          content: {
            parts: [{ text: "I cannot produce the requested image." }]
          },
          safetyRatings: [{ category: "HARM_CATEGORY_TEST", probability: "LOW" }]
        }
      ]
    });

    expect(summary).toMatchObject({
      finishReason: "STOP",
      text: "I cannot produce the requested image.",
      safetyRatings: "HARM_CATEGORY_TEST:LOW",
      partTypes: "text"
    });
  });
});
