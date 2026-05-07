import fs from "node:fs/promises";
import path from "node:path";

const workspaceRoot = process.cwd();
const nextDir = path.resolve(workspaceRoot, ".next");
const outDir = path.resolve(workspaceRoot, "out");
const appApiDir = path.resolve(workspaceRoot, "src", "app", "api");
const generatedDir = path.resolve(workspaceRoot, "public", "generated");
const publicDir = path.resolve(workspaceRoot, "public");

async function removeInsideWorkspace(target, label) {
  if (!target.startsWith(workspaceRoot + path.sep)) {
    throw new Error(`Refusing to remove ${label} outside workspace: ${target}`);
  }

  await fs.rm(target, { recursive: true, force: true });
}

await removeInsideWorkspace(nextDir, ".next build cache");
await removeInsideWorkspace(outDir, "out export directory");
if (process.env.NETLIFY === "true") {
  await removeInsideWorkspace(appApiDir, "legacy Next API route directory");
} else if (process.env.NEXT_OUTPUT_EXPORT === "true") {
  console.warn(
    "Skipping src/app/api cleanup outside Netlify. Set NETLIFY=true to validate the production static export locally."
  );
}

if (!generatedDir.startsWith(publicDir + path.sep)) {
  throw new Error(`Refusing to clean unexpected path: ${generatedDir}`);
}

await fs.mkdir(generatedDir, { recursive: true });

for (const entry of await fs.readdir(generatedDir, { withFileTypes: true })) {
  const target = path.resolve(generatedDir, entry.name);
  if (!target.startsWith(generatedDir + path.sep)) {
    throw new Error(`Refusing to clean unexpected file: ${target}`);
  }

  await fs.rm(target, { recursive: true, force: true });
}
