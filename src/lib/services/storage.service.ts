import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const mimeToExtension: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/svg+xml": ".svg"
};

export function getGeneratedOutputDir() {
  return path.resolve(
    process.cwd(),
    process.env.GENERATED_OUTPUT_DIR ||
      process.env.PUBLIC_GENERATED_DIR ||
      "./public/generated"
  );
}

function getPublicUrl(fileName: string) {
  return `/generated/${encodeURIComponent(fileName)}`;
}

function shouldReturnDataUrl() {
  return (
    process.env.OUTPUT_STORAGE_MODE === "data_url" ||
    process.env.NETLIFY === "true"
  );
}

function toDataUrl(bytes: Buffer, mimeType: string) {
  return `data:${mimeType};base64,${bytes.toString("base64")}`;
}

function makeOutputFileName(productSlug: string, extension: string) {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  return `mockup-${productSlug}-${stamp}-${crypto.randomUUID()}${extension}`;
}

export async function saveGeneratedImage(
  bytes: Buffer,
  productSlug: string,
  mimeType = "image/png"
) {
  if (shouldReturnDataUrl()) {
    return {
      imageUrl: toDataUrl(bytes, mimeType),
      outputPath: null
    };
  }

  const extension = mimeToExtension[mimeType] || ".png";
  const outputDir = getGeneratedOutputDir();
  await fs.mkdir(outputDir, { recursive: true });

  const fileName = makeOutputFileName(productSlug, extension);
  const outputPath = path.resolve(outputDir, fileName);
  await fs.writeFile(outputPath, bytes);

  return {
    imageUrl: getPublicUrl(fileName),
    outputPath
  };
}

export async function copyToGenerated(sourcePath: string, productSlug: string) {
  const extension = path.extname(sourcePath).toLowerCase() || ".png";
  const outputDir = getGeneratedOutputDir();
  await fs.mkdir(outputDir, { recursive: true });

  const fileName = makeOutputFileName(productSlug, extension);
  const outputPath = path.resolve(outputDir, fileName);
  await fs.copyFile(sourcePath, outputPath);

  return {
    imageUrl: getPublicUrl(fileName),
    outputPath
  };
}
