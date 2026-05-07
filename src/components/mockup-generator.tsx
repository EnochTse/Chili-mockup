"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import ChiliLogo from "@/components/chili-logo";
import { getQuickColorOptions, resolveColorOption } from "@/lib/services/color-option.service";
import { getPrintingMethodPrompt } from "@/lib/services/prompt.service";
import type { TemplatePublicDto, TemplateSummaryDto } from "@/lib/types";

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
    }>;
    baseImagePath?: string;
    baseProductImagePath: string;
    instructionImagePath: string;
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

const generateFetchTimeoutMs = 210000;
const jobStatusFetchTimeoutMs = 30000;
const localJobPollIntervalMs = 5000;
const localJobMaxWaitMs = 15 * 60 * 1000;
const maxClientLogoSizeBytes = 4 * 1024 * 1024;
const maxPreviewRetryCount = 6;
const fallbackLogoArea = { x: 0.34, y: 0.58, width: 0.32, height: 0.11 };
const defaultLogoTransform = { offsetX: 0, offsetY: 0, scale: 1, rotation: 0 };
const logoOffsetLimit = 0.35;

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
  if (process.env.NEXT_PUBLIC_GENERATE_ENDPOINT) {
    return process.env.NEXT_PUBLIC_GENERATE_ENDPOINT;
  }

  return process.env.NODE_ENV === "development"
    ? "/api/mockup/generate"
    : "/.netlify/functions/generate-mockup";
}

