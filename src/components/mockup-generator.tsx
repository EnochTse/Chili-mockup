"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import ChiliLogo from "@/components/chili-logo";
import { getQuickColorOptions, resolveColorOption } from "@/lib/services/color-option.service";
import {
  productFinishLabels,
  resolvePartFinishSelection
} from "@/lib/services/finish-option.service";
import { buildMockupPrompt, getPrintingMethodPrompt } from "@/lib/services/prompt.service";
import type {
  ProductFinishOption,
  SelectedPartPantone,
  TemplatePublicDto,
  TemplateSummaryDto
} from "@/lib/types";

interface GenerateResponse {
  success: boolean;
  imageUrl?: string;
  jobName?: string;
  state?: string;
  completed?: boolean;
  provider?: "stub" | "gemini";
  model?: string;
  stubMode?: boolean;
  debug?: {
    provider?: string;
    model?: string;
    stubMode?: boolean;
    templateId?: string;
    productSlug: string;
    selectedPartPantones?: Array<{
      partId: string;
      partLabel: string;
      pantoneCode: string;
      selectedFinish?: string;
    }>;
    baseImagePath?: string;
    baseProductImagePath: string;
    instructionImagePath: string;
    partMaskImagePaths?: string[];
    logoFileName: string;
    promptUsed: string;
  };
  error?: string;
  errorCode?: string;
}

interface LogoJsonPayload {
  fileName: string;
  mimeType: string;
  data: string;
}

const logoPrintColorLabels: Record<string, string> = {
  white: "White",
  black: "Black",
  original: "Original logo colors",
  pantone_match: "Match selected Pantone"
};

const jobStatusFetchTimeoutMs = 30000;
const parsedDirectGenerateTimeoutMs = Number.parseInt(
  process.env.NEXT_PUBLIC_GENERATE_TIMEOUT_MS || "360000",
  10
);
const directGenerateTimeoutMs = Number.isFinite(parsedDirectGenerateTimeoutMs)
  ? Math.max(parsedDirectGenerateTimeoutMs, 60000)
  : 360000;
const localJobPollIntervalMs = 3000;
const localJobMaxWaitMs = 15 * 60 * 1000;
const maxClientLogoSizeBytes = 4 * 1024 * 1024;
const maxPreviewRetryCount = 6;
const fallbackLogoArea = { x: 0.34, y: 0.58, width: 0.32, height: 0.11 };
const defaultLogoTransform = { offsetX: 0, offsetY: 0, scale: 1, rotation: 0 };
const logoOffsetLimit = 0.35;
const localNextApiGenerateEndpoint = "/api/mockup/generate";
const netlifyFunctionGenerateEndpoint = "/.netlify/functions/generate-mockup";
const logoQuarterTurnDegrees = 90;
type GenerateRequestMode = "local-next-api" | "netlify-job" | "external-direct";

type PixelRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type Rgb = {
  r: number;
  g: number;
  b: number;
};

type LogoTransform = {
  offsetX: number;
  offsetY: number;
  scale: number;
  rotation: number;
};

type LogoDragState = {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startTransform: LogoTransform;
  imageWidth: number;
  imageHeight: number;
};

function getGenerateEndpoint() {
  const configuredEndpoint = process.env.NEXT_PUBLIC_GENERATE_ENDPOINT?.trim();
  if (configuredEndpoint) {
    if (
      process.env.NODE_ENV !== "development" &&
      configuredEndpoint.startsWith("/api/")
    ) {
      return netlifyFunctionGenerateEndpoint;
    }

    return configuredEndpoint;
  }

  return process.env.NODE_ENV === "development"
    ? localNextApiGenerateEndpoint
    : netlifyFunctionGenerateEndpoint;
}

function getGenerateRequestMode(endpoint: string): GenerateRequestMode {
  if (process.env.NODE_ENV === "development" && endpoint.startsWith("/api/")) {
    return "local-next-api";
  }

  if (/^https?:\/\//i.test(endpoint)) {
    return "external-direct";
  }

  return "netlify-job";
}

function getGenerateStartEndpoint(endpoint: string) {
  const normalizedEndpoint = endpoint.replace(/\/+$/, "");
  return normalizedEndpoint.startsWith("/api/")
    ? `${normalizedEndpoint}/start`
    : `${normalizedEndpoint}-start`;
}

function getGenerateStatusEndpoint(endpoint: string) {
  const normalizedEndpoint = endpoint.replace(/\/+$/, "");
  return normalizedEndpoint.startsWith("/api/")
    ? `${normalizedEndpoint}/status`
    : `${normalizedEndpoint}-status`;
}

function buildPreviewImageUrl(imageUrl: string, attempt: number) {
  if (imageUrl.startsWith("data:")) return imageUrl;

  const separator = imageUrl.includes("?") ? "&" : "?";
  return `${imageUrl}${separator}v=${Date.now()}-${attempt}`;
}

function toAbsoluteAssetUrl(assetUrl: string) {
  if (/^(https?:)?\/\//i.test(assetUrl) || assetUrl.startsWith("data:")) {
    return assetUrl;
  }

  return new URL(assetUrl, window.location.origin).toString();
}

