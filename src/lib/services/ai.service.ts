import { GoogleGenAI } from "@google/genai";
import fs from "node:fs";
import path from "node:path";
import { AppError } from "@/lib/errors";
import { saveGeneratedImage } from "@/lib/services/storage.service";
import {
  getGeminiBatchMaxWaitMs,
  getGeminiBatchPollIntervalMs,
  getGeminiControlRequestTimeoutMs,
  getGeminiImageAspectRatio,
  getGeminiImageModel,
  getGeminiImageSize,
  getGeminiRequestTimeoutMs,
  isAiStubMode,
  requireGeminiApiKey
} from "@/lib/validators/env.validator";

export interface GenerateMockupInput {
  prompt: string;
  baseProductImagePath: string;
  instructionImagePath: string;
  productSlug: string;
  outputDir: string;
}

export interface GenerateMockupResult {
  imageUrl: string;
  provider: "stub" | "gemini";
  model: string;
  stubMode: boolean;
}

export interface GenerateMockupJobResult {
  jobName: string;
  state: string;
  provider: "gemini";
  model: string;
  stubMode: false;
}

export interface MockupJobStatusResult {
  completed: boolean;
  jobName: string;
  state: string;
  imageUrl?: string;
  provider: "gemini";
  model: string;
  stubMode: false;
}

export interface AiImageProvider {
  generateMockup(input: GenerateMockupInput): Promise<GenerateMockupResult>;
  createMockupJob(input: GenerateMockupInput): Promise<GenerateMockupJobResult>;
  getMockupJobStatus(jobName: string, productSlug: string): Promise<MockupJobStatusResult>;
}

export function detectMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".svg") return "image/svg+xml";
  throw new AppError("INVALID_LOGO_FILE", `Unsupported image type: ${ext}`, 400);
}

export function toInlineImagePart(filePath: string) {
  if (!fs.existsSync(filePath)) {
    throw new AppError("AI_GENERATION_FAILED", `Image file does not exist: ${filePath}`, 500);
  }

  return {
    inlineData: {
      mimeType: detectMimeType(filePath),
      data: fs.readFileSync(filePath).toString("base64")
    }
  };
}

export function buildGeminiContentParts(input: GenerateMockupInput) {
  return [
    { text: input.prompt },
    toInlineImagePart(input.baseProductImagePath),
    toInlineImagePart(input.instructionImagePath)
  ];
}

function buildGeminiGenerationConfig() {
  return {
    responseModalities: ["IMAGE"],
    imageConfig: {
      aspectRatio: getGeminiImageAspectRatio(),
      imageSize: getGeminiImageSize()
    }
  };
}

export function buildGeminiGenerateRequest(model: string, input: GenerateMockupInput) {
  return {
    model,
    contents: buildGeminiContentParts(input),
    config: {
      httpOptions: { timeout: getGeminiRequestTimeoutMs() },
      ...buildGeminiGenerationConfig()
    }
  };
}

export function buildGeminiBatchCreateRequest(model: string, input: GenerateMockupInput) {
  return {
    model,
    src: [
      {
        contents: buildGeminiContentParts(input),
        metadata: {
          productSlug: input.productSlug
        },
        config: buildGeminiGenerationConfig()
      }
    ],
    config: {
      displayName: `chili-mockup-${input.productSlug}-${Date.now()}`,
      httpOptions: { timeout: getGeminiControlRequestTimeoutMs() }
    }
  };
}

export function findInlineImagePart(response: any) {
  const candidates = response?.candidates || [];
  const parts = candidates.flatMap((candidate: any) => candidate?.content?.parts || []);

  return (
    [...parts].reverse().find((part: any) => part?.inlineData?.data && !part?.thought) ||
    [...parts].reverse().find((part: any) => part?.inlineData?.data)
  );
}

