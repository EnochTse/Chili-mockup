import fs from "node:fs/promises";
import path from "node:path";
import { AppError } from "@/lib/errors";

type AssetKind = "base" | "instruction";

const bannedAssetWords = [
  "starter",
  "placeholder",
  "demo",
  "sample",
  "local mockup testing"
];

const minTemplateImageDimension = 128;

function normalizeForBannedWordCheck(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ");
}

export function assertNoPlaceholderAsset(assetPath: string, buffer?: Buffer) {
  const normalizedPath = normalizeForBannedWordCheck(assetPath);
  const metadataText = buffer
    ? normalizeForBannedWordCheck(buffer.subarray(0, Math.min(buffer.length, 1024 * 512)).toString("latin1"))
    : "";

  const found = bannedAssetWords.find((word) => {
    const normalizedWord = normalizeForBannedWordCheck(word).trim();
    return normalizedPath.includes(normalizedWord) || metadataText.includes(normalizedWord);
  });

  if (found) {
    throw new AppError(
      "PLACEHOLDER_ASSET_DETECTED",
      `Placeholder asset detected in template image: ${path.basename(assetPath)}. Replace any ${found} asset with a real product asset.`,
      500
    );
  }
}

function getPngDimensions(buffer: Buffer) {
  if (
    buffer.length < 24 ||
    buffer[0] !== 0x89 ||
    buffer[1] !== 0x50 ||
    buffer[2] !== 0x4e ||
    buffer[3] !== 0x47
  ) {
    return null;
  }

  return {
    mimeType: "image/png",
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20)
  };
}

function getJpegDimensions(buffer: Buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    return null;
  }

  let offset = 2;
  while (offset < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    const marker = buffer[offset + 1];
    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2) break;

    const isStartOfFrame =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);

    if (isStartOfFrame && offset + 8 < buffer.length) {
      return {
        mimeType: "image/jpeg",
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7)
      };
    }

    offset += 2 + length;
  }

  return null;
}

function getWebpDimensions(buffer: Buffer) {
  if (
    buffer.length < 30 ||
    buffer.toString("ascii", 0, 4) !== "RIFF" ||
    buffer.toString("ascii", 8, 12) !== "WEBP"
  ) {
    return null;
  }

  const chunk = buffer.toString("ascii", 12, 16);
  if (chunk === "VP8X" && buffer.length >= 30) {
    return {
      mimeType: "image/webp",
      width: 1 + buffer.readUIntLE(24, 3),
      height: 1 + buffer.readUIntLE(27, 3)
    };
  }

  if (chunk === "VP8 " && buffer.length >= 30) {
    return {
      mimeType: "image/webp",
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff
    };
  }

  return null;
}

function readSvgDimensions(text: string) {
  if (!text.trimStart().startsWith("<svg")) return null;

  const width = Number(text.match(/\bwidth=["']?([\d.]+)/i)?.[1]);
  const height = Number(text.match(/\bheight=["']?([\d.]+)/i)?.[1]);
  const viewBox = text.match(/\bviewBox=["']?([\d.\s-]+)/i)?.[1]?.trim().split(/\s+/).map(Number);

  return {
    mimeType: "image/svg+xml",
    width: Number.isFinite(width) && width > 0 ? width : viewBox?.[2] || 0,
    height: Number.isFinite(height) && height > 0 ? height : viewBox?.[3] || 0
  };
}

function inspectImage(buffer: Buffer, assetPath: string) {
  const extension = path.extname(assetPath).toLowerCase();
  const svg = extension === ".svg" ? readSvgDimensions(buffer.toString("utf8")) : null;
  const info =
    getPngDimensions(buffer) ||
    getJpegDimensions(buffer) ||
    getWebpDimensions(buffer) ||
    svg;

  if (!info) {
    throw new AppError(
      "INVALID_TEMPLATE_ASSET",
      `Invalid template asset: ${path.basename(assetPath)} is not a supported image file.`,
      500
    );
  }

  const extensionMatches =
    (info.mimeType === "image/jpeg" && [".jpg", ".jpeg"].includes(extension)) ||
    (info.mimeType === "image/png" && extension === ".png") ||
    (info.mimeType === "image/webp" && extension === ".webp") ||
    (info.mimeType === "image/svg+xml" && extension === ".svg");

  if (!extensionMatches) {
    throw new AppError(
      "INVALID_TEMPLATE_ASSET",
      `Invalid template asset: ${path.basename(assetPath)} file extension does not match its image type.`,
      500
    );
  }

  if (
    info.width < minTemplateImageDimension ||
    info.height < minTemplateImageDimension ||
    !Number.isFinite(info.width) ||
    !Number.isFinite(info.height)
  ) {
    throw new AppError(
      "INVALID_TEMPLATE_ASSET",
      `Invalid template asset: ${path.basename(assetPath)} has abnormal dimensions.`,
      500
    );
  }

  return info;
}

export async function validateTemplateAsset(assetPath: string, kind: AssetKind) {
  let buffer: Buffer;

  try {
    const stat = await fs.stat(assetPath);
    if (!stat.isFile()) {
      throw new Error("Not a file");
    }
    buffer = await fs.readFile(assetPath);
  } catch {
    throw new AppError(
      kind === "base" ? "MISSING_BASE_IMAGE" : "MISSING_INSTRUCTION_IMAGE",
      kind === "base"
        ? "The product template image could not be found. Please check the product assets."
        : "The instruction image could not be found. Please check the product template.",
      500
    );
  }

  assertNoPlaceholderAsset(assetPath, buffer);

  return inspectImage(buffer, assetPath);
}