async function fetchJsonWithTimeout<T>(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number
) {
  const abortController = new AbortController();
  const timeoutId = window.setTimeout(() => abortController.abort(), timeoutMs);

  try {
    const response = await fetch(input, {
      ...init,
      signal: abortController.signal
    });
    const text = await response.text();
    const requestTarget =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : "request";
    let data = {} as T;

    if (text) {
      try {
        data = JSON.parse(text) as T;
      } catch {
        const compactText = text.trim().replace(/\s+/g, " ").slice(0, 160);
        const contentType = response.headers.get("content-type") || "unknown";
        throw new Error(
          compactText.startsWith("<")
            ? `NON_JSON_RESPONSE: ${requestTarget} returned HTML instead of JSON (HTTP ${response.status}, content-type ${contentType}). This usually means the app hit the wrong generate endpoint.`
            : `INVALID_JSON_RESPONSE: ${requestTarget} returned non-JSON content (HTTP ${response.status}, content-type ${contentType}). ${compactText}`
        );
      }
    }

    return { response, data };
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function formatElapsedTime(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function getPartNumberText(label: string, fallbackIndex: number) {
  const match = label.match(/\d+/);
  return match?.[0] || `${fallbackIndex + 1}`;
}

function buildSelectedPartPantones(
  template: TemplatePublicDto,
  partPantones: Record<string, string>,
  partFinishes: Record<string, ProductFinishOption>
): SelectedPartPantone[] {
  return template.colorParts.map((part) => {
    const pantoneCode = partPantones[part.id] || "";
    const pantone = resolveColorOption(template.pantoneOptions, pantoneCode);
    if (!pantone) {
      throw new Error(`INVALID_PANTONE: Missing or invalid Pantone selection for ${part.label}.`);
    }

    return {
      partId: part.id,
      partLabel: part.label,
      partDescription: part.description,
      instructionCue: part.instructionCue,
      instructionColorHex: part.instructionColorHex,
      partMaskImageUrl: part.partMaskImageUrl,
      pantoneCode,
      pantone,
      selectedFinish: resolvePartFinishSelection(part, partFinishes[part.id])
    };
  });
}

function buildInitialPartFinishes(template: TemplatePublicDto) {
  return Object.fromEntries(
    template.colorParts.flatMap((part) => {
      const selectedFinish = resolvePartFinishSelection(part, part.defaultFinish);
      return selectedFinish ? [[part.id, selectedFinish]] : [];
    })
  ) as Record<string, ProductFinishOption>;
}

function getCanvasContext(canvas: HTMLCanvasElement) {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Canvas is not available in this browser.");
  return context;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function normalizeLogoTransform(transform: LogoTransform): LogoTransform {
  const normalizedRotation = Number.isFinite(transform.rotation)
    ? ((transform.rotation % 360) + 360) % 360
    : 0;

  return {
    offsetX: clamp(transform.offsetX, -logoOffsetLimit, logoOffsetLimit),
    offsetY: clamp(transform.offsetY, -logoOffsetLimit, logoOffsetLimit),
    scale: clamp(transform.scale, 0.35, 2.2),
    rotation: normalizedRotation
  };
}

function createDefaultLogoTransform(): LogoTransform {
  return { ...defaultLogoTransform };
}

function hexToRgb(hex: string): Rgb {
  const normalized = hex.replace("#", "");
  const value =
    normalized.length === 3
      ? normalized
          .split("")
          .map((part) => part + part)
          .join("")
      : normalized;

  return {
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16)
  };
}

function loadImage(source: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    if (!source.startsWith("data:") && !source.startsWith("blob:")) {
      image.crossOrigin = "anonymous";
    }
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Image failed to load."));
    image.src = source;
  });
}

async function loadFileImage(file: File) {
  const objectUrl = URL.createObjectURL(file);
  try {
    return await loadImage(objectUrl);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function averageCornerColor(imageData: ImageData): Rgb {
  const { data, width, height } = imageData;
  const sampleSize = Math.max(4, Math.min(24, Math.floor(Math.min(width, height) * 0.04)));
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;
  const corners = [
    [0, 0],
    [width - sampleSize, 0],
    [0, height - sampleSize],
    [width - sampleSize, height - sampleSize]
  ];

  for (const [startX, startY] of corners) {
    for (let y = startY; y < startY + sampleSize; y += 1) {
      for (let x = startX; x < startX + sampleSize; x += 1) {
        const index = (y * width + x) * 4;
        const alpha = data[index + 3] / 255;
        r += data[index] * alpha + 255 * (1 - alpha);
        g += data[index + 1] * alpha + 255 * (1 - alpha);
        b += data[index + 2] * alpha + 255 * (1 - alpha);
        count += 1;
      }
    }
  }

  return {
    r: Math.round(r / count),
    g: Math.round(g / count),
    b: Math.round(b / count)
  };
}

function pixelDifference(data: Uint8ClampedArray, index: number, background: Rgb) {
  return Math.max(
    Math.abs(data[index] - background.r),
    Math.abs(data[index + 1] - background.g),
    Math.abs(data[index + 2] - background.b)
  );
}

function findVisibleLogoBounds(imageData: ImageData, background: Rgb): PixelRect {
  const { data, width, height } = imageData;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const alpha = data[index + 3];
      const diff = pixelDifference(data, index, background);
      if (alpha > 16 && (alpha < 245 || diff > 24)) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }

  if (maxX < minX || maxY < minY) {
    return { x: 0, y: 0, width, height };
  }

  const padding = Math.ceil(Math.max(maxX - minX, maxY - minY) * 0.03);
  const x = clamp(minX - padding, 0, width - 1);
  const y = clamp(minY - padding, 0, height - 1);
  return {
    x,
    y,
    width: clamp(maxX - minX + 1 + padding * 2, 1, width - x),
    height: clamp(maxY - minY + 1 + padding * 2, 1, height - y)
  };
}

function createLogoArtworkCanvas(logoImage: HTMLImageElement, inkColor: Rgb | null) {
  const sourceCanvas = document.createElement("canvas");
  sourceCanvas.width = logoImage.naturalWidth || logoImage.width;
  sourceCanvas.height = logoImage.naturalHeight || logoImage.height;
  const sourceContext = getCanvasContext(sourceCanvas);
  sourceContext.drawImage(logoImage, 0, 0);

  const sourceData = sourceContext.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
  const background = averageCornerColor(sourceData);
  const bounds = findVisibleLogoBounds(sourceData, background);

  const logoCanvas = document.createElement("canvas");
  logoCanvas.width = Math.max(1, Math.round(bounds.width));
  logoCanvas.height = Math.max(1, Math.round(bounds.height));
  const logoContext = getCanvasContext(logoCanvas);
  logoContext.drawImage(
    sourceCanvas,
    bounds.x,
    bounds.y,
    bounds.width,
    bounds.height,
    0,
    0,
    logoCanvas.width,
    logoCanvas.height
  );

  const logoData = logoContext.getImageData(0, 0, logoCanvas.width, logoCanvas.height);
  const { data } = logoData;

  for (let index = 0; index < data.length; index += 4) {
    const originalAlpha = data[index + 3];
    const diff = pixelDifference(data, index, background);
    const maskAlpha =
      originalAlpha < 245
        ? originalAlpha
        : Math.round(clamp((diff - 10) * 5, 0, 255));

    if (maskAlpha <= 0) {
      data[index + 3] = 0;
      continue;
    }

    data[index + 3] = Math.round((maskAlpha * originalAlpha) / 255);
    if (inkColor) {
      data[index] = inkColor.r;
      data[index + 1] = inkColor.g;
      data[index + 2] = inkColor.b;
    }
  }

  logoContext.putImageData(logoData, 0, 0);
  return logoCanvas;
}

function detectGreenLogoArea(instructionImage: HTMLImageElement) {
  const canvas = document.createElement("canvas");
  canvas.width = instructionImage.naturalWidth || instructionImage.width;
  canvas.height = instructionImage.naturalHeight || instructionImage.height;
  const context = getCanvasContext(canvas);
  context.drawImage(instructionImage, 0, 0);
  const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height);
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const r = data[index];
      const g = data[index + 1];
      const b = data[index + 2];
      if (g > 115 && g > r * 1.25 && g > b * 1.25 && r < 180 && b < 180) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }

  if (maxX < minX || maxY < minY) return fallbackLogoArea;

  return {
    x: minX / width,
    y: minY / height,
    width: (maxX - minX + 1) / width,
    height: (maxY - minY + 1) / height
  };
}

function resolveLogoInkColor(params: {
  logoPrintColor: string;
  printingMethod: string;
  partPantones: Record<string, string>;
  template: TemplatePublicDto;
}) {
  if (params.logoPrintColor === "original") return null;
  if (params.printingMethod === "laser_engraving") return hexToRgb("#302c27");
  if (params.printingMethod === "mirror_laser_engraving") return hexToRgb("#8f8f95");
  if (params.logoPrintColor === "white") return hexToRgb("#ffffff");
  if (params.logoPrintColor === "black") return hexToRgb("#050505");

  const matchedPantone = params.template.colorParts
    .map((part) => resolveColorOption(params.template.pantoneOptions, params.partPantones[part.id] || ""))
    .find(Boolean);

  return hexToRgb(matchedPantone?.previewHex || "#050505");
}

