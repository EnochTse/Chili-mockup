import { createServer } from "node:http";
import { Buffer } from "node:buffer";
import { GoogleGenAI } from "@google/genai";

const port = Number.parseInt(process.env.PORT || "8080", 10);
const model = process.env.GEMINI_IMAGE_MODEL || "gemini-3.1-flash-image-preview";
const aspectRatio = process.env.GEMINI_IMAGE_ASPECT_RATIO || "1:1";
const imageSize = process.env.GEMINI_IMAGE_SIZE || "1K";
const requestTimeoutMs = parsePositiveInt(process.env.GEMINI_REQUEST_TIMEOUT_MS, 360000, 60000);
const maxRemoteImageBytes = parsePositiveInt(process.env.MAX_REMOTE_IMAGE_BYTES, 12 * 1024 * 1024, 1024);
const showDebug = process.env.SHOW_DEBUG === "true";
const allowedOriginPatterns = (process.env.ALLOWED_ORIGIN_PATTERNS ||
  "https://*.netlify.app,http://localhost:3000,http://127.0.0.1:3000")
  .split(",")
  .map((pattern) => pattern.trim())
  .filter(Boolean);

const geminiApiKey =
  process.env.GEMINI_API_KEY ||
  process.env.GOOGLE_API_KEY ||
  process.env.GOOGLE_GENAI_API_KEY;

if (!geminiApiKey) {
  throw new Error("Missing GEMINI_API_KEY for Cloud Run mockup service.");
}

const ai = new GoogleGenAI({
  apiKey: geminiApiKey,
  httpOptions: { timeout: requestTimeoutMs }
});

function parsePositiveInt(value, fallback, minimum) {
  const parsed = Number.parseInt(value || "", 10);
  if (Number.isFinite(parsed) && parsed >= minimum) {
    return parsed;
  }

  return fallback;
}

function json(response, statusCode, body, origin) {
  response.writeHead(statusCode, buildCorsHeaders(origin, { "content-type": "application/json" }));
  response.end(JSON.stringify(body));
}

function buildCorsHeaders(origin, extraHeaders = {}) {
  const headers = {
    "cache-control": "no-store",
    vary: "origin",
    ...extraHeaders
  };

  if (origin && isAllowedOrigin(origin)) {
    headers["access-control-allow-origin"] = origin;
    headers["access-control-allow-methods"] = "POST, OPTIONS, GET";
    headers["access-control-allow-headers"] = "content-type";
  }

  return headers;
}

function isAllowedOrigin(origin) {
  if (!origin) return true;

  return allowedOriginPatterns.some((pattern) => matchesOriginPattern(origin, pattern));
}

function matchesOriginPattern(origin, pattern) {
  if (pattern === "*") return true;
  if (!pattern.includes("*")) return origin === pattern;

  const [prefix, suffix] = pattern.split("*");
  return origin.startsWith(prefix) && origin.endsWith(suffix);
}

function sanitizeDebugText(value) {
  return String(value || "")
    .replace(/AIza[0-9A-Za-z_-]+/g, "[redacted-api-key]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 700);
}

function appError(errorCode, message, statusCode, details) {
  const error = new Error(message);
  error.errorCode = errorCode;
  error.statusCode = statusCode;
  error.details = details;
  return error;
}

async function readJsonBody(request) {
  const chunks = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    totalBytes += chunk.length;
    if (totalBytes > 256 * 1024) {
      throw appError("INVALID_FORM_DATA", "Request body is too large.", 413);
    }
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) {
    throw appError("INVALID_FORM_DATA", "Request body is required.", 400);
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw appError("INVALID_FORM_DATA", "Request body must be valid JSON.", 400);
  }
}

function readRequiredString(value, fieldName) {
  if (typeof value !== "string" || !value.trim()) {
    throw appError("INVALID_FORM_DATA", `${fieldName} is required.`, 400);
  }

  return value.trim();
}

function readImageUrl(value, fieldName) {
  const url = readRequiredString(value, fieldName);
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error("Invalid protocol");
    }
    return parsed.toString();
  } catch {
    throw appError("INVALID_FORM_DATA", `${fieldName} must be a valid http(s) URL.`, 400);
  }
}

function readOptionalImageUrlArray(value, fieldName) {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    throw appError("INVALID_FORM_DATA", `${fieldName} must be an array of http(s) URLs.`, 400);
  }

  return value.map((item, index) => readImageUrl(item, `${fieldName}[${index}]`));
}

async function fetchImageAsInlinePart(imageUrl) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(imageUrl, {
      signal: controller.signal,
      headers: {
        accept: "image/*"
      }
    });

    if (!response.ok) {
      throw appError(
        "AI_GENERATION_FAILED",
        `Could not fetch the required source image (${response.status}).`,
        502
      );
    }

    const contentType = (response.headers.get("content-type") || "").split(";")[0].trim();
    if (!contentType.startsWith("image/")) {
      throw appError(
        "AI_GENERATION_FAILED",
        `Source asset returned ${contentType || "unknown"} instead of an image.`,
        502
      );
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length) {
      throw appError("AI_GENERATION_FAILED", "Source image was empty.", 502);
    }

    if (bytes.length > maxRemoteImageBytes) {
      throw appError("AI_GENERATION_FAILED", "Source image is too large for Cloud Run fetch.", 413);
    }

    return {
      inlineData: {
        mimeType: contentType,
        data: bytes.toString("base64")
      }
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw appError("AI_NETWORK_ERROR", "Timed out while fetching a required source image.", 504);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function findInlineImagePart(response) {
  const candidates = response?.candidates || [];
  const parts = candidates.flatMap((candidate) => candidate?.content?.parts || []);

  return (
    [...parts].reverse().find((part) => part?.inlineData?.data && !part?.thought) ||
    [...parts].reverse().find((part) => part?.inlineData?.data)
  );
}

function summarizeNoImageResponse(response) {
  const candidate = response?.candidates?.[0];
  const parts = candidate?.content?.parts || [];
  const text = parts
    .map((part) => part?.text)
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 800);

  return {
    finishReason: candidate?.finishReason || "unknown",
    text
  };
}

