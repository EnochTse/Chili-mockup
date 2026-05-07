import { AppError } from "@/lib/errors";

export function isAiStubMode() {
  return process.env.AI_STUB_MODE === "true";
}

export function getGeminiImageModel() {
  return process.env.GEMINI_IMAGE_MODEL || "gemini-3.1-flash-image-preview";
}

export function getGeminiImageAspectRatio() {
  return process.env.GEMINI_IMAGE_ASPECT_RATIO || "1:1";
}

export function getGeminiImageSize() {
  return process.env.GEMINI_IMAGE_SIZE || "1K";
}

export function getGeminiRequestTimeoutMs() {
  const parsed = Number.parseInt(process.env.GEMINI_REQUEST_TIMEOUT_MS || "", 10);
  if (Number.isFinite(parsed) && parsed >= 60000) return parsed;
  return 300000;
}

export function getGeminiControlRequestTimeoutMs() {
  const parsed = Number.parseInt(process.env.GEMINI_CONTROL_REQUEST_TIMEOUT_MS || "", 10);
  if (Number.isFinite(parsed) && parsed >= 5000) return parsed;
  return 20000;
}

export function getGeminiBatchPollIntervalMs() {
  const parsed = Number.parseInt(process.env.GEMINI_BATCH_POLL_INTERVAL_MS || "", 10);
  if (Number.isFinite(parsed) && parsed >= 1000) return parsed;
  return 5000;
}

export function getGeminiBatchMaxWaitMs() {
  const parsed = Number.parseInt(process.env.GEMINI_BATCH_MAX_WAIT_MS || "", 10);
  if (Number.isFinite(parsed) && parsed >= 60000) return parsed;
  return 180000;
}

export function requireGeminiApiKey() {
  const apiKey =
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.GOOGLE_GENAI_API_KEY;
  if (!apiKey) {
    throw new AppError(
      "MISSING_GEMINI_API_KEY",
      "Gemini API key is missing in the server runtime. Configure GEMINI_API_KEY in Netlify environment variables with Functions scope before generating real mockups.",
      500
    );
  }

  return apiKey;
}