function makeLogoEffectCanvas(logoCanvas: HTMLCanvasElement, printingMethod: string) {
  const effectCanvas = document.createElement("canvas");
  effectCanvas.width = logoCanvas.width;
  effectCanvas.height = logoCanvas.height;
  const context = getCanvasContext(effectCanvas);
  context.drawImage(logoCanvas, 0, 0);

  if (printingMethod === "embroidery") {
    context.save();
    context.globalCompositeOperation = "source-atop";
    context.globalAlpha = 0.18;
    context.strokeStyle = "#ffffff";
    context.lineWidth = Math.max(1, Math.round(logoCanvas.height / 90));
    for (let x = -logoCanvas.height; x < logoCanvas.width; x += Math.max(4, logoCanvas.height / 22)) {
      context.beginPath();
      context.moveTo(x, logoCanvas.height);
      context.lineTo(x + logoCanvas.height, 0);
      context.stroke();
    }
    context.restore();
  }

  if (printingMethod === "uv_print") {
    context.save();
    context.globalCompositeOperation = "source-atop";
    context.globalAlpha = 0.2;
    const gradient = context.createLinearGradient(0, 0, 0, logoCanvas.height);
    gradient.addColorStop(0, "#ffffff");
    gradient.addColorStop(0.45, "rgba(255,255,255,0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, logoCanvas.width, logoCanvas.height);
    context.restore();
  }

  if (printingMethod === "mirror_laser_engraving") {
    context.save();
    context.globalCompositeOperation = "source-atop";
    const metallicGradient = context.createLinearGradient(0, 0, logoCanvas.width, logoCanvas.height);
    metallicGradient.addColorStop(0, "#080808");
    metallicGradient.addColorStop(0.16, "#5f5f66");
    metallicGradient.addColorStop(0.34, "#f4f4f6");
    metallicGradient.addColorStop(0.5, "#8a8a90");
    metallicGradient.addColorStop(0.68, "#fdfdff");
    metallicGradient.addColorStop(0.84, "#4d4d53");
    metallicGradient.addColorStop(1, "#050505");
    context.fillStyle = metallicGradient;
    context.fillRect(0, 0, logoCanvas.width, logoCanvas.height);
    context.restore();

    context.save();
    context.globalCompositeOperation = "source-atop";
    context.globalAlpha = 0.26;
    const shineWidth = Math.max(6, Math.round(logoCanvas.width * 0.16));
    const shineGradient = context.createLinearGradient(
      logoCanvas.width * 0.15,
      0,
      logoCanvas.width * 0.15 + shineWidth,
      0
    );
    shineGradient.addColorStop(0, "rgba(255,255,255,0)");
    shineGradient.addColorStop(0.5, "rgba(255,255,255,1)");
    shineGradient.addColorStop(1, "rgba(255,255,255,0)");
    context.translate(logoCanvas.width * 0.08, 0);
    context.rotate((-18 * Math.PI) / 180);
    context.fillStyle = shineGradient;
    context.fillRect(
      0,
      -logoCanvas.height * 0.15,
      logoCanvas.width,
      logoCanvas.height * 1.35
    );
    context.restore();
  }

  return effectCanvas;
}

function drawLogoWithPrintEffect(params: {
  context: CanvasRenderingContext2D;
  logoCanvas: HTMLCanvasElement;
  rect: PixelRect;
  printingMethod: string;
  rotation: number;
}) {
  const { context, logoCanvas, rect, printingMethod, rotation } = params;
  const effectCanvas = makeLogoEffectCanvas(logoCanvas, printingMethod);

  context.save();
  context.translate(rect.x + rect.width / 2, rect.y + rect.height / 2);
  context.rotate((rotation * Math.PI) / 180);
  if (printingMethod === "uv_print") {
    context.shadowColor = "rgba(255,255,255,0.35)";
    context.shadowBlur = 3;
    context.shadowOffsetY = -1;
  } else if (printingMethod === "heat_transfer") {
    context.globalAlpha = 0.94;
    context.shadowColor = "rgba(0,0,0,0.16)";
    context.shadowBlur = 2;
    context.shadowOffsetY = 1;
  } else if (printingMethod === "embroidery") {
    context.shadowColor = "rgba(0,0,0,0.2)";
    context.shadowBlur = 2;
    context.shadowOffsetY = 1;
  } else if (printingMethod === "laser_engraving") {
    context.globalAlpha = 0.58;
    context.globalCompositeOperation = "multiply";
  } else if (printingMethod === "mirror_laser_engraving") {
    context.globalAlpha = 0.82;
    context.shadowColor = "rgba(255,255,255,0.18)";
    context.shadowBlur = 2;
    context.shadowOffsetY = -1;
  } else {
    context.globalAlpha = 0.97;
  }

  context.drawImage(effectCanvas, -rect.width / 2, -rect.height / 2, rect.width, rect.height);
  context.restore();
}

async function composeMockupPreview(params: {
  productImageUrl: string;
  instructionImageUrl: string;
  logoFile: File;
  logoPrintColor: string;
  printingMethod: string;
  logoTransform: LogoTransform;
  partPantones: Record<string, string>;
  template: TemplatePublicDto;
}) {
  const [productImage, instructionImage, logoImage] = await Promise.all([
    loadImage(params.productImageUrl),
    loadImage(params.instructionImageUrl),
    loadFileImage(params.logoFile)
  ]);
  const canvas = document.createElement("canvas");
  canvas.width = productImage.naturalWidth || productImage.width;
  canvas.height = productImage.naturalHeight || productImage.height;
  const context = getCanvasContext(canvas);
  context.drawImage(productImage, 0, 0, canvas.width, canvas.height);

  const normalizedArea = detectGreenLogoArea(instructionImage);
  const logoArea = {
    x: normalizedArea.x * canvas.width,
    y: normalizedArea.y * canvas.height,
    width: normalizedArea.width * canvas.width,
    height: normalizedArea.height * canvas.height
  };
  const padding = Math.min(logoArea.width, logoArea.height) * 0.12;
  const usableArea = {
    x: logoArea.x + padding,
    y: logoArea.y + padding,
    width: Math.max(1, logoArea.width - padding * 2),
    height: Math.max(1, logoArea.height - padding * 2)
  };
  const logoCanvas = createLogoArtworkCanvas(
    logoImage,
    resolveLogoInkColor({
      logoPrintColor: params.logoPrintColor,
      printingMethod: params.printingMethod,
      partPantones: params.partPantones,
      template: params.template
    })
  );
  const logoTransform = normalizeLogoTransform(params.logoTransform);
  const scale =
    Math.min(usableArea.width / logoCanvas.width, usableArea.height / logoCanvas.height) *
    logoTransform.scale;
  const drawWidth = logoCanvas.width * scale;
  const drawHeight = logoCanvas.height * scale;
  const centerX = usableArea.x + usableArea.width / 2 + logoTransform.offsetX * canvas.width;
  const centerY = usableArea.y + usableArea.height / 2 + logoTransform.offsetY * canvas.height;
  const drawRect = {
    x: centerX - drawWidth / 2,
    y: centerY - drawHeight / 2,
    width: drawWidth,
    height: drawHeight
  };

  drawLogoWithPrintEffect({
    context,
    logoCanvas,
    rect: drawRect,
    printingMethod: params.printingMethod,
    rotation: logoTransform.rotation
  });

  return canvas.toDataURL("image/png");
}

function humanizeOption(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function downloadImageUrl(imageUrl: string, fileName: string) {
  const link = document.createElement("a");
  link.href = imageUrl;
  link.download = fileName;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function DebugRow({ label, value }: { label: string; value: unknown }) {
  if (value === undefined || value === null || value === "") return null;

  return (
    <>
      <dt className="debug-label">{label}</dt>
      <dd className="debug-value">{String(value)}</dd>
    </>
  );
}

export default function MockupGenerator({
  productSlug,
  initialTemplate,
  availableTemplates = []
}: {
  productSlug: string;
  initialTemplate?: TemplatePublicDto;
  availableTemplates?: TemplateSummaryDto[];
}) {
  const router = useRouter();
  const [template, setTemplate] = useState<TemplatePublicDto | null>(initialTemplate || null);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [isTemplateLoading, setIsTemplateLoading] = useState(!initialTemplate);
  const [pantoneFilter, setPantoneFilter] = useState("");
  const [openPartId, setOpenPartId] = useState<string | null>(null);
  const [partPantones, setPartPantones] = useState<Record<string, string>>({});
  const [partFinishes, setPartFinishes] = useState<Record<string, ProductFinishOption>>({});
  const [logoPrintColor, setLogoPrintColor] = useState("");
  const [printingMethod, setPrintingMethod] = useState("");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [result, setResult] = useState<GenerateResponse | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [generationStatus, setGenerationStatus] = useState<string | null>(null);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [compositedPreviewUrl, setCompositedPreviewUrl] = useState<string | null>(null);
  const [isPreviewResolving, setIsPreviewResolving] = useState(false);
  const [logoTransform, setLogoTransform] = useState<LogoTransform>(createDefaultLogoTransform);
  const [isLogoDragging, setIsLogoDragging] = useState(false);
  const [isInstructionOpen, setIsInstructionOpen] = useState(false);
  const [focusedPartId, setFocusedPartId] = useState<string | null>(
    initialTemplate?.colorParts[0]?.id || null
  );
  const [renderPreviewShellSize, setRenderPreviewShellSize] = useState({
    width: 0,
    height: 0
  });
  const previewRetryCountRef = useRef(0);
  const previewRetryTimeoutRef = useRef<number | null>(null);
  const logoDragStateRef = useRef<LogoDragState | null>(null);
  const renderPanelRef = useRef<HTMLElement | null>(null);
  const formPanelRef = useRef<HTMLElement | null>(null);
  const renderPreviewShellRef = useRef<HTMLDivElement | null>(null);
  const formSectionRefs = useRef<Array<HTMLElement | null>>([]);
  const [activeFormSectionIndex, setActiveFormSectionIndex] = useState(0);

  const showDebug =
    process.env.NODE_ENV === "development" ||
    process.env.NEXT_PUBLIC_SHOW_DEBUG === "true";

  function clearPreviewRetryTimeout() {
    if (previewRetryTimeoutRef.current !== null) {
      window.clearTimeout(previewRetryTimeoutRef.current);
      previewRetryTimeoutRef.current = null;
    }
  }

  function schedulePreviewRetry() {
    if (!result?.imageUrl || result.imageUrl.startsWith("data:")) {
      setIsPreviewResolving(false);
      return;
    }

    if (previewRetryCountRef.current >= maxPreviewRetryCount) {
      clearPreviewRetryTimeout();
      setIsPreviewResolving(false);
      setSubmitError(
        "The mockup finished generating, but the preview image is taking longer than expected to appear. Please wait a moment and try again."
      );
      return;
    }

    const nextAttempt = previewRetryCountRef.current + 1;
    previewRetryCountRef.current = nextAttempt;
    clearPreviewRetryTimeout();
    previewRetryTimeoutRef.current = window.setTimeout(() => {
      setPreviewImageUrl(buildPreviewImageUrl(result.imageUrl!, nextAttempt));
    }, Math.min(1500, nextAttempt * 250));
  }

  useEffect(() => {
    if (initialTemplate) {
      setTemplate(initialTemplate);
      setTemplateError(null);
      setIsTemplateLoading(false);
      setPantoneFilter("");
      setOpenPartId(null);
      setFocusedPartId(initialTemplate.colorParts[0]?.id || null);
      setPartPantones(
        Object.fromEntries(
          initialTemplate.colorParts
            .filter((part) => part.defaultPantoneCode)
            .map((part) => [part.id, part.defaultPantoneCode!])
        )
      );
      setPartFinishes(buildInitialPartFinishes(initialTemplate));
      setLogoPrintColor(initialTemplate.defaultLogoPrintColor || "");
      setPrintingMethod("");
      setLogoFile(null);
      setResult(null);
      setPreviewImageUrl(null);
      setCompositedPreviewUrl(null);
      setIsPreviewResolving(false);
      setLogoTransform(createDefaultLogoTransform());
      setIsLogoDragging(false);
      setIsInstructionOpen(false);
      logoDragStateRef.current = null;
      setSubmitError(null);
      setGenerationStatus(null);
      return;
    }

    setTemplate(null);
    setTemplateError("This product has not been configured for mockup generation.");
    setIsTemplateLoading(false);
    setFocusedPartId(null);
    setPartFinishes({});
  }, [productSlug]);

  useEffect(() => {
    return () => {
      clearPreviewRetryTimeout();
    };
  }, []);

  useEffect(() => {
    if (!isInstructionOpen) return;

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsInstructionOpen(false);
      }
    }

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [isInstructionOpen]);

  useEffect(() => {
    const previewShell = renderPreviewShellRef.current;
    if (!previewShell || typeof ResizeObserver === "undefined") return;

    const updateSize = () => {
      const bounds = previewShell.getBoundingClientRect();
      setRenderPreviewShellSize({
        width: bounds.width,
        height: bounds.height
      });
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(previewShell);
    return () => observer.disconnect();
  }, [template?.baseImageUrl, result?.imageUrl, previewImageUrl, compositedPreviewUrl]);

  useEffect(() => {
    if (!template) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let isDisposed = false;
    let cleanup: (() => void) | undefined;

    Promise.all([import("gsap"), import("gsap/ScrollTrigger")])
      .then(([gsapModule, scrollTriggerModule]) => {
        if (isDisposed) return;

        const { gsap } = gsapModule;
        const { ScrollTrigger } = scrollTriggerModule;
        gsap.registerPlugin(ScrollTrigger);

        const context = gsap.context(() => {
          if (renderPanelRef.current) {
            gsap.fromTo(
              renderPanelRef.current,
              { autoAlpha: 0, y: 24 },
              {
                autoAlpha: 1,
                y: 0,
                duration: 0.3,
                ease: "power2.out",
                scrollTrigger: {
                  trigger: renderPanelRef.current,
                  start: "top 84%"
                }
              }
            );
          }

          if (formPanelRef.current) {
            gsap.fromTo(
              formPanelRef.current,
              { autoAlpha: 0, y: 24 },
              {
                autoAlpha: 1,
                y: 0,
                duration: 0.3,
                ease: "power2.out",
                scrollTrigger: {
                  trigger: formPanelRef.current,
                  start: "top 82%"
                }
              }
            );
          }

          const formSections = formSectionRefs.current.filter(
            (section): section is HTMLElement => Boolean(section)
          );

          if (formSections.length) {
            formSections.forEach((section, index) => {
              gsap.fromTo(
                section,
                { autoAlpha: index === 0 ? 1 : 0.35, y: index === 0 ? 0 : 28 },
                {
                  autoAlpha: 1,
                  y: 0,
                  duration: 0.45,
                  ease: "power2.out",
                  scrollTrigger: {
                    trigger: section,
                    start: "top 82%"
                  }
                }
              );
            });
          }
        });

        cleanup = () => context.revert();
      })
      .catch(() => undefined);

    return () => {
      isDisposed = true;
      cleanup?.();
    };
  }, [template?.slug, template?.colorParts.length]);

  useEffect(() => {
    const sections = formSectionRefs.current.filter(
      (section): section is HTMLElement => Boolean(section)
    );
    if (!sections.length || typeof IntersectionObserver === "undefined") return;

    const ratios = new Map<number, number>();

    const updateActiveSection = () => {
      const [nextSection] = Array.from(ratios.entries()).sort((left, right) => right[1] - left[1]);
      if (nextSection && nextSection[1] > 0) {
        setActiveFormSectionIndex(nextSection[0]);
      }
    };

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const index = Number((entry.target as HTMLElement).dataset.formSectionIndex || "0");
          ratios.set(index, entry.isIntersecting ? entry.intersectionRatio : 0);
        });
        updateActiveSection();
      },
      {
        threshold: [0.15, 0.3, 0.5, 0.7, 0.9],
        rootMargin: "-16% 0px -38% 0px"
      }
    );

    sections.forEach((section, index) => {
      section.dataset.formSectionIndex = String(index);
      ratios.set(index, index === 0 ? 1 : 0);
      observer.observe(section);
    });
    updateActiveSection();

    return () => observer.disconnect();
  }, [template?.slug]);

  useEffect(() => {
    clearPreviewRetryTimeout();
    previewRetryCountRef.current = 0;

    if (!result?.imageUrl) {
      setPreviewImageUrl(null);
      setCompositedPreviewUrl(null);
      setIsPreviewResolving(false);
      setLogoTransform(createDefaultLogoTransform());
      setIsLogoDragging(false);
      logoDragStateRef.current = null;
      return;
    }

    setCompositedPreviewUrl(null);
    setLogoTransform(createDefaultLogoTransform());
    setIsLogoDragging(false);
    logoDragStateRef.current = null;
    setPreviewImageUrl(buildPreviewImageUrl(result.imageUrl, 0));
    setIsPreviewResolving(!result.imageUrl.startsWith("data:"));
  }, [result?.imageUrl]);

  useEffect(() => {
    let isCancelled = false;

    if (!previewImageUrl || !logoFile || !template) {
      setIsPreviewResolving(false);
      return;
    }

    const shouldShowPreviewLoader = !compositedPreviewUrl;
    setIsPreviewResolving(shouldShowPreviewLoader);
    composeMockupPreview({
      productImageUrl: previewImageUrl,
      instructionImageUrl: template.instructionImageUrl,
      logoFile,
      logoPrintColor,
      printingMethod,
      logoTransform,
      partPantones,
      template
    })
      .then((imageUrl) => {
        if (isCancelled) return;
        clearPreviewRetryTimeout();
        setCompositedPreviewUrl(imageUrl);
        setIsPreviewResolving(false);
        setSubmitError(null);
      })
      .catch(() => {
        if (isCancelled) return;
        if (compositedPreviewUrl) {
          setIsPreviewResolving(false);
          return;
        }
        schedulePreviewRetry();
      });

    return () => {
      isCancelled = true;
    };
  }, [
    previewImageUrl,
    logoFile,
    template,
    logoPrintColor,
    printingMethod,
    logoTransform,
    partPantones
  ]);

  const filteredPantoneOptions = useMemo(() => {
    const options = template?.pantoneOptions || [];
    const query = pantoneFilter.trim().toLowerCase();

    return query
      ? options.filter((option) =>
          `${option.code} ${option.label}`.toLowerCase().includes(query)
        )
      : options;
  }, [pantoneFilter, template]);

  const visiblePantoneOptions = useMemo(
    () =>
      pantoneFilter.trim()
        ? filteredPantoneOptions
        : filteredPantoneOptions.slice(0, 120),
    [filteredPantoneOptions, pantoneFilter]
  );
  const quickColorOptions = useMemo(() => getQuickColorOptions(), []);
  const displayedMockupImageUrl = compositedPreviewUrl || previewImageUrl || result?.imageUrl || null;
  const stageImageUrl = displayedMockupImageUrl || template?.baseImageUrl || null;
  const stageImageAlt =
    result?.imageUrl || compositedPreviewUrl || previewImageUrl
      ? "Generated Chili product mockup"
      : template
        ? `${template.name} base product`
        : "Chili product";
  const canSaveImage = Boolean(displayedMockupImageUrl);
  const logoPrintQuickChoices = useMemo(
    () =>
      template?.allowedLogoPrintColors.filter((color) =>
        ["white", "black", "original", "pantone_match"].includes(color)
      ) || [],
    [template]
  );

  const hasAllPartPantones = template
    ? template.colorParts.every((part) => Boolean(partPantones[part.id]))
    : false;
  const configuredPartCount = template
    ? template.colorParts.filter((part) => Boolean(partPantones[part.id])).length
    : 0;
  const workflowTotalSteps = (template?.colorParts.length || 0) + 3;
  const workflowCompletedSteps =
    configuredPartCount +
    (logoPrintColor ? 1 : 0) +
    (printingMethod ? 1 : 0) +
    (logoFile ? 1 : 0);
  const workflowCompletionPercent = workflowTotalSteps
    ? Math.round((workflowCompletedSteps / workflowTotalSteps) * 100)
    : 0;
  const primaryPrintMethodLabel = printingMethod
    ? getPrintingMethodPrompt(printingMethod).label
    : "Not selected";

  const canGenerate =
    Boolean(template) &&
    hasAllPartPantones &&
    Boolean(logoPrintColor) &&
    Boolean(printingMethod) &&
    Boolean(logoFile) &&
    !isSubmitting;
  const canAdjustLogo = Boolean(result?.imageUrl && compositedPreviewUrl && logoFile && template);
  const logoMoveXPercent = Math.round(logoTransform.offsetX * 100);
  const logoMoveYPercent = Math.round(logoTransform.offsetY * 100);
  const logoScalePercent = Math.round(logoTransform.scale * 100);
  const logoRotationDegrees = Math.round(logoTransform.rotation);
  const activePartId = focusedPartId || openPartId || template?.colorParts[0]?.id || null;
  const activePartIndex = template?.colorParts.findIndex((part) => part.id === activePartId) ?? -1;
  const activePart =
    activePartIndex >= 0 && template ? template.colorParts[activePartIndex] : null;
  const activePartNumber =
    activePart && activePartIndex >= 0
      ? getPartNumberText(activePart.label, activePartIndex)
      : null;
  const activePartIndicators = useMemo(() => {
    if (!activePart || !renderPreviewShellSize.width || !renderPreviewShellSize.height) {
      return [];
    }

    return (activePart.indicatorAnchors || []).map((anchor, anchorIndex) => {
      const targetX = (renderPreviewShellSize.width * anchor.targetXPercent) / 100;
      const targetY = (renderPreviewShellSize.height * anchor.targetYPercent) / 100;
      const labelX = clamp(
        targetX + (renderPreviewShellSize.width * anchor.labelOffsetXPercent) / 100,
        32,
        Math.max(32, renderPreviewShellSize.width - 32)
      );
      const labelY = clamp(
        targetY + (renderPreviewShellSize.height * anchor.labelOffsetYPercent) / 100,
        28,
        Math.max(28, renderPreviewShellSize.height - 28)
      );
      const deltaX = targetX - labelX;
      const deltaY = targetY - labelY;

      return {
        id: anchor.id || `${activePart.id}-indicator-${anchorIndex + 1}`,
        targetX,
        targetY,
        labelX,
        labelY,
        angle: (Math.atan2(deltaY, deltaX) * 180) / Math.PI,
        distance: Math.hypot(deltaX, deltaY)
      };
    });
  }, [activePart, renderPreviewShellSize]);
  const formStepDots = [
    { kicker: "Step 1", label: "Colours" },
    { kicker: "Step 2", label: "Branding" },
    { kicker: "Step 3", label: "Generate" },
    { kicker: "Step 4", label: "Adjust" }
  ];

  function updateLogoTransform(next: LogoTransform | ((current: LogoTransform) => LogoTransform)) {
    setLogoTransform((current) =>
      normalizeLogoTransform(typeof next === "function" ? next(current) : next)
    );
  }

  function resetLogoTransform() {
    updateLogoTransform(createDefaultLogoTransform());
  }

  function rotateLogoBy(deltaDegrees: number) {
    updateLogoTransform((current) => ({
      ...current,
      rotation: current.rotation + deltaDegrees
    }));
  }

  function handleSaveImage() {
    if (!displayedMockupImageUrl) return;
    downloadImageUrl(displayedMockupImageUrl, `chili-mockup-${productSlug}.png`);
  }

  function scrollToFormSection(index: number) {
    const section = formSectionRefs.current[index];
    if (!section) return;
    section.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function handleLogoPointerDown(event: React.PointerEvent<HTMLImageElement>) {
    if (!canAdjustLogo) return;

    const imageBounds = event.currentTarget.getBoundingClientRect();
    logoDragStateRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startTransform: logoTransform,
      imageWidth: imageBounds.width,
      imageHeight: imageBounds.height
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsLogoDragging(true);
    event.preventDefault();
  }

  function handleLogoPointerMove(event: React.PointerEvent<HTMLImageElement>) {
    const dragState = logoDragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;

    const deltaX = (event.clientX - dragState.startClientX) / Math.max(1, dragState.imageWidth);
    const deltaY = (event.clientY - dragState.startClientY) / Math.max(1, dragState.imageHeight);
    updateLogoTransform({
      ...dragState.startTransform,
      offsetX: dragState.startTransform.offsetX + deltaX,
      offsetY: dragState.startTransform.offsetY + deltaY
    });
    event.preventDefault();
  }

  function finishLogoDrag(event: React.PointerEvent<HTMLImageElement>) {
    const dragState = logoDragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    logoDragStateRef.current = null;
    setIsLogoDragging(false);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!template || !logoFile || !canGenerate) return;

    clearPreviewRetryTimeout();
    setIsSubmitting(true);
    setSubmitError(null);
    setGenerationStatus("Preparing Gemini generation...");
    setCompositedPreviewUrl(null);
    setLogoTransform(createDefaultLogoTransform());
    setIsLogoDragging(false);
    logoDragStateRef.current = null;

    try {
      const endpoint = getGenerateEndpoint();
      const requestMode = getGenerateRequestMode(endpoint);
      const startEndpoint = getGenerateStartEndpoint(endpoint);
      const statusEndpoint = getGenerateStatusEndpoint(endpoint);
      const selectedPartPantones = buildSelectedPartPantones(template, partPantones, partFinishes);

      if (requestMode === "local-next-api") {
        const formData = makeGenerateFormData({
          productSlug,
          partPantones,
          partFinishes,
          logoPrintColor,
          printingMethod,
          logoFile
        });
        const startResult = await fetchJsonWithTimeout<GenerateResponse>(
          startEndpoint,
          {
            method: "POST",
            body: formData
          },
          directGenerateTimeoutMs
        );
        const startData = startResult.data;

        if (!startResult.response.ok || !startData.success || !startData.imageUrl) {
          throw new Error(
            startData.errorCode
              ? `${startData.errorCode}: ${startData.error}`
              : startData.error || "Generation failed."
          );
        }

        if (startData.provider !== "gemini" || startData.stubMode) {
          throw new Error("REAL_AI_REQUIRED: The API did not return a real Gemini image.");
        }

        setResult(startData);
        setGenerationStatus(null);
        return;
      }

      if (requestMode === "external-direct") {
        setGenerationStatus("Generating mockup with Gemini...");
        const directResult = await fetchJsonWithTimeout<GenerateResponse>(
          endpoint,
          {
            method: "POST",
            headers: {
              "content-type": "application/json"
            },
            body: JSON.stringify({
              productSlug,
              prompt: buildMockupPrompt({
                template,
                selectedPartPantones,
                logoPrintColor,
                printingMethod
              }),
              baseProductImageUrl: toAbsoluteAssetUrl(template.baseImageUrl),
              instructionImageUrl: toAbsoluteAssetUrl(template.instructionImageUrl),
              partMaskImageUrls: selectedPartPantones
                .map((selection) => selection.partMaskImageUrl)
                .filter(Boolean)
                .map((assetUrl) => toAbsoluteAssetUrl(assetUrl as string))
            })
          },
          directGenerateTimeoutMs
        );
        const directData = directResult.data;

        if (!directResult.response.ok || !directData.success || !directData.imageUrl) {
          throw new Error(
            directData.errorCode
              ? `${directData.errorCode}: ${directData.error}`
              : directData.error || "Generation failed."
          );
        }

        if (directData.provider !== "gemini" || directData.stubMode) {
          throw new Error("REAL_AI_REQUIRED: The API did not return a real Gemini image.");
        }

        setResult(directData);
        setGenerationStatus(null);
        return;
      }

      const startResult = await fetchJsonWithTimeout<GenerateResponse>(
        startEndpoint,
        {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({
            productSlug,
            partPantones,
            partFinishes,
            logoPrintColor,
            printingMethod,
            removeBackground: false,
            logoFile: await fileToLogoJsonPayload(logoFile)
          })
        },
        jobStatusFetchTimeoutMs
      );
      const startData = startResult.data;

      if (!startResult.response.ok || !startData.success || !startData.jobName) {
        throw new Error(
          startData.errorCode
            ? `${startData.errorCode}: ${startData.error}`
            : startData.error || "Generation job failed to start."
        );
      }

      const startedAt = Date.now();
      let finalData: GenerateResponse | null = null;

      while (Date.now() - startedAt <= localJobMaxWaitMs) {
        const elapsedMs = Date.now() - startedAt;
        setGenerationStatus(
          `Gemini job ${startData.state || "queued"}... ${formatElapsedTime(elapsedMs)}`
        );
        await new Promise((resolve) => window.setTimeout(resolve, localJobPollIntervalMs));

        const statusResult = await fetchJsonWithTimeout<GenerateResponse>(
          statusEndpoint,
          {
            method: "POST",
            headers: {
              "content-type": "application/json"
            },
            body: JSON.stringify({
              productSlug,
              jobName: startData.jobName
            })
          },
          jobStatusFetchTimeoutMs
        );
        const statusData = statusResult.data;

        if (!statusResult.response.ok || !statusData.success) {
          throw new Error(
            statusData.errorCode
              ? `${statusData.errorCode}: ${statusData.error}`
              : statusData.error || "Generation status check failed."
          );
        }

        startData.state = statusData.state || startData.state;
        setGenerationStatus(
          `Gemini job ${statusData.state || "running"}... ${formatElapsedTime(elapsedMs)}`
        );

        if (statusData.completed && statusData.imageUrl) {
          finalData = statusData;
          break;
        }
      }

      if (!finalData?.imageUrl) {
        throw new Error(
          "AI_GENERATION_TIMEOUT: Gemini is still processing this job after 15 minutes. Please try again later."
        );
      }

      if (finalData.provider !== "gemini" || finalData.stubMode) {
        throw new Error("REAL_AI_REQUIRED: The API did not return a real Gemini image.");
      }

      setResult(finalData);
      setGenerationStatus(null);
    } catch (error) {
      setGenerationStatus(null);
      if (error instanceof DOMException && error.name === "AbortError") {
        setSubmitError(
          `AI_GENERATION_TIMEOUT: Gemini did not return a result within ${Math.round(
            directGenerateTimeoutMs / 1000
          )} seconds. Please try again later.`
        );
      } else {
        setSubmitError(error instanceof Error ? error.message : "Generation failed.");
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="mockup-page">
      <header className="page-header">
        <div className="site-bar">
          <div className="brand-lockup">
            <ChiliLogo className="brand-logo" />
          </div>
          <div className="site-bar-actions">
            {availableTemplates.length > 0 ? (
              <label className="product-switcher">
                <span className="product-switcher-label">Product</span>
                <select
                  className="product-switcher-select"
                  value={productSlug}
                  onChange={(event) => router.push(`/mockup/${event.target.value}`)}
                >
                  {availableTemplates.map((availableTemplate) => (
                    <option key={availableTemplate.slug} value={availableTemplate.slug}>
                      {availableTemplate.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <Link href="/setup" className="secondary-link-button">
              Setup studio
            </Link>
            <span className="mode-pill">AI mockup studio</span>
          </div>
        </div>

        <div className="page-intro">
          <div className="hero-copy-stack">
            <p className="eyebrow">Interactive product preview</p>
            <h1 className="hero-title">Chili Product Mockup Generator</h1>
            <p className="hero-support">
              Configure colour, logo treatment, and finish in one calm workspace. Scroll through
              each option, then generate a realistic reference mockup for review.
            </p>
          </div>
          <div className="notice-panel">
            <strong>Visual reference only.</strong> Final production artwork is confirmed
            separately by the Chili design team.
          </div>
        </div>

      </header>

      {isTemplateLoading ? (
        <section className="surface notice-panel">Loading template...</section>
      ) : templateError ? (
        <section className="alert-error">{templateError}</section>
      ) : template ? (
        <div className="workflow-grid">
          <div className="workflow-main">
              <section
                className="render-panel"
                aria-busy={isSubmitting || isPreviewResolving}
                ref={renderPanelRef}
              >
              <div className="render-stage">
                <div className="render-stage-toolbar">
                  <div className="render-stage-actions">
                    <button
                      type="button"
                      className="instruction-toggle-button"
                      onClick={() => setIsInstructionOpen(true)}
                    >
                      Instruction image
                    </button>
                  </div>
                </div>

                {stageImageUrl ? (
                  <div className="render-preview-shell" ref={renderPreviewShellRef}>
                    <img
                      className={`render-preview-image logo-adjust-preview${
                        displayedMockupImageUrl && isLogoDragging ? " is-logo-dragging" : ""
                      }`}
                      src={stageImageUrl}
                      alt={stageImageAlt}
                      draggable={false}
                      onPointerDown={handleLogoPointerDown}
                      onPointerMove={handleLogoPointerMove}
                      onPointerUp={finishLogoDrag}
                      onPointerCancel={finishLogoDrag}
                      onLostPointerCapture={() => {
                        logoDragStateRef.current = null;
                        setIsLogoDragging(false);
                      }}
                    />

                    {activePart && activePartIndicators.length ? (
                      <div className="part-indicator-layer" aria-hidden="true">
                        <div className="part-indicator-caption">
                          <span className="part-indicator-caption-label">Active part</span>
                          <strong>{activePart.label}</strong>
                        </div>
                        {activePartIndicators.map((indicator, indicatorIndex) => (
                          <div key={indicator.id} className="part-indicator">
                            <div
                              className="part-indicator-line"
                              style={{
                                left: `${indicator.labelX}px`,
                                top: `${indicator.labelY}px`,
                                width: `${indicator.distance}px`,
                                transform: `translateY(-50%) rotate(${indicator.angle}deg)`
                              }}
                            />
                            <div
                              className="part-indicator-dot"
                              style={{
                                left: `${indicator.targetX}px`,
                                top: `${indicator.targetY}px`
                              }}
                            />
                            <div
                              className="part-indicator-badge"
                              style={{
                                left: `${indicator.labelX}px`,
                                top: `${indicator.labelY}px`
                              }}
                            >
                              <span className="part-indicator-badge-number">
                                {activePartNumber}
                              </span>
                              <span className="part-indicator-badge-copy">
                                {activePartIndicators.length > 1
                                  ? `Spot ${indicatorIndex + 1}`
                                  : activePart.label}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="render-placeholder">
                    <p className="render-placeholder-title">
                      {previewImageUrl ? "Preparing preview" : "Base product preview"}
                    </p>
                    <p className="render-placeholder-copy">
                      {previewImageUrl
                        ? "Applying the original logo artwork and print effect."
                        : "Select Pantone colors, choose a printing method, upload the client logo, and generate the mockup to preview it here."}
                    </p>
                  </div>
                )}

                {isSubmitting || isPreviewResolving ? (
                  <div className="render-loading-overlay">
                    <div className="loading-spinner" aria-hidden="true" />
                    <p className="render-loading-copy">
                      {isSubmitting
                        ? generationStatus || "Generating mockup..."
                        : "Loading generated preview..."}
                    </p>
                  </div>
                ) : null}
              </div>

              {false ? (
                <div className="render-meta">
                  <div className="logo-adjust-panel">
                      <div className="logo-adjust-head">
                        <div className="logo-adjust-copy">
                          <p className="logo-adjust-title">Logo position adjustment</p>
                          <p className="fine-print">
                            Drag the preview, or fine-tune the logo with the controls below. This
                            does not regenerate the AI image.
                          </p>
                        </div>
                      </div>

                      <div className="logo-adjust-actions">
                          <button
                            className="icon-action-button"
                            type="button"
                            title="Rotate 90 degrees counterclockwise"
                            aria-label="Rotate 90 degrees counterclockwise"
                            onClick={() => rotateLogoBy(-logoQuarterTurnDegrees)}
                            disabled={!canAdjustLogo}
                          >
                            ↺
                          </button>
                          <button
                            className="icon-action-button"
                            type="button"
                            title="Rotate 90 degrees clockwise"
                            aria-label="Rotate 90 degrees clockwise"
                            onClick={() => rotateLogoBy(logoQuarterTurnDegrees)}
                            disabled={!canAdjustLogo}
                          >
                            ↻
                          </button>
                          <button
                            className="secondary-link-button logo-reset-button"
                            type="button"
                            onClick={resetLogoTransform}
                            disabled={!canAdjustLogo}
                          >
                            Reset
                          </button>
                          <button
                            className="secondary-link-button"
                            type="button"
                            onClick={handleSaveImage}
                            disabled={!canSaveImage}
                          >
                            Save image
                          </button>
                      </div>

                      <div className="logo-adjust-grid" aria-disabled={!canAdjustLogo}>
                        <label className="logo-slider-row" htmlFor="logoOffsetX">
                          <span>Move X</span>
                          <input
                            id="logoOffsetX"
                            type="range"
                            min="-35"
                            max="35"
                            step="1"
                            value={logoMoveXPercent}
                            disabled={!canAdjustLogo}
                            onChange={(event) => {
                              const value = Number(event.currentTarget.value) / 100;
                              updateLogoTransform((current) => ({
                                ...current,
                                offsetX: value
                              }));
                            }}
                          />
                          <output>{logoMoveXPercent}%</output>
                        </label>

                        <label className="logo-slider-row" htmlFor="logoOffsetY">
                          <span>Move Y</span>
                          <input
                            id="logoOffsetY"
                            type="range"
                            min="-35"
                            max="35"
                            step="1"
                            value={logoMoveYPercent}
                            disabled={!canAdjustLogo}
                            onChange={(event) => {
                              const value = Number(event.currentTarget.value) / 100;
                              updateLogoTransform((current) => ({
                                ...current,
                                offsetY: value
                              }));
                            }}
                          />
                          <output>{logoMoveYPercent}%</output>
                        </label>

                        <label className="logo-slider-row" htmlFor="logoScale">
                          <span>Scale</span>
                          <input
                            id="logoScale"
                            type="range"
                            min="35"
                            max="220"
                            step="1"
                            value={logoScalePercent}
                            disabled={!canAdjustLogo}
                            onChange={(event) => {
                              const value = Number(event.currentTarget.value) / 100;
                              updateLogoTransform((current) => ({
                                ...current,
                                scale: value
                              }));
                            }}
                          />
                          <output>{logoScalePercent}%</output>
                        </label>

                        <div className="logo-slider-row logo-rotation-readout">
                          <span>Rotate</span>
                          <div className="rotation-readout-track" aria-hidden="true" />
                          <output>{logoRotationDegrees}deg</output>
                        </div>
                      </div>
                  </div>
                </div>
              ) : null}
            </section>
          </div>

          <section className="form-panel" ref={formPanelRef}>
            <div className="form-panel-rail">
              <nav className="form-section-dots" aria-label="Configuration step navigation">
                {formStepDots.map((step, index) => (
                  <button
                    key={step.label}
                    type="button"
                    className={`form-section-dot${activeFormSectionIndex === index ? " is-active" : ""}`}
                    aria-label={`${step.kicker}: ${step.label}`}
                    aria-current={activeFormSectionIndex === index ? "step" : undefined}
                    title={`${step.kicker}: ${step.label}`}
                    onClick={() => scrollToFormSection(index)}
                  />
                ))}
              </nav>
            </div>
            <div className="surface config-panel-shell">
              <div className="panel-head config-panel-head">
                <div>
                  <p className="panel-kicker">Configuration</p>
                  <h2 className="section-title">Generate mockup</h2>
                  <p className="panel-description">
                    Build the request from top to bottom, then generate the preview when every
                    required input is ready.
                  </p>
                </div>
                <div className="config-status-block">
                  <span className={`status-pill${canGenerate ? " is-complete" : ""}`}>
                    {canGenerate ? "Ready to generate" : "Configuration in progress"}
                  </span>
                  <p className="config-progress-copy">
                    {workflowCompletedSteps} of {workflowTotalSteps} required selections completed.
                  </p>
                </div>
                <div className="config-progress-track" aria-hidden="true">
                  <span
                    className="config-progress-fill"
                    style={{ width: `${workflowCompletionPercent}%` }}
                  />
                </div>
              </div>

              <form className="generator-form" onSubmit={handleSubmit}>
                <section
                  className="form-section"
                  ref={(node) => {
                    formSectionRefs.current[0] = node;
                  }}
                >
                  <div className="form-section-head">
                    <div>
                      <p className="panel-kicker">Step 1</p>
                      <h3 className="section-title">Select product colors</h3>
                    </div>
                    <p className="section-caption">
                      Search Pantone codes, then configure the exact parts shown on the preview.
                    </p>
                  </div>

                  <div className="form-field">
                    <label className="control-label" htmlFor="pantoneFilter">
                      Pantone search
                    </label>
                    <input
                      id="pantoneFilter"
                      className="input-shell"
                      type="search"
                      placeholder="Search Pantone, e.g. 485 C"
                      value={pantoneFilter}
                      onChange={(event) => setPantoneFilter(event.target.value)}
                    />
                    <p className="fine-print">
                      {visiblePantoneOptions.length} of {template.pantoneOptions.length} Solid Coated
                      colors
                      {pantoneFilter.trim() ? "" : " shown. Search to narrow the list."}
                    </p>
                  </div>

                  <div className="part-selection-stack">
                    {template.colorParts.map((part, partIndex) => {
                      const selectedPantone = resolveColorOption(
                        template.pantoneOptions,
                        partPantones[part.id] || ""
                      );
                      const selectedFinish = resolvePartFinishSelection(part, partFinishes[part.id]);
                      const partNumber = getPartNumberText(part.label, Math.max(partIndex, 0));
                      const isFocusedPart = activePartId === part.id;
                      const isMutedPart = Boolean(activePartId) && !isFocusedPart;

                      return (
                        <div
                          key={part.id}
                          className={`part-selection-card${isFocusedPart ? " is-focused" : ""}${isMutedPart ? " is-muted" : ""}`}
                          onClick={() => setFocusedPartId(part.id)}
                          onPointerEnter={() => setFocusedPartId(part.id)}
                          onFocusCapture={() => setFocusedPartId(part.id)}
                        >
                          <div className="part-selection-head">
                            <div className="part-selection-copy">
                              <div className="part-selection-title-row">
                                <span className="part-index-badge" aria-hidden="true">
                                  {partNumber}
                                </span>
                                <label className="control-label" htmlFor={`part-${part.id}`}>
                                  {part.label} Pantone color
                                </label>
                              </div>
                              <p className="fine-print">{part.description}</p>
                            </div>
                            <button
                              id={`part-${part.id}`}
                              type="button"
                              className="pantone-trigger"
                              aria-label={`${part.label} Pantone color`}
                              aria-expanded={openPartId === part.id}
                              onClick={() => {
                                setFocusedPartId(part.id);
                                setOpenPartId((current) => (current === part.id ? null : part.id));
                              }}
                            >
                              {selectedPantone ? (
                                <>
                                  <span
                                    className="color-swatch"
                                    style={{ backgroundColor: selectedPantone.previewHex }}
                                    aria-hidden="true"
                                  />
                                  <span>{selectedPantone.label}</span>
                                </>
                              ) : (
                                <span>Select Pantone</span>
                              )}
                            </button>
                          </div>

                          <div className="quick-color-row">
                            {quickColorOptions.map((option) => (
                              <button
                                key={`${part.id}-${option.code}`}
                                type="button"
                                className={`quick-color-button${partPantones[part.id] === option.code ? " is-active" : ""}`}
                                onClick={() => {
                                  setFocusedPartId(part.id);
                                  setPartPantones((current) => ({
                                    ...current,
                                    [part.id]: option.code
                                  }));
                                }}
                              >
                                <span
                                  className="color-swatch"
                                  style={{ backgroundColor: option.previewHex }}
                                  aria-hidden="true"
                                />
                                <span>{option.label}</span>
                              </button>
                            ))}
                          </div>

                          {selectedPantone ? (
                            <div className="color-preview">
                              <span
                                className="color-swatch"
                                style={{ backgroundColor: selectedPantone.previewHex }}
                                aria-hidden="true"
                              />
                              <span>{selectedPantone.previewHex}</span>
                            </div>
                          ) : null}

                          {part.allowedFinishes?.length ? (
                            <div className="part-finish-field">
                              <span className="control-label">Material finish</span>
                              <div className="quick-choice-row" aria-label={`${part.label} finish options`}>
                                {part.allowedFinishes.map((finish) => (
                                  <button
                                    key={`${part.id}-${finish}`}
                                    type="button"
                                    className={`quick-choice-button${selectedFinish === finish ? " is-active" : ""}`}
                                    onClick={() => {
                                      setFocusedPartId(part.id);
                                      setPartFinishes((current) => ({
                                        ...current,
                                        [part.id]: finish
                                      }));
                                    }}
                                  >
                                    {productFinishLabels[finish]}
                                  </button>
                                ))}
                              </div>
                            </div>
                          ) : null}

                          {openPartId === part.id ? (
                            <div className="pantone-options-shell">
                              <div
                                className="pantone-options-list"
                                role="listbox"
                                aria-label={part.label}
                              >
                                {visiblePantoneOptions.map((option) => (
                                  <button
                                    key={`${part.id}-${option.code}`}
                                    type="button"
                                    className={`pantone-option-button${partPantones[part.id] === option.code ? " is-active" : ""}`}
                                    onClick={() => {
                                      setFocusedPartId(part.id);
                                      setPartPantones((current) => ({
                                        ...current,
                                        [part.id]: option.code
                                      }));
                                      setOpenPartId(null);
                                    }}
                                  >
                                    <span
                                      className="color-swatch"
                                      style={{ backgroundColor: option.previewHex }}
                                      aria-hidden="true"
                                    />
                                    <span className="pantone-option-label">{option.label}</span>
                                    <span className="pantone-option-meta">{option.previewHex}</span>
                                  </button>
                                ))}
                              </div>
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </section>

                <section
                  className="form-section"
                  ref={(node) => {
                    formSectionRefs.current[1] = node;
                  }}
                >
                  <div className="form-section-head">
                    <div>
                      <p className="panel-kicker">Step 2</p>
                      <h3 className="section-title">Branding and print controls</h3>
                    </div>
                    <p className="section-caption">
                      Choose the ink behavior and upload the source logo used for the local overlay.
                    </p>
                  </div>

                  <div className="form-field">
                    <label className="control-label" htmlFor="logoPrintColor">
                      Logo print color
                    </label>
                    <select
                      id="logoPrintColor"
                      className="input-shell"
                      value={logoPrintColor}
                      onChange={(event) => setLogoPrintColor(event.target.value)}
                      required
                    >
                      <option value="">Select logo color</option>
                      {template.allowedLogoPrintColors.map((color) => (
                        <option key={color} value={color}>
                          {logoPrintColorLabels[color] || humanizeOption(color)}
                        </option>
                      ))}
                    </select>
                    {logoPrintQuickChoices.length ? (
                      <div className="quick-choice-row" aria-label="Logo color shortcuts">
                        {logoPrintQuickChoices.map((color) => (
                          <button
                            key={color}
                            type="button"
                            className={`quick-choice-button${logoPrintColor === color ? " is-active" : ""}`}
                            onClick={() => setLogoPrintColor(color)}
                          >
                            {logoPrintColorLabels[color] || humanizeOption(color)}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>

                  <div className="form-field">
                    <label className="control-label" htmlFor="printingMethod">
                      Printing method
                    </label>
                    <select
                      id="printingMethod"
                      className="input-shell"
                      value={printingMethod}
                      onChange={(event) => setPrintingMethod(event.target.value)}
                      required
                    >
                      <option value="">Select method</option>
                      {template.allowedPrintingMethods.map((method) => (
                        <option key={method} value={method}>
                          {getPrintingMethodPrompt(method).label}
                        </option>
                      ))}
                    </select>
                    <p className="fine-print">Selected method: {primaryPrintMethodLabel}</p>
                  </div>

                  <div className="form-field">
                    <label className="control-label" htmlFor="logoFile">
                      Client logo
                    </label>
                    <input
                      id="logoFile"
                      className="input-shell"
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/svg+xml"
                      onChange={(event) => {
                        const file = event.target.files?.[0] || null;
                        if (file && file.size > maxClientLogoSizeBytes) {
                          setLogoFile(null);
                          setLogoTransform(createDefaultLogoTransform());
                          setIsLogoDragging(false);
                          logoDragStateRef.current = null;
                          setSubmitError(
                            "LOGO_FILE_TOO_LARGE: Please upload a logo under 4 MB for Netlify test generation."
                          );
                          event.target.value = "";
                          return;
                        }

                        setSubmitError(null);
                        setLogoFile(file);
                        setLogoTransform(createDefaultLogoTransform());
                        setIsLogoDragging(false);
                        logoDragStateRef.current = null;
                      }}
                      required
                    />
                    <p className="fine-print">
                      The uploaded logo image is treated as the only source of truth for the brand
                      artwork.
                    </p>
                  </div>
                </section>

                <section
                  className="form-section form-submit-section"
                  ref={(node) => {
                    formSectionRefs.current[2] = node;
                  }}
                >
                  <div className="form-section-head">
                    <div>
                      <p className="panel-kicker">Step 3</p>
                      <h3 className="section-title">Generate output</h3>
                    </div>
                    <p className="section-caption">
                      Review the checklist below, then create or refresh the preview.
                    </p>
                  </div>

                  <div className="requirements-checklist" aria-label="Generation readiness">
                    <div className={`requirement-chip${hasAllPartPantones ? " is-complete" : ""}`}>
                      {hasAllPartPantones ? "All parts selected" : "Select every part color"}
                    </div>
                    <div className={`requirement-chip${logoPrintColor ? " is-complete" : ""}`}>
                      {logoPrintColor ? "Logo color ready" : "Choose logo color"}
                    </div>
                    <div className={`requirement-chip${printingMethod ? " is-complete" : ""}`}>
                      {printingMethod ? "Print method ready" : "Choose print method"}
                    </div>
                    <div className={`requirement-chip${logoFile ? " is-complete" : ""}`}>
                      {logoFile ? "Logo uploaded" : "Upload client logo"}
                    </div>
                  </div>

                  <button className="button-primary" type="submit" disabled={!canGenerate}>
                    {isSubmitting ? "Generating..." : "Generate mockup"}
                  </button>
                </section>

                <section
                  className="form-section form-adjust-section"
                  ref={(node) => {
                    formSectionRefs.current[3] = node;
                  }}
                >
                  <div className="form-section-head">
                    <div>
                      <p className="panel-kicker">Step 4</p>
                      <h3 className="section-title">Adjust logo placement</h3>
                    </div>
                    <p className="section-caption">
                      Keep the preview pinned on the left while refining the logo placement here.
                    </p>
                  </div>

                  {displayedMockupImageUrl ? (
                    <div className="logo-adjust-panel">
                      <div className="logo-adjust-head">
                        <div className="logo-adjust-copy">
                          <p className="logo-adjust-title">Logo position adjustment</p>
                          <p className="fine-print">
                            Drag the preview image on the left, or fine-tune the logo with the
                            controls below. This does not regenerate the AI image.
                          </p>
                        </div>
                      </div>

                      <div className="logo-adjust-actions">
                          <button
                            className="icon-action-button"
                            type="button"
                            title="Rotate 90 degrees counterclockwise"
                            aria-label="Rotate 90 degrees counterclockwise"
                            onClick={() => rotateLogoBy(-logoQuarterTurnDegrees)}
                            disabled={!canAdjustLogo}
                          >
                            -90
                          </button>
                          <button
                            className="icon-action-button"
                            type="button"
                            title="Rotate 90 degrees clockwise"
                            aria-label="Rotate 90 degrees clockwise"
                            onClick={() => rotateLogoBy(logoQuarterTurnDegrees)}
                            disabled={!canAdjustLogo}
                          >
                            +90
                          </button>
                          <button
                            className="secondary-link-button logo-reset-button"
                            type="button"
                            onClick={resetLogoTransform}
                            disabled={!canAdjustLogo}
                          >
                            Reset
                          </button>
                          <button
                            className="secondary-link-button"
                            type="button"
                            onClick={handleSaveImage}
                            disabled={!canSaveImage}
                          >
                            Save image
                          </button>
                      </div>

                      <div className="logo-adjust-grid" aria-disabled={!canAdjustLogo}>
                        <label className="logo-slider-row" htmlFor="logoOffsetX">
                          <span>Move X</span>
                          <input
                            id="logoOffsetX"
                            type="range"
                            min="-35"
                            max="35"
                            step="1"
                            value={logoMoveXPercent}
                            disabled={!canAdjustLogo}
                            onChange={(event) => {
                              const value = Number(event.currentTarget.value) / 100;
                              updateLogoTransform((current) => ({
                                ...current,
                                offsetX: value
                              }));
                            }}
                          />
                          <output>{logoMoveXPercent}%</output>
                        </label>

                        <label className="logo-slider-row" htmlFor="logoOffsetY">
                          <span>Move Y</span>
                          <input
                            id="logoOffsetY"
                            type="range"
                            min="-35"
                            max="35"
                            step="1"
                            value={logoMoveYPercent}
                            disabled={!canAdjustLogo}
                            onChange={(event) => {
                              const value = Number(event.currentTarget.value) / 100;
                              updateLogoTransform((current) => ({
                                ...current,
                                offsetY: value
                              }));
                            }}
                          />
                          <output>{logoMoveYPercent}%</output>
                        </label>

                        <label className="logo-slider-row" htmlFor="logoScale">
                          <span>Scale</span>
                          <input
                            id="logoScale"
                            type="range"
                            min="35"
                            max="220"
                            step="1"
                            value={logoScalePercent}
                            disabled={!canAdjustLogo}
                            onChange={(event) => {
                              const value = Number(event.currentTarget.value) / 100;
                              updateLogoTransform((current) => ({
                                ...current,
                                scale: value
                              }));
                            }}
                          />
                          <output>{logoScalePercent}%</output>
                        </label>

                        <div className="logo-slider-row logo-rotation-readout">
                          <span>Rotate</span>
                          <div className="rotation-readout-track" aria-hidden="true" />
                          <output>{logoRotationDegrees}deg</output>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="logo-adjust-empty">
                      <p className="logo-adjust-empty-title">Generate a preview first</p>
                      <p className="fine-print">
                        Once the mockup is rendered, the logo adjustment controls stay in this step
                        while the product preview remains fixed on the left.
                      </p>
                    </div>
                  )}
                </section>
              </form>
            </div>

            {submitError ? <div className="alert-error">{submitError}</div> : null}

            {showDebug && result ? (
              <details className="debug-panel" open>
                <summary className="debug-summary">Development debug</summary>
                <dl className="debug-grid">
                  <DebugRow label="provider" value={result.provider || result.debug?.provider} />
                  <DebugRow label="model" value={result.model || result.debug?.model} />
                  <DebugRow label="stubMode" value={result.stubMode ?? result.debug?.stubMode} />
                  <DebugRow label="productSlug" value={result.debug?.productSlug} />
                  <DebugRow label="templateId" value={result.debug?.templateId} />
                  <DebugRow
                    label="baseImagePath"
                    value={result.debug?.baseImagePath || result.debug?.baseProductImagePath}
                  />
                  <DebugRow
                    label="instructionImagePath"
                    value={result.debug?.instructionImagePath}
                  />
                  <DebugRow label="logoFileName" value={result.debug?.logoFileName} />
                  <DebugRow label="promptUsed" value={result.debug?.promptUsed} />
                </dl>
              </details>
            ) : null}
          </section>

          {isInstructionOpen ? (
            <div
              className="instruction-modal-backdrop"
              role="presentation"
              onClick={() => setIsInstructionOpen(false)}
            >
              <div
                className="instruction-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="instruction-modal-title"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="instruction-modal-head">
                  <div>
                    <p className="panel-kicker">Instruction image</p>
                    <h2 id="instruction-modal-title" className="section-title">
                      {template.name}
                    </h2>
                  </div>
                  <button
                    type="button"
                    className="instruction-close-button"
                    aria-label="Close instruction image"
                    onClick={() => setIsInstructionOpen(false)}
                  >
                    Close
                  </button>
                </div>

                <div className="instruction-modal-body">
                  <div className="image-frame instruction-modal-frame">
                    <img
                      src={template.instructionImageUrl}
                      alt={`${template.name} instruction areas`}
                    />
                  </div>
                  <div className="instruction-modal-sidebar">
                    <div className="instruction-legend">
                      {template.colorParts.map((part) => (
                        <div key={part.id} className="instruction-legend-item">
                          {part.instructionColorHex ? (
                            <span
                              className="color-swatch"
                              style={{ backgroundColor: part.instructionColorHex }}
                              aria-hidden="true"
                            />
                          ) : null}
                          <div className="instruction-legend-copy">
                            <strong>{part.label}</strong>
                            <span>{part.description}</span>
                            {part.instructionCue ? <span>{part.instructionCue}</span> : null}
                          </div>
                        </div>
                      ))}
                    </div>

                    {template.specifications?.length ? (
                      <dl className="spec-grid instruction-spec-grid">
                        {template.specifications.map((specification) => (
                          <div
                            key={`${specification.label}-${specification.value}`}
                            className="spec-row"
                          >
                            <dt className="debug-label">{specification.label}</dt>
                            <dd className="figure-caption">{specification.value}</dd>
                          </div>
                        ))}
                      </dl>
                    ) : null}

                    <p className="fine-print">
                      Only the configured product parts above should be recolored. All other
                      surfaces stay unchanged.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </main>
  );
}

function makeGenerateFormData(params: {
  productSlug: string;
  partPantones: Record<string, string>;
  partFinishes: Record<string, ProductFinishOption>;
  logoPrintColor: string;
  printingMethod: string;
  logoFile: File;
}) {
  const formData = new FormData();
  formData.append("productSlug", params.productSlug);
  formData.append("partPantones", JSON.stringify(params.partPantones));
  formData.append("partFinishes", JSON.stringify(params.partFinishes));
  formData.append("logoPrintColor", params.logoPrintColor);
  formData.append("printingMethod", params.printingMethod);
  formData.append("removeBackground", "false");
  formData.append("logoFile", params.logoFile);
  return formData;
}

async function fileToLogoJsonPayload(file: File): Promise<LogoJsonPayload> {
  const buffer = await file.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }

  return {
    fileName: file.name,
    mimeType: file.type,
    data: btoa(binary)
  };
}