export function combineGeminiStreamResponses(chunks: any[]) {
  const allParts = chunks.flatMap((chunk) =>
    (chunk?.candidates || []).flatMap((candidate: any) => candidate?.content?.parts || [])
  );
  const lastCandidate = [...chunks]
    .reverse()
    .flatMap((chunk) => chunk?.candidates || [])
    .find(Boolean);
  const lastPromptFeedback = [...chunks]
    .reverse()
    .map((chunk) => chunk?.promptFeedback)
    .find(Boolean);

  return {
    candidates: [
      {
        ...lastCandidate,
        content: {
          ...(lastCandidate?.content || {}),
          parts: allParts
        }
      }
    ],
    promptFeedback: lastPromptFeedback
  };
}

export function extractGeminiBatchResponse(batchJob: any) {
  const inlinedResponses = batchJob?.dest?.inlinedResponses || [];
  const responseItem =
    inlinedResponses.find((item: any) => item?.response || item?.error) || inlinedResponses[0];

  return {
    response: responseItem?.response,
    error: responseItem?.error
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function summarizeBatchError(error: any) {
  return [error?.code, error?.status, error?.message, error?.details]
    .filter(Boolean)
    .map((part) => (typeof part === "string" ? part : JSON.stringify(part)))
    .join(" ");
}

function assertSafeGeminiBatchName(jobName: string) {
  if (!/^batches\/[A-Za-z0-9_-]+$/.test(jobName)) {
    throw new AppError("AI_GENERATION_FAILED", "Invalid Gemini batch job name.", 400);
  }
}

function mapBatchState(batchJob: any) {
  return batchJob?.state || "JOB_STATE_UNKNOWN";
}

function isTerminalFailureState(state: string) {
  return [
    "JOB_STATE_FAILED",
    "JOB_STATE_CANCELLED",
    "JOB_STATE_EXPIRED",
    "JOB_STATE_PAUSED"
  ].includes(state);
}

function makeBatchFailureError(batchJob: any) {
  const state = mapBatchState(batchJob);
  const details = [
    `name=${batchJob?.name || "unknown"}`,
    `state=${state}`,
    batchJob?.error ? `error=${summarizeBatchError(batchJob.error)}` : ""
  ]
    .filter(Boolean)
    .join("; ");

  return new AppError(
    "AI_GENERATION_FAILED",
    `Gemini batch generation did not complete successfully. ${details}`,
    502
  );
}

function extractGeminiError(error: unknown) {
  const candidate = error as {
    name?: string;
    status?: number;
    message?: string;
    cause?: {
      code?: string;
      name?: string;
      message?: string;
    };
  };
  const rawMessage = candidate?.message || "";
  const cause = candidate?.cause;
  const causeText = [cause?.code, cause?.name, cause?.message].filter(Boolean).join(" ");
  const jsonStart = rawMessage.indexOf("{");
  const parsed =
    jsonStart >= 0
      ? (() => {
          try {
            return JSON.parse(rawMessage.slice(jsonStart));
          } catch {
            return null;
          }
        })()
      : null;

  return {
    name: candidate?.name,
    status: candidate?.status || parsed?.error?.code,
    providerStatus: parsed?.error?.status,
    message: parsed?.error?.message || rawMessage,
    cause: causeText
  };
}

function sanitizeGeminiErrorMessage(message: string) {
  return message
    .replace(/AIza[0-9A-Za-z_-]+/g, "[redacted-api-key]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 700);
}

export function normalizeGeminiError(error: unknown): AppError {
  return normalizeGeminiErrorForModel(error, getGeminiImageModel());
}

function normalizeGeminiErrorForModel(error: unknown, model: string): AppError {
  if (error instanceof AppError) return error;

  const extracted = extractGeminiError(error);
  const message = extracted.message || "";
  const safeMessage = sanitizeGeminiErrorMessage(message);
  const safeCause = sanitizeGeminiErrorMessage(extracted.cause || "");
  const detailParts = [
    `model=${model}`,
    extracted.name ? `errorName=${extracted.name}` : "",
    extracted.status ? `status=${extracted.status}` : "",
    extracted.providerStatus ? `providerStatus=${extracted.providerStatus}` : "",
    safeMessage ? `message=${safeMessage}` : "",
    safeCause ? `cause=${safeCause}` : ""
  ].filter(Boolean);
  const safeDetails = detailParts.join("; ");
  console.error("Gemini image generation failed", safeDetails);

  const isQuotaError =
    extracted.status === 429 ||
    extracted.providerStatus === "RESOURCE_EXHAUSTED" ||
    /quota|rate limit|resource_exhausted/i.test(message);
  const isModelUnavailable =
    extracted.status === 503 ||
    extracted.providerStatus === "UNAVAILABLE" ||
    /high demand|temporarily unavailable|try again later|unavailable/i.test(message);
  const isNetworkError =
    extracted.name === "TypeError" ||
    /fetch failed|socket|und_err_socket|connection closed|other side closed/i.test(
      `${message} ${extracted.cause || ""}`
    );

  if (isQuotaError) {
    const retryMatch = message.match(/retry in ([^.]+(?:\.\d+)?s)/i);
    const retryText = retryMatch ? ` ${retryMatch[0]}.` : "";

    return new AppError(
      "AI_QUOTA_EXCEEDED",
      `Gemini reached Google, but this API project has no available quota for the configured image model (${model}).${retryText} Please enable billing or increase Gemini API quota for this model, then try again.`,
      429
    );
  }

  if (isModelUnavailable) {
    return new AppError(
      "AI_MODEL_UNAVAILABLE",
      `The configured Gemini image model (${model}) is currently experiencing high demand from Google. This is usually temporary; please wait a few minutes and try Generate mockup again.${
        process.env.NEXT_PUBLIC_SHOW_DEBUG === "true" && safeDetails
          ? ` Gemini detail: ${safeDetails}`
          : ""
      }`,
      503
    );
  }

  if (isNetworkError) {
    return new AppError(
      "AI_NETWORK_ERROR",
      `The Gemini connection closed before an image was returned for ${model}. This is usually transient; please try Generate mockup again.${
        process.env.NEXT_PUBLIC_SHOW_DEBUG === "true" && safeDetails
          ? ` Gemini detail: ${safeDetails}`
          : ""
      }`,
      502
    );
  }

  return new AppError(
    "AI_GENERATION_FAILED",
    `Gemini returned an error before producing an image. Please check the model, API key permissions, and request details.${
      process.env.NEXT_PUBLIC_SHOW_DEBUG === "true" && safeDetails
        ? ` Gemini detail: ${safeDetails}`
        : ""
    }`,
    extracted.status && extracted.status >= 400 && extracted.status < 600 ? extracted.status : 502
  );
}

export function summarizeGeminiNoImageResponse(response: any) {
  const candidate = response?.candidates?.[0];
  const parts = candidate?.content?.parts || [];
  const text = parts
    .map((part: any) => part?.text)
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  const safetyRatings = (candidate?.safetyRatings || [])
    .map((rating: any) => `${rating.category || "unknown"}:${rating.probability || "unknown"}`)
    .join(", ");
  const partTypes = parts
    .map((part: any) => Object.keys(part || {}).join("+"))
    .filter(Boolean)
    .join(", ");

  return {
    finishReason: candidate?.finishReason || "unknown",
    text: text.slice(0, 900),
    safetyRatings,
    partTypes,
    promptFeedback: response?.promptFeedback
      ? JSON.stringify(response.promptFeedback).slice(0, 600)
      : ""
  };
}

function makeNoImageReturnedError(response: any, model: string) {
  const summary = summarizeGeminiNoImageResponse(response);
  const details = [
    `model=${model}`,
    `finishReason=${summary.finishReason}`,
    summary.text ? `text="${summary.text}"` : "",
    summary.safetyRatings ? `safety=${summary.safetyRatings}` : "",
    summary.partTypes ? `parts=${summary.partTypes}` : "",
    summary.promptFeedback ? `promptFeedback=${summary.promptFeedback}` : ""
  ]
    .filter(Boolean)
    .join("; ");

  console.error("Gemini returned no image output", details);

  return new AppError(
    "AI_NO_IMAGE_RETURNED",
    `Gemini responded but did not include an image output. ${details}`,
    502
  );
}

export class StubAiImageProvider implements AiImageProvider {
  async generateMockup(): Promise<GenerateMockupResult> {
    throw new AppError(
      "REAL_AI_REQUIRED",
      "Real Gemini image generation is required. Set AI_STUB_MODE=false and configure GEMINI_API_KEY. Stub mode no longer returns copied product photos.",
      500
    );
  }

  async createMockupJob(): Promise<GenerateMockupJobResult> {
    throw new AppError(
      "REAL_AI_REQUIRED",
      "Real Gemini image generation is required. Set AI_STUB_MODE=false and configure GEMINI_API_KEY.",
      500
    );
  }

  async getMockupJobStatus(): Promise<MockupJobStatusResult> {
    throw new AppError(
      "REAL_AI_REQUIRED",
      "Real Gemini image generation is required. Set AI_STUB_MODE=false and configure GEMINI_API_KEY.",
      500
    );
  }
}

export class GeminiImageProvider implements AiImageProvider {
  private ai: GoogleGenAI;
  private model: string;

  constructor() {
    this.ai = new GoogleGenAI({
      apiKey: requireGeminiApiKey(),
      httpOptions: { timeout: getGeminiControlRequestTimeoutMs() }
    });
    this.model = getGeminiImageModel();
  }

  private async tryCancelBatchJob(name: string) {
    try {
      await (this.ai.batches.cancel as unknown as (request: unknown) => Promise<void>)({
        name,
        config: {
          httpOptions: { timeout: getGeminiControlRequestTimeoutMs() }
        }
      });
      console.info("Gemini batch job cancel requested", `name=${name}`);
    } catch (error) {
      console.warn(
        "Gemini batch job cancel failed",
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  private async waitForBatchResponse(batchJob: any) {
    const name = batchJob?.name;
    if (!name) {
      throw new AppError(
        "AI_GENERATION_FAILED",
        "Gemini batch generation did not return a batch job name.",
        502
      );
    }

    const startedAt = Date.now();
    const maxWaitMs = getGeminiBatchMaxWaitMs();
    const pollIntervalMs = getGeminiBatchPollIntervalMs();
    let currentJob = batchJob;
    let lastLoggedState = "";

    while (true) {
      const elapsedMs = Date.now() - startedAt;
      const state = currentJob?.state;
      if (state !== lastLoggedState || elapsedMs >= maxWaitMs) {
        lastLoggedState = state || "unknown";
        console.info(
          "Gemini batch job status",
          [
            `name=${name}`,
            `state=${state || "unknown"}`,
            `elapsedMs=${elapsedMs}`,
            currentJob?.dest?.inlinedResponses
              ? `inlineResponses=${currentJob.dest.inlinedResponses.length}`
              : ""
          ]
            .filter(Boolean)
            .join("; ")
        );
      }

      if (state === "JOB_STATE_SUCCEEDED") {
        console.info(
          "Gemini batch job completed",
          [`name=${name}`, `state=${state}`, `elapsedMs=${elapsedMs}`].join("; ")
        );
        return currentJob;
      }

      if (isTerminalFailureState(state)) {
        throw makeBatchFailureError(currentJob);
      }

      if (elapsedMs >= maxWaitMs) {
        await this.tryCancelBatchJob(name);
        throw new AppError(
          "AI_GENERATION_TIMEOUT",
          `Gemini accepted the batch generation job (${name}), but it was still ${
            state || "pending"
          } after ${Math.round(
            maxWaitMs / 1000
          )} seconds, so the app stopped waiting. Please try again later.`,
          504
        );
      }

      await sleep(Math.min(pollIntervalMs, Math.max(0, maxWaitMs - elapsedMs)));
      currentJob = await (this.ai.batches.get as unknown as (request: unknown) => Promise<any>)({
        name,
        config: {
          httpOptions: { timeout: getGeminiControlRequestTimeoutMs() }
        }
      });
    }
  }

  async generateMockup(input: GenerateMockupInput): Promise<GenerateMockupResult> {
    let response: any;
    let imagePart: any;

    try {
      console.info(
        "Gemini image generation started",
        [
          `model=${this.model}`,
          "mode=direct",
          `imageSize=${getGeminiImageSize()}`,
          `aspectRatio=${getGeminiImageAspectRatio()}`
        ].join("; ")
      );

      response = await this.ai.models.generateContent(buildGeminiGenerateRequest(this.model, input));
      imagePart = findInlineImagePart(response);
    } catch (error) {
      throw normalizeGeminiErrorForModel(error, this.model);
    }

    if (!imagePart?.inlineData?.data) {
      throw makeNoImageReturnedError(response, this.model);
    }

    const mimeType = imagePart.inlineData.mimeType || "image/png";
    const saved = await saveGeneratedImage(
      Buffer.from(imagePart.inlineData.data, "base64"),
      input.productSlug,
      mimeType
    );

    return {
      imageUrl: saved.imageUrl,
      provider: "gemini",
      model: this.model,
      stubMode: false
    };
  }

  async createMockupJob(input: GenerateMockupInput): Promise<GenerateMockupJobResult> {
    try {
      console.info(
        "Gemini image generation job start",
        [
          `model=${this.model}`,
          "mode=batch-start",
          `imageSize=${getGeminiImageSize()}`,
          `aspectRatio=${getGeminiImageAspectRatio()}`
        ].join("; ")
      );

      const batchJob = await (this.ai.batches.create as unknown as (
        request: unknown
      ) => Promise<any>)(buildGeminiBatchCreateRequest(this.model, input));
      const jobName = batchJob?.name;

      if (!jobName) {
        throw new AppError(
          "AI_GENERATION_FAILED",
          "Gemini batch generation did not return a batch job name.",
          502
        );
      }

      console.info(
        "Gemini batch job created",
        [`name=${jobName}`, `state=${mapBatchState(batchJob)}`].join("; ")
      );

      return {
        jobName,
        state: mapBatchState(batchJob),
        provider: "gemini",
        model: this.model,
        stubMode: false
      };
    } catch (error) {
      throw normalizeGeminiErrorForModel(error, this.model);
    }
  }

  async getMockupJobStatus(
    jobName: string,
    productSlug: string
  ): Promise<MockupJobStatusResult> {
    assertSafeGeminiBatchName(jobName);

    try {
      const batchJob = await (this.ai.batches.get as unknown as (
        request: unknown
      ) => Promise<any>)({
        name: jobName,
        config: {
          httpOptions: { timeout: getGeminiControlRequestTimeoutMs() }
        }
      });
      const state = mapBatchState(batchJob);
      console.info("Gemini batch job polled", [`name=${jobName}`, `state=${state}`].join("; "));

      if (state === "JOB_STATE_SUCCEEDED") {
        const batchResult = extractGeminiBatchResponse(batchJob);

        if (batchResult.error) {
          throw new AppError(
            "AI_GENERATION_FAILED",
            `Gemini batch request failed. ${summarizeBatchError(batchResult.error)}`,
            502
          );
        }

        const imagePart = findInlineImagePart(batchResult.response);
        if (!imagePart?.inlineData?.data) {
          throw makeNoImageReturnedError(batchResult.response, this.model);
        }

        const mimeType = imagePart.inlineData.mimeType || "image/png";
        const saved = await saveGeneratedImage(
          Buffer.from(imagePart.inlineData.data, "base64"),
          productSlug,
          mimeType
        );

        return {
          completed: true,
          jobName,
          state,
          imageUrl: saved.imageUrl,
          provider: "gemini",
          model: this.model,
          stubMode: false
        };
      }

      if (isTerminalFailureState(state)) {
        throw makeBatchFailureError(batchJob);
      }

      return {
        completed: false,
        jobName,
        state,
        provider: "gemini",
        model: this.model,
        stubMode: false
      };
    } catch (error) {
      throw normalizeGeminiErrorForModel(error, this.model);
    }
  }
}

export function createAiProvider(): AiImageProvider {
  if (isAiStubMode()) {
    throw new AppError(
      "REAL_AI_REQUIRED",
      "Real Gemini image generation is required. Set AI_STUB_MODE=false and configure GEMINI_API_KEY. Stub mode no longer returns copied product photos.",
      500
    );
  }

  requireGeminiApiKey();
  return new GeminiImageProvider();
}
