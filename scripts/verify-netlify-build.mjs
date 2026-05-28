import fs from "node:fs/promises";
import path from "node:path";

const workspaceRoot = process.cwd();
const outDir = path.resolve(workspaceRoot, "out");
const staleApiArtifactDir = path.resolve(workspaceRoot, ".next", "server", "app", "api");
const nextApiSourceDir = path.resolve(workspaceRoot, "src", "app", "api");

async function exists(target) {
  try {
    await fs.stat(target);
    return true;
  } catch {
    return false;
  }
}

if (!(await exists(outDir))) {
  throw new Error("Netlify static export failed: out/ was not created.");
}

if (await exists(staleApiArtifactDir)) {
  throw new Error(
    "Netlify build contains stale Next API artifacts under .next/server/app/api. Clear Netlify build cache and redeploy."
  );
}

if (process.env.NETLIFY === "true" && (await exists(nextApiSourceDir))) {
  throw new Error(
    "Netlify static export must not include src/app/api routes. Use netlify/functions instead."
  );
}

console.log("Netlify build verified: static export with local browser rendering.");