function buildPreviewImageUrl(imageUrl: string, attempt: number) {
  if (imageUrl.startsWith("data:")) return imageUrl;

  const separator = imageUrl.includes("?") ? "&" : "?";
  return `${imageUrl}${separator}v=${Date.now()}-${attempt}`;
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
    const data = text ? (JSON.parse(text) as T) : ({} as T);

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

function getCanvasContext(canvas: HTMLCanvasElement) {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Canvas is not available in this browser.");
  return context;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function normalizeLogoTransform(transform: LogoTransform): LogoTransform {
  return {
    offsetX: clamp(transform.offsetX, -logoOffsetLimit, logoOffsetLimit),
    offsetY: clamp(transform.offsetY, -logoOffsetLimit, logoOffsetLimit),
    scale: clamp(transform.scale, 0.35, 2.2),
    rotation: clamp(transform.rotation, -45, 45)
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
  const previewRetryCountRef = useRef(0);
  const previewRetryTimeoutRef = useRef<number | null>(null);
  const logoDragStateRef = useRef<LogoDragState | null>(null);

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
      setPartPantones(
        Object.fromEntries(
          initialTemplate.colorParts
            .filter((part) => part.defaultPantoneCode)
            .map((part) => [part.id, part.defaultPantoneCode!])
        )
      );
      setLogoPrintColor(initialTemplate.defaultLogoPrintColor || "");
      setPrintingMethod("");
      setLogoFile(null);
      setResult(null);
      setPreviewImageUrl(null);
      setCompositedPreviewUrl(null);
      setIsPreviewResolving(false);
      setLogoTransform(createDefaultLogoTransform());
      setIsLogoDragging(false);
      logoDragStateRef.current = null;
      setSubmitError(null);
      setGenerationStatus(null);
      return;
    }

    setTemplate(null);
    setTemplateError("This product has not been configured for mockup generation.");
    setIsTemplateLoading(false);
  }, [productSlug]);

  useEffect(() => {
    return () => {
      clearPreviewRetryTimeout();
    };
  }, []);

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
      setCompositedPreviewUrl(null);
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

  const hasAllPartPantones = template
    ? template.colorParts.every((part) => Boolean(partPantones[part.id]))
    : false;

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

  function updateLogoTransform(next: LogoTransform | ((current: LogoTransform) => LogoTransform)) {
    setLogoTransform((current) =>
      normalizeLogoTransform(typeof next === "function" ? next(current) : next)
    );
  }

  function resetLogoTransform() {
    updateLogoTransform(createDefaultLogoTransform());
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
    setGenerationStatus("Starting Gemini job...");
    setCompositedPreviewUrl(null);
    setLogoTransform(createDefaultLogoTransform());
    setIsLogoDragging(false);
    logoDragStateRef.current = null;

    try {
      const endpoint = getGenerateEndpoint();
      const isLocalNextApi = endpoint.startsWith("/api/");

      if (isLocalNextApi) {
        const formData = makeGenerateFormData({
          productSlug,
          partPantones,
          logoPrintColor,
          printingMethod,
          logoFile
        });
        const startResult = await fetchJsonWithTimeout<GenerateResponse>(
          "/api/mockup/generate/start",
          {
            method: "POST",
            body: formData
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
            "/api/mockup/generate/status",
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
        return;
      }

      const responseResult = await fetchJsonWithTimeout<GenerateResponse>(
        endpoint,
        {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({
            productSlug,
            partPantones,
            logoPrintColor,
            printingMethod,
            removeBackground: false,
            logoFile: await fileToLogoJsonPayload(logoFile)
          })
        },
        generateFetchTimeoutMs
      );
      const response = responseResult.response;
      const data = responseResult.data;

      if (!response.ok || !data.success || !data.imageUrl) {
        throw new Error(
          data.errorCode ? `${data.errorCode}: ${data.error}` : data.error || "Generation failed."
        );
      }

      if (data.provider !== "gemini" || data.stubMode) {
        throw new Error("REAL_AI_REQUIRED: The API did not return a real Gemini image.");
      }

      setResult(data);
      setGenerationStatus(null);
    } catch (error) {
      setGenerationStatus(null);
      if (error instanceof DOMException && error.name === "AbortError") {
        setSubmitError(
          "AI_GENERATION_TIMEOUT: Gemini did not return a result within 210 seconds. Please try again later."
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
          <div>
            <p className="eyebrow">Product mockup workflow</p>
            <h1 className="hero-title">Chili Product Mockup Generator</h1>
          </div>
          <div className="notice-panel">
            <strong>Visual reference only.</strong> Not final production artwork.
            <br />
            Colors, logo size, and printing method must be confirmed by the Chili design
            team.
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
            <section className="surface asset-panel">
              <div className="panel-head">
                <p className="panel-kicker">Template</p>
                <h2 className="panel-title">{template.name}</h2>
                <p className="panel-description">{template.description}</p>
                {template.size ? <p className="fine-print">Size: {template.size}</p> : null}
                {template.specifications?.length ? (
                  <dl className="spec-grid">
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
              </div>

              <div className="asset-grid">
                <figure className="asset-figure">
                  <div className="image-frame">
                    <img src={template.baseImageUrl} alt={`${template.name} base product`} />
                  </div>
                  <figcaption className="figure-caption">Base product image</figcaption>
                </figure>

                <details className="instruction-panel" open={showDebug}>
                  <summary className="details-summary">Instruction image</summary>
                  <div className="image-frame result-frame">
                    <img
                      src={template.instructionImageUrl}
                      alt={`${template.name} instruction areas`}
                    />
                  </div>
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
                    <p className="fine-print">
                      Only the configured product parts above should be recolored. All other
                      surfaces stay unchanged.
                    </p>
                  </div>
                </details>
              </div>
            </section>

            <section
              className="surface render-panel"
              aria-busy={isSubmitting || isPreviewResolving}
            >
              <div className="panel-head">
                <p className="panel-kicker">Rendering</p>
                <h2 className="section-title">Mockup preview</h2>
                <p className="panel-description">
                  This section shows the generated reference mockup at a larger size.
                </p>
              </div>

              <div className="render-stage">
                {compositedPreviewUrl ? (
                  <img
                    className={`render-preview-image logo-adjust-preview${
                      isLogoDragging ? " is-logo-dragging" : ""
                    }`}
                    src={compositedPreviewUrl}
                    alt="Generated Chili product mockup"
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
                ) : (
                  <div className="render-placeholder">
                    <p className="render-placeholder-title">
                      {previewImageUrl ? "Preparing preview" : "Ready to render"}
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

              {result?.imageUrl ? (
                <div className="render-meta">
                  <p className="fine-print">Visual reference only.</p>
                  <p className="result-meta">
                    Product generated by {result.model || "Nano Banana 2"} via Gemini API.
                    Logo applied locally from the uploaded file.
                  </p>
                  <div className="logo-adjust-panel">
                    <div className="logo-adjust-head">
                      <div>
                        <p className="logo-adjust-title">Logo position adjustment</p>
                        <p className="fine-print">
                          Drag the preview, or fine-tune the logo with the controls below. This
                          does not regenerate the AI image.
                        </p>
                      </div>
                      <button
                        className="secondary-link-button logo-reset-button"
                        type="button"
                        onClick={resetLogoTransform}
                        disabled={!canAdjustLogo}
                      >
                        Reset
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

                      <label className="logo-slider-row" htmlFor="logoRotation">
                        <span>Rotate</span>
                        <input
                          id="logoRotation"
                          type="range"
                          min="-45"
                          max="45"
                          step="1"
                          value={logoRotationDegrees}
                          disabled={!canAdjustLogo}
                          onChange={(event) => {
                            const value = Number(event.currentTarget.value);
                            updateLogoTransform((current) => ({
                              ...current,
                              rotation: value
                            }));
                          }}
                        />
                        <output>{logoRotationDegrees}deg</output>
                      </label>
                    </div>
                  </div>
                </div>
              ) : null}
            </section>
          </div>

          <section className="surface form-panel">
            <div className="form-heading">
              <p className="panel-kicker">Configuration</p>
              <h2 className="section-title">Generate mockup</h2>
            </div>

            <form className="generator-form" onSubmit={handleSubmit}>
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
                {template.colorParts.map((part) => {
                  const selectedPantone = resolveColorOption(
                    template.pantoneOptions,
                    partPantones[part.id] || ""
                  );

                  return (
                    <div key={part.id} className="part-selection-card">
                      <div className="part-selection-head">
                        <div>
                          <label className="control-label" htmlFor={`part-${part.id}`}>
                            {part.label} Pantone color
                          </label>
                          <p className="fine-print">{part.description}</p>
                          {part.instructionCue ? (
                            <p className="fine-print">Instruction cue: {part.instructionCue}</p>
                          ) : null}
                        </div>
                        <button
                          id={`part-${part.id}`}
                          type="button"
                          className="pantone-trigger"
                          aria-label={`${part.label} Pantone color`}
                          aria-expanded={openPartId === part.id}
                          onClick={() =>
                            setOpenPartId((current) => (current === part.id ? null : part.id))
                          }
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
                            onClick={() =>
                              setPartPantones((current) => ({
                                ...current,
                                [part.id]: option.code
                              }))
                            }
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

              <button className="button-primary" type="submit" disabled={!canGenerate}>
                {isSubmitting ? "Generating..." : "Generate mockup"}
              </button>
            </form>

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
        </div>
      ) : null}
    </main>
  );
}

function makeGenerateFormData(params: {
  productSlug: string;
  partPantones: Record<string, string>;
  logoPrintColor: string;
  printingMethod: string;
  logoFile: File;
}) {
  const formData = new FormData();
  formData.append("productSlug", params.productSlug);
  formData.append("partPantones", JSON.stringify(params.partPantones));
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
