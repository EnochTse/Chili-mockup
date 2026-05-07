import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AppError } from "@/lib/errors";

function getUploadDir() {
  if (process.env.NETLIFY === "true") {
    return path.resolve(os.tmpdir(), "chili-mockup-uploads");
  }

  return path.resolve(process.cwd(), process.env.TEMP_UPLOAD_DIR || "./tmp/uploads");
}

function sanitizeName(fileName: string) {
  const parsed = path.parse(fileName);
  const safeBase =
    parsed.name
      .normalize("NFKD")
      .replace(/[^\w-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase() || "logo";
  const safeExt = parsed.ext.toLowerCase();

  return `${safeBase}${safeExt}`;
}

export async function saveUploadedLogo(file: File) {
  const uploadDir = getUploadDir();
  await fs.mkdir(uploadDir, { recursive: true });

  const safeOriginalName = sanitizeName(file.name);
  const extension = path.extname(safeOriginalName);
  const base = path.basename(safeOriginalName, extension);
  const logoFileName = `${base}-${crypto.randomUUID()}${extension}`;
  const logoImagePath = path.resolve(uploadDir, logoFileName);

  if (!logoImagePath.startsWith(uploadDir + path.sep)) {
    throw new AppError("INVALID_LOGO_FILE", "Please upload a valid logo file.", 400);
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(logoImagePath, bytes);

  return {
    logoFileName,
    logoImagePath
  };
}