function normalizeGeminiError(error) {
  const rawMessage = sanitizeDebugText(error?.message || error?.cause?.message || "");
  const statusCode = typeof error?.status === "number" ? error.status : 502;

  if (/quota|rate limit|resource_exhausted/i.test(rawMessage)) {
    return appError(
      "AI_QUOTA_EXCEEDED",
      `Gemini quota is currently exhausted for ${model}.`,
      429,
      rawMessage
    );
  }

  if (/high demand|temporarily unavailable|unavailable/i.test(rawMessage)) {
    return appError(
      "AI_MODEL_UNAVAILABLE",
      `Gemini model ${model} is temporarily unavailable.`,
      503,
      rawMessage
    );
  }

  if (error instanceof DOMException && error.name === "AbortError") {
    return appError(
      "AI_GENERATION_TIMEOUT",
      `Gemini did not return an image within ${Math.round(requestTimeoutMs / 1000)} seconds.`,
      504
    );
  }

  return appError(
    "AI_GENERATION_FAILED",
    "Gemini returned an error before producing an image.",
    statusCode >= 400 && statusCode < 600 ? statusCode : 502,
    rawMessage
  );
}

async function generateMockup(body) {
  const productSlug = readRequiredString(body.productSlug, "productSlug");
  const prompt = readRequiredString(body.prompt, "prompt");
  const baseProductImageUrl = readImageUrl(body.baseProductImageUrl, "baseProductImageUrl");
  const instructionImageUrl = readImageUrl(body.instructionImageUrl, "instructionImageUrl");
  const partMaskImageUrls = readOptionalImageUrlArray(body.partMaskImageUrls, "partMaskImageUrls");
  const contents = [
    { text: prompt },
    await fetchImageAsInlinePart(baseProductImageUrl),
    await fetchImageAsInlinePart(instructionImageUrl),
    ...(await Promise.all(partMaskImageUrls.map((imageUrl) => fetchImageAsInlinePart(imageUrl))))
  ];

  let response;
  try {
    response = await ai.models.generateContent({
      model,
      contents,
      config: {
        httpOptions: { timeout: requestTimeoutMs },
        responseModalities: ["IMAGE"],
        imageConfig: {
          aspectRatio,
          imageSize
        }
      }
    });
  } catch (error) {
    throw normalizeGeminiError(error);
  }

  const imagePart = findInlineImagePart(response);
  if (!imagePart?.inlineData?.data) {
    const summary = summarizeNoImageResponse(response);
    throw appError(
      "AI_NO_IMAGE_RETURNED",
      `Gemini responded but did not include an image output. finishReason=${summary.finishReason}`,
      502,
      summary.text
    );
  }

  const mimeType = imagePart.inlineData.mimeType || "image/png";
  return {
    success: true,
    imageUrl: `data:${mimeType};base64,${imagePart.inlineData.data}`,
    provider: "gemini",
    model,
    stubMode: false,
    ...(showDebug
      ? {
          debug: {
            productSlug,
            baseProductImageUrl,
            instructionImageUrl,
            partMaskImageUrls,
            promptUsed: prompt
          }
        }
      : {})
  };
}

function sendError(response, origin, error) {
  const statusCode = typeof error?.statusCode === "number" ? error.statusCode : 500;
  json(
    response,
    statusCode,
    {
      success: false,
      errorCode: error?.errorCode || "AI_GENERATION_FAILED",
      error: error?.message || "Cloud Run mockup generation failed.",
      ...(showDebug && error?.details ? { debug: { details: sanitizeDebugText(error.details) } } : {})
    },
    origin
  );
}

const server = createServer(async (request, response) => {
  const origin = request.headers.origin;

  if (origin && !isAllowedOrigin(origin)) {
    json(
      response,
      403,
      {
        success: false,
        errorCode: "FORBIDDEN_ORIGIN",
        error: "This origin is not allowed to call the Cloud Run mockup service."
      },
      origin
    );
    return;
  }

  if (request.method === "OPTIONS") {
    response.writeHead(204, buildCorsHeaders(origin));
    response.end();
    return;
  }

  if (request.method === "GET" && request.url === "/health") {
    json(
      response,
      200,
      {
        ok: true,
        model,
        imageSize
      },
      origin
    );
    return;
  }

  if (request.method === "GET" && request.url === "/") {
    json(
      response,
      200,
      {
        ok: true,
        service: "chili-mockup-cloud-run",
        endpoint: "/generate-mockup"
      },
      origin
    );
    return;
  }

  if (request.method !== "POST" || request.url !== "/generate-mockup") {
    json(
      response,
      404,
      {
        success: false,
        errorCode: "NOT_FOUND",
        error: "Use POST /generate-mockup."
      },
      origin
    );
    return;
  }

  try {
    const body = await readJsonBody(request);
    const result = await generateMockup(body);
    json(response, 200, result, origin);
  } catch (error) {
    sendError(response, origin, error);
  }
});

server.listen(port, () => {
  console.log(`Cloud Run mockup service listening on ${port}`);
});
