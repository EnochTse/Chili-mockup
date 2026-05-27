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

const appBaseUrl = readValue(localEnv.get("APP_BASE_URL"));
const normalizedAppBaseUrl =
  appBaseUrl && !appBaseUrl.includes("localhost")
    ? appBaseUrl
    : "https://your-site-name.netlify.app";

const netlifyEnv = [
  "# Generated from .env.local for Netlify import",
  "# Local layered rendering runs in the browser; no image-generation secret is required.",
  "",
  "# App",
  `APP_BASE_URL=${normalizedAppBaseUrl}`,
  "NODE_ENV=production",
  `NEXT_PUBLIC_SHOW_DEBUG=${readValue(localEnv.get("NEXT_PUBLIC_SHOW_DEBUG"), exampleEnv.get("NEXT_PUBLIC_SHOW_DEBUG"), "false")}`,
  "",
  "# Optional Supabase live Setup Studio database.",
  `NEXT_PUBLIC_SUPABASE_URL=${readValue(localEnv.get("NEXT_PUBLIC_SUPABASE_URL"), exampleEnv.get("NEXT_PUBLIC_SUPABASE_URL"))}`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY=${readValue(localEnv.get("NEXT_PUBLIC_SUPABASE_ANON_KEY"), exampleEnv.get("NEXT_PUBLIC_SUPABASE_ANON_KEY"))}`,
  "",
  "# Setup Studio image uploads are local-only until Supabase Storage is connected.",
  `MAX_UPLOAD_SIZE_MB=${readValue(localEnv.get("MAX_UPLOAD_SIZE_MB"), exampleEnv.get("MAX_UPLOAD_SIZE_MB"), "4")}`,
  ""
].join("\n");

await fs.writeFile(outputPath, netlifyEnv, "utf8");

console.log(`Created ${path.basename(outputPath)} from .env.local`);
console.log("Next step: import netlify.env into Netlify environment variables and set APP_BASE_URL to your Netlify site URL.");
