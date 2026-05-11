import fs from "node:fs/promises";
import path from "node:path";

const workspaceRoot = process.cwd();
const envExamplePath = path.resolve(workspaceRoot, ".env.example");
const envLocalPath = path.resolve(workspaceRoot, ".env.local");
const outputPath = path.resolve(workspaceRoot, "netlify.env");

function parseDotenv(source) {
  const values = new Map();

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const separatorIndex = rawLine.indexOf("=");
    if (separatorIndex === -1) continue;

    const key = rawLine.slice(0, separatorIndex).trim();
    let value = rawLine.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    values.set(key, value);
  }

  return values;
}

async function readDotenvFile(filePath) {
  try {
    const source = await fs.readFile(filePath, "utf8");
    return parseDotenv(source);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return new Map();
    }

    throw error;
  }
}

function readValue(...candidates) {
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.length > 0) {
      return candidate;
    }
  }

  return "";
}

const exampleEnv = await readDotenvFile(envExamplePath);
const localEnv = await readDotenvFile(envLocalPath);

const geminiApiKey = readValue(
  localEnv.get("GEMINI_API_KEY"),
  localEnv.get("GOOGLE_API_KEY"),
  localEnv.get("GOOGLE_GENAI_API_KEY")
);

if (!geminiApiKey) {
  throw new Error("Missing GEMINI_API_KEY in .env.local. Add it locally before generating netlify.env.");
}

const appBaseUrl = readValue(localEnv.get("APP_BASE_URL"));
const normalizedAppBaseUrl =
  appBaseUrl && !appBaseUrl.includes("localhost")
    ? appBaseUrl
    : "https://your-site-name.netlify.app";

const netlifyEnv = [
  "# Generated from .env.local for Netlify import",
  "# This file contains secrets. Keep it local and do not commit it.",
  "",
  "# AI provider mode",
  `AI_STUB_MODE=${readValue(localEnv.get("AI_STUB_MODE"), exampleEnv.get("AI_STUB_MODE"), "false")}`,
  "",
  "# Gemini / Nano Banana",
  `GEMINI_API_KEY=${geminiApiKey}`,
  `GEMINI_IMAGE_MODEL=${readValue(localEnv.get("GEMINI_IMAGE_MODEL"), exampleEnv.get("GEMINI_IMAGE_MODEL"), "gemini-3.1-flash-image-preview")}`,
  `GEMINI_IMAGE_ASPECT_RATIO=${readValue(localEnv.get("GEMINI_IMAGE_ASPECT_RATIO"), exampleEnv.get("GEMINI_IMAGE_ASPECT_RATIO"), "1:1")}`,
  `GEMINI_IMAGE_SIZE=${readValue(localEnv.get("GEMINI_IMAGE_SIZE"), exampleEnv.get("GEMINI_IMAGE_SIZE"), "1K")}`,
  `GEMINI_REQUEST_TIMEOUT_MS=${readValue(localEnv.get("GEMINI_REQUEST_TIMEOUT_MS"), exampleEnv.get("GEMINI_REQUEST_TIMEOUT_MS"), "300000")}`,
  `GEMINI_CONTROL_REQUEST_TIMEOUT_MS=${readValue(localEnv.get("GEMINI_CONTROL_REQUEST_TIMEOUT_MS"), exampleEnv.get("GEMINI_CONTROL_REQUEST_TIMEOUT_MS"), "20000")}`,
  `GEMINI_BATCH_POLL_INTERVAL_MS=${readValue(localEnv.get("GEMINI_BATCH_POLL_INTERVAL_MS"), exampleEnv.get("GEMINI_BATCH_POLL_INTERVAL_MS"), "5000")}`,
  `GEMINI_BATCH_MAX_WAIT_MS=${readValue(localEnv.get("GEMINI_BATCH_MAX_WAIT_MS"), exampleEnv.get("GEMINI_BATCH_MAX_WAIT_MS"), "180000")}`,
  "",
  "# App",
  `APP_BASE_URL=${normalizedAppBaseUrl}`,
  "NODE_ENV=production",
  `NEXT_PUBLIC_SHOW_DEBUG=${readValue(localEnv.get("NEXT_PUBLIC_SHOW_DEBUG"), exampleEnv.get("NEXT_PUBLIC_SHOW_DEBUG"), "false")}`,
  `NEXT_PUBLIC_GENERATE_ENDPOINT=${readValue(localEnv.get("NEXT_PUBLIC_GENERATE_ENDPOINT"), exampleEnv.get("NEXT_PUBLIC_GENERATE_ENDPOINT"), "https://your-cloud-run-url/generate-mockup")}`,
  `NEXT_PUBLIC_GENERATE_TIMEOUT_MS=${readValue(localEnv.get("NEXT_PUBLIC_GENERATE_TIMEOUT_MS"), exampleEnv.get("NEXT_PUBLIC_GENERATE_TIMEOUT_MS"), "360000")}`,
  "",
  "# Netlify should not rely on persistent filesystem writes for generated output.",
  "OUTPUT_STORAGE_MODE=data_url",
  `MAX_UPLOAD_SIZE_MB=${readValue(localEnv.get("MAX_UPLOAD_SIZE_MB"), exampleEnv.get("MAX_UPLOAD_SIZE_MB"), "4")}`,
  ""
].join("\n");

await fs.writeFile(outputPath, netlifyEnv, "utf8");

console.log(`Created ${path.basename(outputPath)} from .env.local`);
console.log("Next step: import netlify.env into Netlify environment variables and set APP_BASE_URL to your Netlify site URL.");
