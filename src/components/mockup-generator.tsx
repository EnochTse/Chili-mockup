"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import ChiliLogo from "@/components/chili-logo";
import { getQuickColorOptions, resolveColorOption } from "@/lib/services/color-option.service";
import {
  isColorLockedFinish,
  productFinishLabels,
  resolvePartFinishSelection
} from "@/lib/services/finish-option.service";
import {
  normalizeProductCategory,
  productCategoryOptions
} from "@/lib/services/product-category.service";
import { getPrintingMethodPrompt } from "@/lib/services/prompt.service";
import type {
  LayeredMaterialMapKey,
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
  provider?: "local-layered";
  debug?: {
    provider?: string;
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

const logoPrintColorLabels: Record<string, string> = {
  white: "White",
  black: "Black",
  original: "Original logo colors",
  pantone_match: "Match selected Pantone"
};

const maxClientLogoSizeBytes = 4 * 1024 * 1024;
const maxPreviewRetryCount = 6;
const fallbackLogoArea = { x: 0.34, y: 0.58, width: 0.32, height: 0.11 };
const defaultLogoTransform = { offsetX: 0, offsetY: 0, scale: 1, rotation: 0 };
const logoOffsetLimit = 0.35;
const imageLoadCache = new Map<string, Promise<HTMLImageElement>>();
const logoQuarterTurnDegrees = 90;

type PixelRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type LogoPlacementArea = PixelRect & {
  area: number;
};

type Rgb = {
  r: number;
  g: number;
  b: number;
};

type LinearRgb = {
  r: number;
  g: number;
  b: number;
};

type LayeredRenderImages = Partial<Record<ProductFinishOption, HTMLImageElement>>;

type LayeredFinishSource = {
  imageData: ImageData;
};

type LayeredMaterialMaps = {
  width: number;
  height: number;
  shadowMap: Uint8ClampedArray;
  highlightMap: Uint8ClampedArray;
  textureMap: Uint8ClampedArray;
  specularMap: Uint8ClampedArray;
};

type LayeredMaterialCalibrationMask = {
  width: number;
  height: number;
  values: Uint8Array;
  coveredPixelCount: number;
  signature: string;
};

type MapBrightnessStats = {
  p05: number;
  p10: number;
  p50: number;
  p90: number;
  p95: number;
};

type MatteMapCalibration = {
  shadowLitnessLift: number;
  highlightInputLow: number;
  highlightInputHigh: number;
  highlightStrength: number;
  textureCenter: number;
  textureScale: number;
  specularLift: number;
};

type LayeredMaterialMapImages = Partial<Record<LayeredMaterialMapKey, HTMLImageElement>>;

type LayeredMaterialMapSources = Partial<Record<LayeredMaterialMapKey, ImageData>>;

type LayeredMaterialMapImagesByFinish = Partial<
  Record<ProductFinishOption, LayeredMaterialMapImages>
>;

type LayeredMaterialMapSourcesByFinish = Partial<
  Record<ProductFinishOption, LayeredMaterialMapSources>
>;

const layeredMaterialMapCache = new Map<string, LayeredMaterialMaps>();
const maxLayeredMaterialMapCacheEntries = 12;
const layeredFinishSourceCache = new Map<string, LayeredFinishSource>();
const maxLayeredFinishSourceCacheEntries = 6;
const layeredMaterialMapSourceCache = new Map<string, LayeredMaterialMapSources>();
const maxLayeredMaterialMapSourceCacheEntries = 6;

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

function getRenderableFinishBaseImages(template: TemplatePublicDto) {
  return template.layeredRender?.enabled
    ? template.layeredRender.finishBaseImages
    : ({ matte: template.baseImageUrl } satisfies Partial<Record<ProductFinishOption, string>>);
}

function getRenderablePartFinishes(
  template: TemplatePublicDto,
  part: TemplatePublicDto["colorParts"][number]
) {
  const finishBaseImages = getRenderableFinishBaseImages(template);
  return (part.allowedFinishes || []).filter((finish) => Boolean(finishBaseImages[finish]));
}

function getPartNumberText(label: string, fallbackIndex: number) {
  const match = label.match(/\d+/);
  return match?.[0] || `${fallbackIndex + 1}`;
}

function resolveRenderablePartFinishSelection(
  template: TemplatePublicDto,
  part: TemplatePublicDto["colorParts"][number],
  selectedValue: unknown
) {
  const renderableFinishes = getRenderablePartFinishes(template, part);
  if (!renderableFinishes.length) return undefined;

  return resolvePartFinishSelection(
    { ...part, allowedFinishes: renderableFinishes },
    selectedValue
  );
}

function getFallbackPantoneCode(template: TemplatePublicDto, part: TemplatePublicDto["colorParts"][number]) {
  return part.defaultPantoneCode || template.pantoneOptions[0]?.code || "";
}

function buildSelectedPartPantones(
  template: TemplatePublicDto,
  partPantones: Record<string, string>,
  partFinishes: Record<string, ProductFinishOption>
): SelectedPartPantone[] {
  return template.colorParts.map((part) => {
    const selectedFinish = resolveRenderablePartFinishSelection(template, part, partFinishes[part.id]);
    const pantoneCode =
      partPantones[part.id] ||
      (isColorLockedFinish(selectedFinish) ? getFallbackPantoneCode(template, part) : "");
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
      selectedFinish
    };
  });
}

function buildInitialPartFinishes(template: TemplatePublicDto) {
  return Object.fromEntries(
    template.colorParts.flatMap((part) => {
      const selectedFinish = resolveRenderablePartFinishSelection(template, part, part.defaultFinish);
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

function srgbChannelToLinear(value: number) {
  const normalized = clamp(value / 255, 0, 1);
  return normalized <= 0.04045
    ? normalized / 12.92
    : Math.pow((normalized + 0.055) / 1.055, 2.4);
}

function linearChannelToSrgb(value: number) {
  const normalized = clamp(value, 0, 1);
  const srgb =
    normalized <= 0.0031308
      ? normalized * 12.92
      : 1.055 * Math.pow(normalized, 1 / 2.4) - 0.055;
  return Math.round(clamp(srgb, 0, 1) * 255);
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
  const shouldCache = !source.startsWith("data:") && !source.startsWith("blob:");
  const cachedImage = shouldCache ? imageLoadCache.get(source) : undefined;
  if (cachedImage) return cachedImage;

  const imagePromise = new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    if (shouldCache) {
      image.crossOrigin = "anonymous";
    }
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Image failed to load."));
    image.src = source;
  });

  if (shouldCache) {
    imageLoadCache.set(source, imagePromise);
    imagePromise.catch(() => imageLoadCache.delete(source));
  }
  return imagePromise;
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

function sampleImageAlpha(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number
) {
  const sampleX = Math.round(clamp(x, 0, width - 1));
  const sampleY = Math.round(clamp(y, 0, height - 1));
  return data[(sampleY * width + sampleX) * 4 + 3] / 255;
}

function sampleImageBrightness(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number
) {
  const sampleX = Math.round(clamp(x, 0, width - 1));
  const sampleY = Math.round(clamp(y, 0, height - 1));
  const index = (sampleY * width + sampleX) * 4;
  return (data[index] * 0.2126 + data[index + 1] * 0.7152 + data[index + 2] * 0.0722) / 255;
}

function proceduralNoise(x: number, y: number) {
  const value = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return value - Math.floor(value);
}

function createSolidAlphaMaskCanvas(logoCanvas: HTMLCanvasElement, color: string) {
  const maskCanvas = document.createElement("canvas");
  maskCanvas.width = logoCanvas.width;
  maskCanvas.height = logoCanvas.height;
  const maskContext = getCanvasContext(maskCanvas);
  maskContext.drawImage(logoCanvas, 0, 0);
  maskContext.globalCompositeOperation = "source-in";
  maskContext.fillStyle = color;
  maskContext.fillRect(0, 0, maskCanvas.width, maskCanvas.height);
  return maskCanvas;
}

function extractCanvasRegion(context: CanvasRenderingContext2D, rect: PixelRect) {
  const startX = Math.max(0, Math.floor(rect.x));
  const startY = Math.max(0, Math.floor(rect.y));
  const endX = Math.min(context.canvas.width, Math.ceil(rect.x + rect.width));
  const endY = Math.min(context.canvas.height, Math.ceil(rect.y + rect.height));
  const width = Math.max(1, endX - startX);
  const height = Math.max(1, endY - startY);
  return context.getImageData(startX, startY, width, height);
}

function createMirrorLaserEffectCanvas(
  logoCanvas: HTMLCanvasElement,
  backdropImageData?: ImageData
) {
  const sourceContext = getCanvasContext(logoCanvas);
  const sourceData = sourceContext.getImageData(0, 0, logoCanvas.width, logoCanvas.height);
  const effectCanvas = document.createElement("canvas");
  effectCanvas.width = logoCanvas.width;
  effectCanvas.height = logoCanvas.height;
  const effectContext = getCanvasContext(effectCanvas);
  const effectData = effectContext.createImageData(logoCanvas.width, logoCanvas.height);

  for (let y = 0; y < logoCanvas.height; y += 1) {
    const rowNoise = proceduralNoise(19.7, y * 0.91);
    const brushedLine = Math.sin(y * 0.34 + rowNoise * Math.PI * 2) * 0.022;

    for (let x = 0; x < logoCanvas.width; x += 1) {
      const pixelIndex = y * logoCanvas.width + x;
      const dataIndex = pixelIndex * 4;
      const alpha = sourceData.data[dataIndex + 3] / 255;
      if (alpha <= 0) continue;

      const left = sampleImageAlpha(sourceData.data, logoCanvas.width, logoCanvas.height, x - 1, y);
      const right = sampleImageAlpha(sourceData.data, logoCanvas.width, logoCanvas.height, x + 1, y);
      const up = sampleImageAlpha(sourceData.data, logoCanvas.width, logoCanvas.height, x, y - 1);
      const down = sampleImageAlpha(sourceData.data, logoCanvas.width, logoCanvas.height, x, y + 1);
      const gradientX = right - left;
      const gradientY = down - up;
      const edgeStrength = clamp((Math.abs(gradientX) + Math.abs(gradientY)) * 1.6, 0, 1);
      const bevelLight = clamp(0.5 + (-gradientX * 0.76 - gradientY * 0.58) * 0.9, 0, 1);
      const grainNoise = proceduralNoise(x * 1.17 + 9.1, y * 1.11 + 3.7);
      const grain = (grainNoise - 0.5) * 0.028;
      const backdropBrightness = backdropImageData
        ? sampleImageBrightness(
            backdropImageData.data,
            backdropImageData.width,
            backdropImageData.height,
            (x / Math.max(1, logoCanvas.width - 1)) * (backdropImageData.width - 1),
            (y / Math.max(1, logoCanvas.height - 1)) * (backdropImageData.height - 1)
          )
        : 0.3;
      const reflectionDriver = clamp(0.58 + backdropBrightness * 0.42, 0.58, 0.94);
      const diagonalCoord = (x + y * 0.62) / Math.max(1, logoCanvas.width + logoCanvas.height * 0.62);
      const reflectionBandA = Math.exp(-Math.pow((diagonalCoord - 0.24) / 0.06, 2)) * 0.18;
      const reflectionBandB = Math.exp(-Math.pow((diagonalCoord - 0.72) / 0.08, 2)) * 0.12;
      const reflectionBandC =
        Math.exp(-Math.pow(((x - y * 0.28) / Math.max(1, logoCanvas.width)) - 0.54, 2) / 0.01) *
        0.08;
      const metalBody =
        reflectionDriver +
        brushedLine +
        grain +
        reflectionBandA +
        reflectionBandB +
        reflectionBandC;
      const edgeHighlight = smoothstep(0.52, 1, bevelLight) * edgeStrength * 0.18;
      const edgeShadow = smoothstep(0.48, 0, bevelLight) * edgeStrength * 0.14;
      const innerRecess = (1 - edgeStrength) * 0.055;
      const brightness = clamp(metalBody + edgeHighlight - edgeShadow - innerRecess, 0.52, 1);
      const coolTint = 1 + edgeStrength * 0.04;

      effectData.data[dataIndex] = Math.round(clamp(brightness * 242, 0, 255));
      effectData.data[dataIndex + 1] = Math.round(clamp(brightness * 246, 0, 255));
      effectData.data[dataIndex + 2] = Math.round(clamp(brightness * 252 * coolTint, 0, 255));
      effectData.data[dataIndex + 3] = Math.round(alpha * 255);
    }
  }

  effectContext.putImageData(effectData, 0, 0);
  return effectCanvas;
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

function resolvePrintingAreaImageUrl(template: TemplatePublicDto, printingMethod: string) {
  const printingAreaImages = template.logoPlacement.printingAreaImages;
  if (!printingAreaImages) return "";

  return (
    printingAreaImages[printingMethod] ||
    printingAreaImages.default ||
    Object.values(printingAreaImages)[0] ||
    ""
  );
}

function detectRedPrintingAreaRects(
  printingAreaImage: HTMLImageElement,
  targetWidth: number,
  targetHeight: number
): LogoPlacementArea[] {
  const sourceWidth = printingAreaImage.naturalWidth || printingAreaImage.width;
  const sourceHeight = printingAreaImage.naturalHeight || printingAreaImage.height;
  const maxSampleDimension = 900;
  const scale = Math.min(1, maxSampleDimension / Math.max(sourceWidth, sourceHeight));
  const sampleWidth = Math.max(1, Math.round(sourceWidth * scale));
  const sampleHeight = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = sampleWidth;
  canvas.height = sampleHeight;
  const context = getCanvasContext(canvas);
  context.drawImage(printingAreaImage, 0, 0, sampleWidth, sampleHeight);
  const imageData = context.getImageData(0, 0, sampleWidth, sampleHeight);
  const visited = new Uint8Array(sampleWidth * sampleHeight);
  const queue = new Int32Array(sampleWidth * sampleHeight);
  const areas: LogoPlacementArea[] = [];
  const minComponentPixels = Math.max(12, Math.round(sampleWidth * sampleHeight * 0.00001));

  function isPrintingAreaPixel(pixelIndex: number) {
    const dataIndex = pixelIndex * 4;
    const r = imageData.data[dataIndex];
    const g = imageData.data[dataIndex + 1];
    const b = imageData.data[dataIndex + 2];
    const a = imageData.data[dataIndex + 3];
    return a > 16 && r > 150 && r - Math.max(g, b) > 42;
  }

  for (let pixelIndex = 0; pixelIndex < visited.length; pixelIndex += 1) {
    if (visited[pixelIndex] || !isPrintingAreaPixel(pixelIndex)) continue;

    let queueStart = 0;
    let queueEnd = 0;
    let minX = sampleWidth;
    let minY = sampleHeight;
    let maxX = -1;
    let maxY = -1;
    let count = 0;

    visited[pixelIndex] = 1;
    queue[queueEnd] = pixelIndex;
    queueEnd += 1;

    while (queueStart < queueEnd) {
      const currentPixel = queue[queueStart];
      queueStart += 1;
      const x = currentPixel % sampleWidth;
      const y = Math.floor(currentPixel / sampleWidth);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      count += 1;

      const neighbors = [
        x > 0 ? currentPixel - 1 : -1,
        x < sampleWidth - 1 ? currentPixel + 1 : -1,
        y > 0 ? currentPixel - sampleWidth : -1,
        y < sampleHeight - 1 ? currentPixel + sampleWidth : -1
      ];

      for (const neighbor of neighbors) {
        if (neighbor < 0 || visited[neighbor] || !isPrintingAreaPixel(neighbor)) continue;
        visited[neighbor] = 1;
        queue[queueEnd] = neighbor;
        queueEnd += 1;
      }
    }

    if (count < minComponentPixels || maxX < minX || maxY < minY) continue;

    const x = (minX / sampleWidth) * targetWidth;
    const y = (minY / sampleHeight) * targetHeight;
    const width = ((maxX - minX + 1) / sampleWidth) * targetWidth;
    const height = ((maxY - minY + 1) / sampleHeight) * targetHeight;
    areas.push({
      x,
      y,
      width,
      height,
      area: width * height
    });
  }

  return areas.sort((left, right) => right.area - left.area);
}

function rectCenter(rect: PixelRect) {
  return {
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2
  };
}

function insetPixelRect(rect: PixelRect, amount: number): PixelRect {
  const safeAmount = Math.min(amount, rect.width * 0.35, rect.height * 0.35);
  return {
    x: rect.x + safeAmount,
    y: rect.y + safeAmount,
    width: Math.max(1, rect.width - safeAmount * 2),
    height: Math.max(1, rect.height - safeAmount * 2)
  };
}

function getRotatedBounds(width: number, height: number, rotation: number) {
  const radians = (rotation * Math.PI) / 180;
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));
  return {
    width: width * cos + height * sin,
    height: width * sin + height * cos
  };
}

function resolveLogoOrientationRotation(
  preset: TemplatePublicDto["logoPlacement"]["orientationPreset"],
  logoCanvas: HTMLCanvasElement
) {
  if (!preset) return 0;

  const isLogoVertical = logoCanvas.height > logoCanvas.width;
  if (preset === "vertical" && !isLogoVertical) return 90;
  if (preset === "horizontal" && isLogoVertical) return 90;
  return 0;
}

function chooseLogoPlacementArea(
  areas: LogoPlacementArea[],
  desiredCenter: { x: number; y: number }
) {
  if (!areas.length) return null;

  return areas.reduce((bestArea, area) => {
    const currentCenter = rectCenter(area);
    const bestCenter = rectCenter(bestArea);
    const currentDistance = Math.hypot(
      desiredCenter.x - currentCenter.x,
      desiredCenter.y - currentCenter.y
    );
    const bestDistance = Math.hypot(
      desiredCenter.x - bestCenter.x,
      desiredCenter.y - bestCenter.y
    );
    return currentDistance < bestDistance ? area : bestArea;
  }, areas[0]);
}

function buildFallbackLogoArea(instructionImage: HTMLImageElement, width: number, height: number) {
  const normalizedArea = detectGreenLogoArea(instructionImage);
  return {
    x: normalizedArea.x * width,
    y: normalizedArea.y * height,
    width: normalizedArea.width * width,
    height: normalizedArea.height * height,
    area: normalizedArea.width * width * normalizedArea.height * height
  };
}

function normalizePixelRects(rects: PixelRect[], width: number, height: number) {
  return rects.map((rect) => ({
    x: rect.x / width,
    y: rect.y / height,
    width: rect.width / width,
    height: rect.height / height
  }));
}

function resolveLogoInkColor(params: {
  logoPrintColor: string;
  printingMethod: string;
  partPantones: Record<string, string>;
  template: TemplatePublicDto;
}) {
  if (params.logoPrintColor === "original") return null;
  if (params.printingMethod === "laser_engraving") return hexToRgb("#302c27");
  if (params.printingMethod === "mirror_laser_engraving") return hexToRgb("#f4f6fb");
  if (params.logoPrintColor === "white") return hexToRgb("#ffffff");
  if (params.logoPrintColor === "black") return hexToRgb("#050505");

  const matchedPantone = params.template.colorParts
    .map((part) => resolveColorOption(params.template.pantoneOptions, params.partPantones[part.id] || ""))
    .find(Boolean);

  return hexToRgb(matchedPantone?.previewHex || "#050505");
}

function makeLogoEffectCanvas(
  logoCanvas: HTMLCanvasElement,
  printingMethod: string,
  backdropImageData?: ImageData
) {
  if (printingMethod === "mirror_laser_engraving") {
    return createMirrorLaserEffectCanvas(logoCanvas, backdropImageData);
  }

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
  backdropImageData?: ImageData;
}) {
  const { context, logoCanvas, rect, printingMethod, rotation, backdropImageData } = params;
  const effectCanvas = makeLogoEffectCanvas(logoCanvas, printingMethod, backdropImageData);

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
    const bevelOffset = Math.max(0.6, Math.min(rect.width, rect.height) * 0.012);
    const shadowMask = createSolidAlphaMaskCanvas(logoCanvas, "#050505");
    const lightMask = createSolidAlphaMaskCanvas(logoCanvas, "#ffffff");

    context.globalCompositeOperation = "multiply";
    context.globalAlpha = 0.18;
    context.filter = `blur(${Math.max(0.4, bevelOffset * 0.55)}px)`;
    context.drawImage(
      shadowMask,
      -rect.width / 2 + bevelOffset,
      -rect.height / 2 + bevelOffset,
      rect.width,
      rect.height
    );

    context.filter = "none";
    context.globalCompositeOperation = "screen";
    context.globalAlpha = 0.16;
    context.drawImage(
      lightMask,
      -rect.width / 2 - bevelOffset * 0.28,
      -rect.height / 2 - bevelOffset * 0.38,
      rect.width,
      rect.height
    );

    context.globalCompositeOperation = "source-over";
    context.globalAlpha = 0.94;
    context.drawImage(effectCanvas, -rect.width / 2, -rect.height / 2, rect.width, rect.height);

    context.globalCompositeOperation = "overlay";
    context.globalAlpha = 0.2;
    context.drawImage(
      effectCanvas,
      -rect.width / 2 - bevelOffset * 0.18,
      -rect.height / 2 - bevelOffset * 0.24,
      rect.width,
      rect.height
    );
    context.restore();
    return;
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
  const printingAreaImageUrl = resolvePrintingAreaImageUrl(params.template, params.printingMethod);
  const [productImage, instructionImage, logoImage, printingAreaImage] = await Promise.all([
    loadImage(params.productImageUrl),
    loadImage(params.instructionImageUrl),
    loadFileImage(params.logoFile),
    printingAreaImageUrl
      ? loadImage(toAbsoluteAssetUrl(printingAreaImageUrl))
      : Promise.resolve(null)
  ]);
  const canvas = document.createElement("canvas");
  canvas.width = productImage.naturalWidth || productImage.width;
  canvas.height = productImage.naturalHeight || productImage.height;
  const context = getCanvasContext(canvas);
  context.drawImage(productImage, 0, 0, canvas.width, canvas.height);

  const detectedAreas = printingAreaImage
    ? detectRedPrintingAreaRects(printingAreaImage, canvas.width, canvas.height)
    : [];
  const placementAreas = detectedAreas.length
    ? detectedAreas
    : [buildFallbackLogoArea(instructionImage, canvas.width, canvas.height)];
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
  const defaultArea = placementAreas[0];
  const defaultCenter = rectCenter(defaultArea);
  const desiredCenter = {
    x: defaultCenter.x + logoTransform.offsetX * canvas.width,
    y: defaultCenter.y + logoTransform.offsetY * canvas.height
  };
  const logoArea = chooseLogoPlacementArea(placementAreas, desiredCenter) || defaultArea;
  const padding = Math.min(logoArea.width, logoArea.height) * 0.06;
  const usableArea = insetPixelRect(logoArea, padding);
  const orientationRotation = resolveLogoOrientationRotation(
    params.template.logoPlacement.orientationPreset,
    logoCanvas
  );
  const finalRotation = normalizeLogoTransform({
    ...logoTransform,
    rotation: logoTransform.rotation + orientationRotation
  }).rotation;
  const naturalRotatedBounds = getRotatedBounds(
    logoCanvas.width,
    logoCanvas.height,
    finalRotation
  );
  const baseScale = Math.min(
    usableArea.width / Math.max(1, naturalRotatedBounds.width),
    usableArea.height / Math.max(1, naturalRotatedBounds.height)
  );
  const scale = Math.max(0.01, baseScale * Math.min(logoTransform.scale, 1));
  const drawWidth = logoCanvas.width * scale;
  const drawHeight = logoCanvas.height * scale;
  const rotatedBounds = getRotatedBounds(drawWidth, drawHeight, finalRotation);
  const centerX = clamp(
    desiredCenter.x,
    usableArea.x + rotatedBounds.width / 2,
    usableArea.x + usableArea.width - rotatedBounds.width / 2
  );
  const centerY = clamp(
    desiredCenter.y,
    usableArea.y + rotatedBounds.height / 2,
    usableArea.y + usableArea.height - rotatedBounds.height / 2
  );
  const drawRect = {
    x: centerX - drawWidth / 2,
    y: centerY - drawHeight / 2,
    width: drawWidth,
    height: drawHeight
  };
  const backdropImageData =
    params.printingMethod === "mirror_laser_engraving"
      ? extractCanvasRegion(context, drawRect)
      : undefined;

  drawLogoWithPrintEffect({
    context,
    logoCanvas,
    rect: drawRect,
    printingMethod: params.printingMethod,
    rotation: finalRotation,
    backdropImageData
  });

  return canvas.toDataURL("image/png");
}

const defaultLayeredFinishRule = {
  colorOpacity: 0.96,
  blendMode: "source-over" as GlobalCompositeOperation,
  highlightProtection: 0.22,
  textureStrength: 0.14,
  saturationBoost: 0.06
};

function getRelativeLuminanceLinear(color: LinearRgb) {
  return color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722;
}

function boostLinearTintSaturation(tint: LinearRgb, saturationBoost: number): LinearRgb {
  const luminance = getRelativeLuminanceLinear(tint);
  const boostFactor = 1 + saturationBoost;

  return {
    r: clamp(luminance + (tint.r - luminance) * boostFactor, 0, 1),
    g: clamp(luminance + (tint.g - luminance) * boostFactor, 0, 1),
    b: clamp(luminance + (tint.b - luminance) * boostFactor, 0, 1)
  };
}

function mixLinearColor(from: LinearRgb, to: LinearRgb, amount: number): LinearRgb {
  const mixAmount = clamp(amount, 0, 1);
  return {
    r: from.r + (to.r - from.r) * mixAmount,
    g: from.g + (to.g - from.g) * mixAmount,
    b: from.b + (to.b - from.b) * mixAmount
  };
}

function isNearWhiteTint(tint: Rgb) {
  const maxChannel = Math.max(tint.r, tint.g, tint.b);
  const minChannel = Math.min(tint.r, tint.g, tint.b);
  return minChannel >= 238 && maxChannel - minChannel <= 18;
}

function getWhiteAlbedoLinear(tint: Rgb): LinearRgb {
  const whiteBase = {
    r: clamp(246 + (tint.r - 255) * 0.06, 238, 248),
    g: clamp(245 + (tint.g - 255) * 0.06, 237, 247),
    b: clamp(242 + (tint.b - 255) * 0.06, 234, 244)
  };

  return {
    r: srgbChannelToLinear(whiteBase.r),
    g: srgbChannelToLinear(whiteBase.g),
    b: srgbChannelToLinear(whiteBase.b)
  };
}

function smoothstep(edge0: number, edge1: number, value: number) {
  if (edge0 === edge1) return value < edge0 ? 0 : 1;

  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

type LayeredMaterialProfile = {
  tonalAnchor: number;
  tonalContrast: number;
  shadeBase: number;
  shadeRange: number;
  shadeGamma: number;
  shadowStart: number;
  shadowEnd: number;
  shadowStrength: number;
  minShade: number;
  maxShade: number;
  highlightStart: number;
  highlightEnd: number;
  highlightPower: number;
  highlightStrength: number;
  microDetailStrength: number;
  microDetailClamp: number;
};

type MatteSoftLightResponse = {
  softLightAmount: number;
  matteShade: number;
  sheenLift: number;
  formVisibilityLift: number;
  textureVisibilityLift: number;
  reflectanceLift: number;
};

function getLayeredMaterialProfile(params: {
  finish: ProductFinishOption;
  isWhiteTint: boolean;
  highlightProtection: number;
  textureStrength: number;
}): LayeredMaterialProfile {
  const { finish, isWhiteTint, highlightProtection, textureStrength } = params;

  if (isWhiteTint) {
    return {
      tonalAnchor: 0.6,
      tonalContrast: 1 + textureStrength * (finish === "matte" ? 0.75 : 1.55),
      shadeBase: 0.72,
      shadeRange: 0.31,
      shadeGamma: 1.05,
      shadowStart: 0.16,
      shadowEnd: 0.68,
      shadowStrength:
        finish === "matte" ? 0.09 + textureStrength * 0.06 : 0.12 + textureStrength * 0.12,
      minShade: 0.62,
      maxShade: finish === "matte" ? 1.02 : 1.06,
      highlightStart: 0.72,
      highlightEnd: 0.98,
      highlightPower: finish === "glossy" ? 1.55 : finish === "matte" ? 2.8 : 2.35,
      highlightStrength:
        finish === "matte"
          ? clamp(0.025 + highlightProtection * 0.08, 0.025, 0.1)
          : clamp(0.04 + highlightProtection * 0.18, 0.04, 0.24),
      microDetailStrength:
        finish === "matte" ? 0.55 + textureStrength * 1.1 : 1.35 + textureStrength * 2.8,
      microDetailClamp:
        finish === "matte" ? 0.025 + textureStrength * 0.06 : 0.12 + textureStrength * 0.2
    };
  }

  if (finish === "glossy") {
    return {
      tonalAnchor: 0.6,
      tonalContrast: 1 + textureStrength * 1.15,
      shadeBase: 0.43,
      shadeRange: 0.78,
      shadeGamma: 1.02,
      shadowStart: 0.18,
      shadowEnd: 0.62,
      shadowStrength: 0.035,
      minShade: 0.34,
      maxShade: 1.18,
      highlightStart: 0.74,
      highlightEnd: 0.99,
      highlightPower: 2.35,
      highlightStrength: clamp(0.08 + highlightProtection * 0.24, 0.08, 0.3),
      microDetailStrength: 0.9 + textureStrength * 1.55,
      microDetailClamp: 0.07 + textureStrength * 0.12
    };
  }

  if (finish === "matte") {
    return {
      tonalAnchor: 0.58,
      tonalContrast: 1 + textureStrength * 1.1,
      shadeBase: 0.4,
      shadeRange: 0.7,
      shadeGamma: 1.18,
      shadowStart: 0.14,
      shadowEnd: 0.72,
      shadowStrength: 0.07,
      minShade: 0.16,
      maxShade: 1.08,
      highlightStart: 0.68,
      highlightEnd: 0.98,
      highlightPower: 2.3,
      highlightStrength: clamp(0.035 + highlightProtection * 0.14, 0.035, 0.16),
      microDetailStrength: 0.82 + textureStrength * 1.7,
      microDetailClamp: 0.04 + textureStrength * 0.09
    };
  }

  if (finish === "rubber") {
    return {
      tonalAnchor: 0.64,
      tonalContrast: 1 + textureStrength * 1.25,
      shadeBase: 0.44,
      shadeRange: 0.72,
      shadeGamma: 1.12,
      shadowStart: 0.2,
      shadowEnd: 0.66,
      shadowStrength: 0.08,
      minShade: 0.3,
      maxShade: 1.08,
      highlightStart: 0.82,
      highlightEnd: 0.99,
      highlightPower: 2.6,
      highlightStrength: clamp(0.035 + highlightProtection * 0.12, 0.035, 0.18),
      microDetailStrength: 0.95 + textureStrength * 1.8,
      microDetailClamp: 0.08 + textureStrength * 0.14
    };
  }

  return {
    tonalAnchor: 0.64,
    tonalContrast: 1 + textureStrength * 1.35,
    shadeBase: 0.44,
    shadeRange: 0.76,
    shadeGamma: 1.08,
    shadowStart: 0.2,
    shadowEnd: 0.66,
    shadowStrength: 0.065,
    minShade: 0.3,
    maxShade: 1.14,
    highlightStart: 0.78,
    highlightEnd: 0.98,
    highlightPower: 2.15,
    highlightStrength: clamp(0.05 + highlightProtection * 0.2, 0.05, 0.28),
    microDetailStrength: 1 + textureStrength * 1.95,
    microDetailClamp: 0.09 + textureStrength * 0.16
  };
}

function getPixelBrightness(data: Uint8ClampedArray, width: number, height: number, x: number, y: number) {
  const sampleX = Math.round(clamp(x, 0, width - 1));
  const sampleY = Math.round(clamp(y, 0, height - 1));
  const index = (sampleY * width + sampleX) * 4;

  return (data[index] * 0.2126 + data[index + 1] * 0.7152 + data[index + 2] * 0.0722) / 255;
}

function encodeUnitMapValue(value: number) {
  return Math.round(clamp(value, 0, 1) * 255);
}

function encodeSignedMapValue(value: number, range: number) {
  if (range <= 0) return 128;
  return Math.round(clamp(0.5 + value / (range * 2), 0, 1) * 255);
}

function decodeSignedMapValue(value: number, range: number) {
  if (range <= 0) return 0;
  return (value / 255 - 0.5) * range * 2;
}

function encodeShadeMapValue(value: number, profile: LayeredMaterialProfile) {
  const range = profile.maxShade - profile.minShade;
  if (range <= 0) return 255;
  return encodeUnitMapValue((value - profile.minShade) / range);
}

function decodeShadeMapValue(value: number, profile: LayeredMaterialProfile) {
  return profile.minShade + (value / 255) * (profile.maxShade - profile.minShade);
}

function createLayeredImageData(
  image: HTMLImageElement,
  width: number,
  height: number
) {
  const imageCanvas = document.createElement("canvas");
  imageCanvas.width = width;
  imageCanvas.height = height;
  const imageContext = getCanvasContext(imageCanvas);
  imageContext.drawImage(image, 0, 0, width, height);

  return imageContext.getImageData(0, 0, width, height);
}

function createLayeredFinishSource(
  finishImage: HTMLImageElement,
  width: number,
  height: number
): LayeredFinishSource {
  return {
    imageData: createLayeredImageData(finishImage, width, height)
  };
}

function createLayeredMaterialMapSources(
  materialMapImages: LayeredMaterialMapImages,
  width: number,
  height: number
): LayeredMaterialMapSources {
  return Object.fromEntries(
    Object.entries(materialMapImages).map(([mapKey, image]) => [
      mapKey,
      createLayeredImageData(image, width, height)
    ])
  ) as LayeredMaterialMapSources;
}

function hasLayeredMaterialMapSources(
  materialMaps?: LayeredMaterialMapSources
) {
  return Boolean(materialMaps && Object.values(materialMaps).some(Boolean));
}

function setCachedLayeredMaterialMaps(cacheKey: string, maps: LayeredMaterialMaps) {
  setCachedLayeredEntry(layeredMaterialMapCache, cacheKey, maps, maxLayeredMaterialMapCacheEntries);
}

function setCachedLayeredEntry<T>(
  cache: Map<string, T>,
  cacheKey: string,
  value: T,
  maxEntries: number
) {
  if (cache.size >= maxEntries) {
    const firstKey = cache.keys().next().value;
    if (firstKey) cache.delete(firstKey);
  }

  cache.set(cacheKey, value);
}

function getLayeredAssetCacheKey(
  width: number,
  height: number,
  signature: string
) {
  return `${width}x${height}|${signature}`;
}

function getOrCreateLayeredFinishSource(params: {
  finishImage: HTMLImageElement;
  width: number;
  height: number;
  sourceSignature: string;
}) {
  const { finishImage, width, height, sourceSignature } = params;
  const cacheKey = getLayeredAssetCacheKey(width, height, sourceSignature);
  const cachedSource = layeredFinishSourceCache.get(cacheKey);
  if (cachedSource) return cachedSource;

  const source = createLayeredFinishSource(finishImage, width, height);
  setCachedLayeredEntry(
    layeredFinishSourceCache,
    cacheKey,
    source,
    maxLayeredFinishSourceCacheEntries
  );
  return source;
}

function getOrCreateLayeredMaterialMapSources(params: {
  materialMapImages: LayeredMaterialMapImages;
  width: number;
  height: number;
  sourceSignature: string;
}) {
  const { materialMapImages, width, height, sourceSignature } = params;
  const cacheKey = getLayeredAssetCacheKey(width, height, sourceSignature);
  const cachedSources = layeredMaterialMapSourceCache.get(cacheKey);
  if (cachedSources) return cachedSources;

  const sources = createLayeredMaterialMapSources(materialMapImages, width, height);
  setCachedLayeredEntry(
    layeredMaterialMapSourceCache,
    cacheKey,
    sources,
    maxLayeredMaterialMapSourceCacheEntries
  );
  return sources;
}

function createMapBrightnessValues(mapData?: ImageData) {
  if (!mapData) return undefined;

  const pixelCount = mapData.width * mapData.height;
  const values = new Uint8ClampedArray(pixelCount);
  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    const index = pixelIndex * 4;
    const alpha = mapData.data[index + 3] / 255;
    const brightness =
      (mapData.data[index] * 0.2126 +
        mapData.data[index + 1] * 0.7152 +
        mapData.data[index + 2] * 0.0722) /
      255;
    values[pixelIndex] = encodeUnitMapValue(brightness * alpha);
  }

  return values;
}

function createMapBrightnessStats(
  values: Uint8ClampedArray | undefined,
  calibrationMask: LayeredMaterialCalibrationMask | undefined
): MapBrightnessStats | undefined {
  if (!values || !calibrationMask?.coveredPixelCount) return undefined;

  const maxSamples = 60000;
  const sampleStride = Math.max(1, Math.floor(calibrationMask.coveredPixelCount / maxSamples));
  const samples: number[] = [];
  let coveredSeen = 0;

  for (let pixelIndex = 0; pixelIndex < values.length; pixelIndex += 1) {
    if (!calibrationMask.values[pixelIndex]) continue;
    if (coveredSeen % sampleStride === 0) {
      samples.push(values[pixelIndex] / 255);
    }
    coveredSeen += 1;
  }

  if (!samples.length) return undefined;

  samples.sort((left, right) => left - right);
  const percentile = (ratio: number) => samples[Math.floor((samples.length - 1) * ratio)];

  return {
    p05: percentile(0.05),
    p10: percentile(0.1),
    p50: percentile(0.5),
    p90: percentile(0.9),
    p95: percentile(0.95)
  };
}

function createMatteMapCalibration(params: {
  shadowValues?: Uint8ClampedArray;
  highlightValues?: Uint8ClampedArray;
  textureValues?: Uint8ClampedArray;
  specularValues?: Uint8ClampedArray;
  calibrationMask?: LayeredMaterialCalibrationMask;
}): MatteMapCalibration | undefined {
  const { shadowValues, highlightValues, textureValues, specularValues, calibrationMask } = params;
  if (!calibrationMask?.coveredPixelCount) return undefined;

  const shadowStats = createMapBrightnessStats(shadowValues, calibrationMask);
  const highlightStats = createMapBrightnessStats(highlightValues, calibrationMask);
  const textureStats = createMapBrightnessStats(textureValues, calibrationMask);
  const specularStats = createMapBrightnessStats(specularValues, calibrationMask);

  return {
    shadowLitnessLift: shadowStats
      ? clamp((0.62 - shadowStats.p10) * 1.2, 0, 0.18)
      : 0,
    highlightInputLow: highlightStats?.p10 ?? 0.12,
    highlightInputHigh: Math.max((highlightStats?.p90 ?? 0.72), (highlightStats?.p10 ?? 0.12) + 0.08),
    highlightStrength: highlightStats
      ? clamp((0.72 - highlightStats.p90) / 0.28, 0, 1)
      : 0,
    textureCenter: textureStats?.p50 ?? 0.5,
    textureScale: textureStats
      ? clamp(0.08 / Math.max(0.025, textureStats.p95 - textureStats.p05), 1, 2.8)
      : 1,
    specularLift: specularStats
      ? clamp((0.62 - specularStats.p90) * 0.5, 0, 0.12)
      : 0
  };
}

function remapUnitValue(
  value: number,
  inputLow: number,
  inputHigh: number,
  outputLow: number,
  outputHigh: number
) {
  if (inputHigh <= inputLow) return value;
  const normalized = clamp((value - inputLow) / (inputHigh - inputLow), 0, 1);
  return outputLow + normalized * (outputHigh - outputLow);
}

function applyMatteMapCalibration(
  value: number,
  mapKey: "shadow" | "highlight" | "texture" | "specular" | "edgeAo",
  calibration?: MatteMapCalibration
) {
  if (!calibration) return value;

  if (mapKey === "shadow") {
    return clamp(value + (1 - value) * calibration.shadowLitnessLift, 0, 1);
  }

  if (mapKey === "highlight") {
    const normalizedHighlight = remapUnitValue(
      value,
      calibration.highlightInputLow,
      calibration.highlightInputHigh,
      0.1,
      0.82
    );
    return clamp(value + (normalizedHighlight - value) * calibration.highlightStrength, 0, 1);
  }

  if (mapKey === "texture") {
    return clamp(0.5 + (value - calibration.textureCenter) * calibration.textureScale, 0.38, 0.62);
  }

  if (mapKey === "specular") {
    return clamp(value + (1 - value) * calibration.specularLift, 0, 1);
  }

  return value;
}

function getMapBrightnessValue(
  values: Uint8ClampedArray | undefined,
  pixelIndex: number,
  fallback: number
) {
  return values ? values[pixelIndex] / 255 : fallback;
}

function getCalibratedMapBrightnessValue(
  values: Uint8ClampedArray | undefined,
  pixelIndex: number,
  fallback: number,
  mapKey: "shadow" | "highlight" | "texture" | "specular" | "edgeAo",
  calibration?: MatteMapCalibration
) {
  const value = getMapBrightnessValue(values, pixelIndex, fallback);
  return applyMatteMapCalibration(value, mapKey, calibration);
}

function getMapBrightnessValueAt(
  values: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number
) {
  const sampleX = Math.round(clamp(x, 0, width - 1));
  const sampleY = Math.round(clamp(y, 0, height - 1));
  return values[sampleY * width + sampleX] / 255;
}

function getCalibratedMapBrightnessValueAt(
  values: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  mapKey: "shadow" | "highlight" | "texture" | "specular" | "edgeAo",
  calibration?: MatteMapCalibration
) {
  const value = getMapBrightnessValueAt(values, width, height, x, y);
  return applyMatteMapCalibration(value, mapKey, calibration);
}

function createLayeredMaterialMaps(params: {
  finish: ProductFinishOption;
  finishData: ImageData;
  profile: LayeredMaterialProfile;
  materialMaps?: LayeredMaterialMapSources;
  calibrationMask?: LayeredMaterialCalibrationMask;
}): LayeredMaterialMaps {
  const { finish, finishData, profile, materialMaps, calibrationMask } = params;
  const { width, height } = finishData;
  const pixelCount = width * height;
  const shadowMap = new Uint8ClampedArray(pixelCount);
  const highlightMap = new Uint8ClampedArray(pixelCount);
  const textureMap = new Uint8ClampedArray(pixelCount);
  const specularMap = new Uint8ClampedArray(pixelCount);
  const sampleRadius = finish === "glossy" ? 3 : 2;
  const usesManualMaps = hasLayeredMaterialMapSources(materialMaps);
  const manualShadowValues = usesManualMaps ? createMapBrightnessValues(materialMaps?.shadow) : undefined;
  const manualHighlightValues = usesManualMaps
    ? createMapBrightnessValues(materialMaps?.highlight)
    : undefined;
  const manualTextureValues = usesManualMaps ? createMapBrightnessValues(materialMaps?.texture) : undefined;
  const manualSpecularValues = usesManualMaps
    ? createMapBrightnessValues(materialMaps?.specular)
    : undefined;
  const manualEdgeAoValues = usesManualMaps ? createMapBrightnessValues(materialMaps?.edgeAo) : undefined;
  const isMatteFinish = finish === "matte";
  const matteMapCalibration =
    isMatteFinish && usesManualMaps
      ? createMatteMapCalibration({
          shadowValues: manualShadowValues,
          highlightValues: manualHighlightValues,
          textureValues: manualTextureValues,
          specularValues: manualSpecularValues,
          calibrationMask
        })
      : undefined;

  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    const index = pixelIndex * 4;
    const sourceBrightness =
      (finishData.data[index] * 0.2126 +
        finishData.data[index + 1] * 0.7152 +
        finishData.data[index + 2] * 0.0722) /
      255;
    const pixelX = pixelIndex % width;
    const pixelY = Math.floor(pixelIndex / width);
    const neighborAverage =
      (sourceBrightness * 2 +
        getPixelBrightness(finishData.data, width, height, pixelX - sampleRadius, pixelY) +
        getPixelBrightness(finishData.data, width, height, pixelX + sampleRadius, pixelY) +
        getPixelBrightness(finishData.data, width, height, pixelX, pixelY - sampleRadius) +
        getPixelBrightness(finishData.data, width, height, pixelX, pixelY + sampleRadius)) /
      6;
    const tonalBrightness = clamp(
      profile.tonalAnchor + (sourceBrightness - profile.tonalAnchor) * profile.tonalContrast,
      0,
      1
    );
    let shadow = 1 - smoothstep(profile.shadowStart, profile.shadowEnd, tonalBrightness);
    let highlight = smoothstep(profile.highlightStart, profile.highlightEnd, sourceBrightness);
    let microDetail = clamp(
      (sourceBrightness - neighborAverage) * profile.microDetailStrength,
      -profile.microDetailClamp,
      profile.microDetailClamp
    );
    let shade = clamp(
      profile.shadeBase +
        Math.pow(tonalBrightness, profile.shadeGamma) * profile.shadeRange -
        shadow * profile.shadowStrength,
      profile.minShade,
      profile.maxShade
    );
    let specular =
      Math.pow(highlight, profile.highlightPower) *
      profile.highlightStrength *
      (1 - shadow * 0.58);

    if (usesManualMaps) {
      const isWhiteProfile = profile.minShade >= 0.55;
      const manualShadowBrightness = getCalibratedMapBrightnessValue(
        manualShadowValues,
        pixelIndex,
        0,
        "shadow",
        matteMapCalibration
      );
      const manualShadow = manualShadowValues
        ? isMatteFinish
          ? smoothstep(0.12, 0.86, 1 - manualShadowBrightness)
          : smoothstep(0.06, 0.84, manualShadowBrightness)
        : shadow;
      const manualEdgeAo = manualEdgeAoValues
        ? smoothstep(
            isMatteFinish ? 0.18 : 0.12,
            isMatteFinish ? 0.82 : 0.72,
            getCalibratedMapBrightnessValue(
              manualEdgeAoValues,
              pixelIndex,
              0,
              "edgeAo",
              matteMapCalibration
            )
          )
        : 0;
      const manualHighlight = manualHighlightValues
        ? smoothstep(
            isMatteFinish ? 0.2 : 0.55,
            isMatteFinish ? 0.88 : 0.98,
            getCalibratedMapBrightnessValue(
              manualHighlightValues,
              pixelIndex,
              0,
              "highlight",
              matteMapCalibration
            )
          )
        : highlight;

      if (manualTextureValues) {
        const textureBrightness = getCalibratedMapBrightnessValue(
          manualTextureValues,
          pixelIndex,
          0.5,
          "texture",
          matteMapCalibration
        );
        const textureAverage =
          (textureBrightness * 2 +
            getCalibratedMapBrightnessValueAt(
              manualTextureValues,
              width,
              height,
              pixelX - sampleRadius,
              pixelY,
              "texture",
              matteMapCalibration
            ) +
            getCalibratedMapBrightnessValueAt(
              manualTextureValues,
              width,
              height,
              pixelX + sampleRadius,
              pixelY,
              "texture",
              matteMapCalibration
            ) +
            getCalibratedMapBrightnessValueAt(
              manualTextureValues,
              width,
              height,
              pixelX,
              pixelY - sampleRadius,
              "texture",
              matteMapCalibration
            ) +
            getCalibratedMapBrightnessValueAt(
              manualTextureValues,
              width,
              height,
              pixelX,
              pixelY + sampleRadius,
              "texture",
              matteMapCalibration
            )) /
          6;
        microDetail = clamp(
          (textureBrightness - textureAverage) *
            profile.microDetailStrength *
            (isMatteFinish ? 1.12 : 1.4),
          -profile.microDetailClamp,
          profile.microDetailClamp
        );
      }

      const shadeCeiling = isWhiteProfile
        ? Math.min(profile.maxShade, isMatteFinish ? 1 : 1.04)
        : isMatteFinish
          ? Math.min(profile.maxShade, 1.08)
          : profile.maxShade;
      const shadowImpact = isWhiteProfile
        ? isMatteFinish
          ? 0.25
          : 0.32
        : finish === "glossy"
          ? 0.56
          : isMatteFinish
            ? 0.44
            : 0.48;
      const edgeImpact = isWhiteProfile
        ? isMatteFinish
          ? 0.16
          : 0.12
        : isMatteFinish
          ? 0.26
          : 0.18;
      const highlightLift = isWhiteProfile
        ? isMatteFinish
          ? 0.035
          : 0.08
        : isMatteFinish
          ? 0.085
          : 0.05;
      shade = clamp(
        shadeCeiling -
          manualShadow * shadowImpact -
          manualEdgeAo * edgeImpact +
          manualHighlight * highlightLift,
        profile.minShade,
        profile.maxShade
      );

      if (manualSpecularValues) {
        const manualSpecular = smoothstep(
          0.08,
          0.96,
          getCalibratedMapBrightnessValue(
            manualSpecularValues,
            pixelIndex,
            0,
            "specular",
            matteMapCalibration
          )
        );
        specular =
          Math.pow(manualSpecular, isMatteFinish ? 1.35 : 1.12) *
          profile.highlightStrength *
          (finish === "glossy" ? 1.85 : isMatteFinish ? 0.95 : 1.25);
      }

      specular = clamp(
        specular +
          manualHighlight *
            profile.highlightStrength *
            (isWhiteProfile ? (isMatteFinish ? 0.2 : 0.32) : isMatteFinish ? 0.18 : 0.24),
        0,
        isWhiteProfile ? (isMatteFinish ? 0.12 : 0.26) : isMatteFinish ? 0.14 : 0.34
      );
      shadow = manualShadow;
      highlight = manualHighlight;
    }

    shadowMap[pixelIndex] = encodeShadeMapValue(shade, profile);
    highlightMap[pixelIndex] = encodeUnitMapValue(highlight);
    textureMap[pixelIndex] = encodeSignedMapValue(microDetail, profile.microDetailClamp);
    specularMap[pixelIndex] = encodeUnitMapValue(specular);
  }

  return {
    width,
    height,
    shadowMap,
    highlightMap,
    textureMap,
    specularMap
  };
}

function getMatteSoftLightResponse(params: {
  detailShade: number;
  highlightedPixel: number;
  microDetail: number;
  specularAmount: number;
  darkTintVisibility: number;
  profile: LayeredMaterialProfile;
}): MatteSoftLightResponse {
  const { detailShade, highlightedPixel, microDetail, specularAmount, darkTintVisibility, profile } = params;
  const softLightAmount = smoothstep(0.08, 0.92, highlightedPixel);
  const matteVisibility = 0.28 + darkTintVisibility * 0.72;
  const softLightBloom = softLightAmount * (0.029 + darkTintVisibility * 0.032);
  const softLightCompression =
    softLightAmount * clamp(Math.abs(microDetail) * 1.45 + specularAmount * 0.07, 0, 0.024);
  const softLightDetailRebound = microDetail * softLightAmount * 0.2;
  const matteShade = clamp(
    detailShade + softLightBloom - softLightCompression + softLightDetailRebound,
    profile.minShade,
    profile.maxShade
  );
  const sheenDetailDampening = clamp(softLightAmount * 0.08 + Math.abs(microDetail) * 1.3, 0, 0.15);
  const sheenLift =
    specularAmount * (0.38 + softLightAmount * 0.12) * (1 - sheenDetailDampening);
  const formVisibilityLift =
    matteVisibility * (0.008 + smoothstep(profile.minShade, profile.maxShade, matteShade) * 0.024);
  const textureVisibilityLift =
    matteVisibility *
    clamp(Math.abs(microDetail) * 1.55 + softLightAmount * 0.018 + specularAmount * 0.05, 0, 0.028);
  const reflectanceLift =
    matteVisibility * (softLightAmount * 0.028 + specularAmount * 0.09) +
    darkTintVisibility * Math.max(microDetail, 0) * 0.28;

  return {
    softLightAmount,
    matteShade,
    sheenLift,
    formVisibilityLift,
    textureVisibilityLift,
    reflectanceLift
  };
}

function composeLayeredMaterialColor(params: {
  finish: ProductFinishOption;
  albedoLinear: LinearRgb;
  maps: LayeredMaterialMaps;
  profile: LayeredMaterialProfile;
  pixelIndex: number;
}): LinearRgb {
  const { finish, albedoLinear, maps, profile, pixelIndex } = params;
  const shade = decodeShadeMapValue(maps.shadowMap[pixelIndex], profile);
  const microDetail = decodeSignedMapValue(
    maps.textureMap[pixelIndex],
    profile.microDetailClamp
  );
  const detailShade = clamp(shade + microDetail, profile.minShade, profile.maxShade);
  const highlightedPixel = maps.highlightMap[pixelIndex] / 255;
  const specularAmount = (maps.specularMap[pixelIndex] / 255) * (0.92 + highlightedPixel * 0.08);
  const shadedAlbedo = {
    r: clamp(albedoLinear.r * detailShade, 0, 1),
    g: clamp(albedoLinear.g * detailShade, 0, 1),
    b: clamp(albedoLinear.b * detailShade, 0, 1)
  };

  if (finish === "matte") {
    const albedoLuminance = getRelativeLuminanceLinear(albedoLinear);
    const darkTintVisibility = 1 - smoothstep(0.025, 0.16, albedoLuminance);
    const softLightResponse = getMatteSoftLightResponse({
      detailShade,
      highlightedPixel,
      microDetail,
      specularAmount,
      darkTintVisibility,
      profile
    });
    const matteAlbedo = {
      r: clamp(albedoLinear.r * softLightResponse.matteShade, 0, 1),
      g: clamp(albedoLinear.g * softLightResponse.matteShade, 0, 1),
      b: clamp(albedoLinear.b * softLightResponse.matteShade, 0, 1)
    };
    const matteReflectanceColor = mixLinearColor(albedoLinear, { r: 0.22, g: 0.22, b: 0.22 }, 0.4);
    const totalReflectanceLift =
      softLightResponse.reflectanceLift +
      softLightResponse.formVisibilityLift +
      softLightResponse.textureVisibilityLift;
    const darkFormSignal = smoothstep(
      profile.minShade,
      profile.maxShade,
      softLightResponse.matteShade
    );
    const darkVisibilityColor = mixLinearColor(
      albedoLinear,
      { r: 0.34, g: 0.34, b: 0.34 },
      0.62
    );
    const darkVisibilityLift =
      darkTintVisibility *
      (0.018 +
        softLightResponse.softLightAmount * 0.075 +
        specularAmount * 0.18 +
        darkFormSignal * 0.03);
    const darkDetailContrast =
      darkTintVisibility *
      clamp(microDetail * 0.55 + Math.abs(microDetail) * 0.08, -0.016, 0.032);

    return {
      r: clamp(
        matteAlbedo.r +
          matteReflectanceColor.r * totalReflectanceLift +
          (1 - matteAlbedo.r) * softLightResponse.sheenLift +
          darkVisibilityColor.r * darkVisibilityLift +
          darkDetailContrast,
        0,
        1
      ),
      g: clamp(
        matteAlbedo.g +
          matteReflectanceColor.g * totalReflectanceLift +
          (1 - matteAlbedo.g) * softLightResponse.sheenLift +
          darkVisibilityColor.g * darkVisibilityLift +
          darkDetailContrast,
        0,
        1
      ),
      b: clamp(
        matteAlbedo.b +
          matteReflectanceColor.b * totalReflectanceLift +
          (1 - matteAlbedo.b) * softLightResponse.sheenLift +
          darkVisibilityColor.b * darkVisibilityLift +
          darkDetailContrast,
        0,
        1
      )
    };
  }

  return mixLinearColor(shadedAlbedo, { r: 1, g: 1, b: 1 }, specularAmount);
}

function getRedReferenceMaskAlpha(maskData: Uint8ClampedArray, index: number) {
  const r = maskData[index];
  const g = maskData[index + 1];
  const b = maskData[index + 2];
  const a = maskData[index + 3] / 255;
  const redDominance = r - Math.max(g, b);

  if (r <= 150 || redDominance <= 40) return 0;

  const redStrength = clamp((r - 150) / 65, 0, 1);
  const dominanceStrength = clamp((redDominance - 40) / 110, 0, 1);
  return Math.min(redStrength, dominanceStrength) * a;
}

function getInstructionColorMaskAlpha(
  maskData: Uint8ClampedArray,
  index: number,
  targetColor: Rgb
) {
  const r = maskData[index];
  const g = maskData[index + 1];
  const b = maskData[index + 2];
  const a = maskData[index + 3] / 255;
  const distance = Math.hypot(r - targetColor.r, g - targetColor.g, b - targetColor.b);
  const similarity = 1 - clamp((distance - 26) / 112, 0, 1);
  const saturation = (Math.max(r, g, b) - Math.min(r, g, b)) / 255;

  if (similarity <= 0 || saturation < 0.08) return 0;

  return smoothstep(0.24, 0.82, similarity) * smoothstep(0.08, 0.24, saturation) * a;
}

function createLayeredPartCanvas(params: {
  width: number;
  height: number;
  finish: ProductFinishOption;
  finishSource: LayeredFinishSource;
  materialMaps: LayeredMaterialMaps;
  profile: LayeredMaterialProfile;
  maskImage: HTMLImageElement;
  maskTargetColor?: Rgb;
  tint: Rgb;
  colorOpacity: number;
  highlightProtection: number;
  textureStrength: number;
  saturationBoost: number;
}) {
  const {
    width,
    height,
    finish,
    finishSource,
    materialMaps,
    profile,
    maskImage,
    maskTargetColor,
    tint,
    colorOpacity,
    highlightProtection,
    textureStrength,
    saturationBoost
  } = params;
  const maskCanvas = document.createElement("canvas");
  maskCanvas.width = width;
  maskCanvas.height = height;
  const maskContext = getCanvasContext(maskCanvas);
  maskContext.drawImage(maskImage, 0, 0, width, height);

  const finishData = finishSource.imageData;
  const maskData = maskContext.getImageData(0, 0, width, height);
  const outputCanvas = document.createElement("canvas");
  outputCanvas.width = width;
  outputCanvas.height = height;
  const outputContext = getCanvasContext(outputCanvas);
  const outputData = outputContext.createImageData(width, height);
  const isChromeFinish = finish === "chrome";
  const tintLinear = {
    r: srgbChannelToLinear(tint.r),
    g: srgbChannelToLinear(tint.g),
    b: srgbChannelToLinear(tint.b)
  };
  const isWhiteTint = isNearWhiteTint(tint);
  const boostedTintLinear = boostLinearTintSaturation(tintLinear, saturationBoost);
  const tintLuminance = getRelativeLuminanceLinear(boostedTintLinear);
  const neutralAlbedo = {
    r: tintLuminance,
    g: tintLuminance,
    b: tintLuminance
  };
  const albedoLinear = isWhiteTint
    ? getWhiteAlbedoLinear(tint)
    : mixLinearColor(neutralAlbedo, boostedTintLinear, colorOpacity);

  for (let index = 0; index < outputData.data.length; index += 4) {
    const maskAlpha = maskTargetColor
      ? getInstructionColorMaskAlpha(maskData.data, index, maskTargetColor)
      : getRedReferenceMaskAlpha(maskData.data, index);
    if (maskAlpha <= 0) continue;

    const sourceAlpha = finishData.data[index + 3] / 255;
    if (sourceAlpha <= 0) continue;

    const sourceR = finishData.data[index];
    const sourceG = finishData.data[index + 1];
    const sourceB = finishData.data[index + 2];
    const sourceBrightness = (sourceR * 0.2126 + sourceG * 0.7152 + sourceB * 0.0722) / 255;
    const pixelIndex = index / 4;

    if (isChromeFinish) {
      const sourceLinear = {
        r: srgbChannelToLinear(sourceR),
        g: srgbChannelToLinear(sourceG),
        b: srgbChannelToLinear(sourceB)
      };
      const chromeContrast = 1 + textureStrength * 1.65;
      const coolMetal = {
        r: clamp(0.62 + (sourceLinear.r - 0.62) * chromeContrast, 0.02, 1),
        g: clamp(0.64 + (sourceLinear.g - 0.64) * chromeContrast, 0.02, 1),
        b: clamp(0.68 + (sourceLinear.b - 0.68) * chromeContrast, 0.02, 1)
      };
      const tintAmount = 0;
      const tintedChrome = mixLinearColor(coolMetal, boostedTintLinear, tintAmount);
      const chromeHighlight =
        (materialMaps.highlightMap[pixelIndex] / 255) * highlightProtection * 0.18;
      const finalChrome = mixLinearColor(tintedChrome, { r: 1, g: 1, b: 1 }, chromeHighlight);

      outputData.data[index] = linearChannelToSrgb(finalChrome.r);
      outputData.data[index + 1] = linearChannelToSrgb(finalChrome.g);
      outputData.data[index + 2] = linearChannelToSrgb(finalChrome.b);
      outputData.data[index + 3] = Math.round(maskAlpha * sourceAlpha * 255);
      continue;
    }

    const finalColor = composeLayeredMaterialColor({
      finish,
      albedoLinear,
      maps: materialMaps,
      profile,
      pixelIndex
    });

    outputData.data[index] = linearChannelToSrgb(finalColor.r);
    outputData.data[index + 1] = linearChannelToSrgb(finalColor.g);
    outputData.data[index + 2] = linearChannelToSrgb(finalColor.b);
    outputData.data[index + 3] = Math.round(maskAlpha * sourceAlpha * 255);
  }

  outputContext.putImageData(outputData, 0, 0);
  return outputCanvas;
}

function createLayeredMaterialCalibrationMask(params: {
  maskImages: Record<string, HTMLImageElement>;
  width: number;
  height: number;
  signature: string;
}): LayeredMaterialCalibrationMask | undefined {
  const { maskImages, width, height, signature } = params;
  const entries = Object.values(maskImages);
  if (!entries.length) return undefined;

  const values = new Uint8Array(width * height);
  const maskCanvas = document.createElement("canvas");
  maskCanvas.width = width;
  maskCanvas.height = height;
  const maskContext = getCanvasContext(maskCanvas);
  let coveredPixelCount = 0;

  for (const maskImage of entries) {
    maskContext.clearRect(0, 0, width, height);
    maskContext.drawImage(maskImage, 0, 0, width, height);
    const maskData = maskContext.getImageData(0, 0, width, height);

    for (let index = 0; index < maskData.data.length; index += 4) {
      const pixelIndex = index / 4;
      if (values[pixelIndex] || getRedReferenceMaskAlpha(maskData.data, index) <= 0.02) continue;
      values[pixelIndex] = 1;
      coveredPixelCount += 1;
    }
  }

  if (!coveredPixelCount) return undefined;

  return {
    width,
    height,
    values,
    coveredPixelCount,
    signature
  };
}

async function renderLayeredProductMockup(params: {
  template: TemplatePublicDto;
  selectedPartPantones: SelectedPartPantone[];
}) {
  const layeredRender = params.template.layeredRender;
  const finishBaseImages = layeredRender?.enabled
    ? layeredRender.finishBaseImages
    : ({ matte: params.template.baseImageUrl } satisfies Partial<Record<ProductFinishOption, string>>);
  const fallbackFinish = layeredRender?.enabled ? layeredRender.fallbackFinish : "matte";
  const finishEntries = Object.entries(finishBaseImages) as Array<
    [ProductFinishOption, string]
  >;
  const fallbackFinishUrl = finishBaseImages[fallbackFinish] || params.template.baseImageUrl;
  if (!fallbackFinishUrl) {
    throw new Error("LAYERED_RENDER_MISSING_FALLBACK: The fallback finish image is missing.");
  }

  const partMaskEntries = Object.entries(layeredRender?.partMasks || {});
  const materialMapEntries = Object.entries(layeredRender?.materialMaps || {}) as Array<
    [ProductFinishOption, Record<string, string>]
  >;
  const needsInstructionMaskFallback = params.selectedPartPantones.some(
    (selection) => !layeredRender?.partMasks?.[selection.partId]
  );
  const [finishPairs, maskPairs, materialMapPairs] = await Promise.all([
    Promise.all(
      finishEntries.map(async ([finish, assetUrl]) => [
        finish,
        await loadImage(toAbsoluteAssetUrl(assetUrl))
      ] as const)
    ),
    Promise.all(
      partMaskEntries.map(async ([partId, assetUrl]) => [
        partId,
        await loadImage(toAbsoluteAssetUrl(assetUrl))
      ] as const)
    ),
    Promise.all(
      materialMapEntries.map(async ([finish, mapSet]) => [
        finish,
        Object.fromEntries(
          await Promise.all(
            Object.entries(mapSet).map(async ([mapKey, assetUrl]) => [
              mapKey,
              await loadImage(toAbsoluteAssetUrl(assetUrl))
            ] as const)
          )
        ) as LayeredMaterialMapImages
      ] as const)
    )
  ]);

  const finishImages = Object.fromEntries(finishPairs) as LayeredRenderImages;
  const maskImages = Object.fromEntries(maskPairs) as Record<string, HTMLImageElement>;
  const materialMapImages = Object.fromEntries(
    materialMapPairs
  ) as LayeredMaterialMapImagesByFinish;
  const instructionMaskImage = needsInstructionMaskFallback
    ? await loadImage(toAbsoluteAssetUrl(params.template.instructionImageUrl))
    : null;
  const fallbackImage = finishImages[fallbackFinish];
  if (!fallbackImage) {
    throw new Error("LAYERED_RENDER_MISSING_FALLBACK: The fallback finish image could not be loaded.");
  }

  const width = layeredRender?.outputSize?.width || fallbackImage.naturalWidth || fallbackImage.width;
  const height = layeredRender?.outputSize?.height || fallbackImage.naturalHeight || fallbackImage.height;
  const finishSourceSignatures = Object.fromEntries(
    Object.entries(finishBaseImages).map(([finish, assetUrl]) => [finish, assetUrl])
  ) as Partial<Record<ProductFinishOption, string>>;
  const materialMapSignatures = Object.fromEntries(
    Object.entries(layeredRender?.materialMaps || {}).map(([finish, mapSet]) => [
      finish,
      Object.entries(mapSet)
        .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
        .map(([mapKey, assetUrl]) => `${mapKey}:${assetUrl}`)
        .join(";")
    ])
  ) as Partial<Record<ProductFinishOption, string>>;
  const calibrationMaskSignature = partMaskEntries
    .map(([partId, assetUrl]) => `${partId}:${assetUrl}`)
    .sort()
    .join(";");
  const finishSources = Object.fromEntries(
    Object.entries(finishImages).map(([finish, finishImage]) => [
      finish,
      getOrCreateLayeredFinishSource({
        finishImage,
        width,
        height,
        sourceSignature: finishSourceSignatures[finish as ProductFinishOption] || fallbackFinishUrl
      })
    ])
  ) as Partial<Record<ProductFinishOption, LayeredFinishSource>>;
  const fallbackSource = finishSources[fallbackFinish];
  if (!fallbackSource) {
    throw new Error("LAYERED_RENDER_MISSING_FALLBACK: The fallback finish source is missing.");
  }
  const materialMapSources = Object.fromEntries(
    Object.entries(materialMapImages).map(([finish, mapImages]) => [
      finish,
      getOrCreateLayeredMaterialMapSources({
        materialMapImages: mapImages,
        width,
        height,
        sourceSignature: materialMapSignatures[finish as ProductFinishOption] || finish
      })
    ])
  ) as LayeredMaterialMapSourcesByFinish;
  const calibrationMask = createLayeredMaterialCalibrationMask({
    maskImages,
    width,
    height,
    signature: calibrationMaskSignature || "no-part-masks"
  });

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = getCanvasContext(canvas);
  context.drawImage(fallbackImage, 0, 0, width, height);

  function getMaterialMapsFor(params: {
    finish: ProductFinishOption;
    finishSource: LayeredFinishSource;
    profile: LayeredMaterialProfile;
    isWhiteTint: boolean;
    highlightProtection: number;
    textureStrength: number;
    manualMapSources?: LayeredMaterialMapSources;
    sourceSignature: string;
    manualMapSignature?: string;
    calibrationMask?: LayeredMaterialCalibrationMask;
  }) {
    const {
      finish,
      finishSource,
      profile,
      isWhiteTint,
      highlightProtection,
      textureStrength,
      manualMapSources,
      sourceSignature,
      manualMapSignature,
      calibrationMask
    } = params;
    const cacheKey = [
      finish,
      width,
      height,
      sourceSignature,
      manualMapSignature || "no-manual-map",
      calibrationMask?.signature || "no-calibration-mask",
      hasLayeredMaterialMapSources(manualMapSources) ? "manual" : "auto",
      isWhiteTint ? "white" : "color",
      highlightProtection.toFixed(3),
      textureStrength.toFixed(3)
    ].join("|");
    const cachedMaps = layeredMaterialMapCache.get(cacheKey);
    if (cachedMaps) return cachedMaps;

    const maps = createLayeredMaterialMaps({
      finish,
      finishData: finishSource.imageData,
      profile,
      materialMaps: manualMapSources,
      calibrationMask
    });
    setCachedLayeredMaterialMaps(cacheKey, maps);
    return maps;
  }

  for (const selection of params.selectedPartPantones) {
    const explicitMaskImage = maskImages[selection.partId];
    const maskImage = explicitMaskImage || instructionMaskImage;
    if (!maskImage) continue;

    const maskTargetColor =
      explicitMaskImage || !selection.instructionColorHex
        ? undefined
        : hexToRgb(selection.instructionColorHex);
    if (!explicitMaskImage && !maskTargetColor) continue;

    const finish = selection.selectedFinish || fallbackFinish;
    const finishSource = finishSources[finish] || fallbackSource;
    const rule = layeredRender?.finishRules?.[finish] || defaultLayeredFinishRule;
    const tint = hexToRgb(selection.pantone.previewHex);
    const isWhiteTint = isNearWhiteTint(tint);
    const highlightProtection =
      rule.highlightProtection ?? defaultLayeredFinishRule.highlightProtection;
    const textureStrength = rule.textureStrength ?? defaultLayeredFinishRule.textureStrength;
    const profile = getLayeredMaterialProfile({
      finish,
      isWhiteTint,
      highlightProtection,
      textureStrength
    });
    const materialMaps = getMaterialMapsFor({
      finish,
      finishSource,
      profile,
      isWhiteTint,
      highlightProtection,
      textureStrength,
      manualMapSources: materialMapSources[finish],
      sourceSignature: finishBaseImages[finish] || fallbackFinishUrl,
      manualMapSignature: materialMapSignatures[finish],
      calibrationMask
    });
    const partCanvas = createLayeredPartCanvas({
      width,
      height,
      finish,
      finishSource,
      materialMaps,
      profile,
      maskImage,
      maskTargetColor,
      tint,
      colorOpacity: rule.colorOpacity,
      highlightProtection,
      textureStrength,
      saturationBoost: rule.saturationBoost ?? defaultLayeredFinishRule.saturationBoost
    });

    context.save();
    context.globalCompositeOperation = rule.blendMode;
    context.drawImage(partCanvas, 0, 0);
    context.restore();
  }

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
  const [expandedPartId, setExpandedPartId] = useState<string | null>(
    initialTemplate?.colorParts[0]?.id || null
  );
  const [partPantones, setPartPantones] = useState<Record<string, string>>({});
  const [partFinishes, setPartFinishes] = useState<Record<string, ProductFinishOption>>({});
  const deferredPartPantones = useDeferredValue(partPantones);
  const deferredPartFinishes = useDeferredValue(partFinishes);
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
  const [printingAreaPreviewRects, setPrintingAreaPreviewRects] = useState<PixelRect[]>([]);
  const [showPrintingAreaHint, setShowPrintingAreaHint] = useState(false);
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
  const printingAreaHintTimeoutRef = useRef<number | null>(null);
  const logoDragStateRef = useRef<LogoDragState | null>(null);
  const renderPanelRef = useRef<HTMLElement | null>(null);
  const formPanelRef = useRef<HTMLElement | null>(null);
  const renderPreviewShellRef = useRef<HTMLDivElement | null>(null);
  const formSectionRefs = useRef<Array<HTMLElement | null>>([]);
  const [activeFormSectionIndex, setActiveFormSectionIndex] = useState(0);
  const [selectedCategory, setSelectedCategory] = useState(
    normalizeProductCategory(initialTemplate?.category)
  );

  const showDebug =
    process.env.NODE_ENV === "development" ||
    process.env.NEXT_PUBLIC_SHOW_DEBUG === "true";

  function clearPreviewRetryTimeout() {
    if (previewRetryTimeoutRef.current !== null) {
      window.clearTimeout(previewRetryTimeoutRef.current);
      previewRetryTimeoutRef.current = null;
    }
  }

  function clearPrintingAreaHintTimeout() {
    if (printingAreaHintTimeoutRef.current !== null) {
      window.clearTimeout(printingAreaHintTimeoutRef.current);
      printingAreaHintTimeoutRef.current = null;
    }
  }

  function flashPrintingAreaHint() {
    if (!printingAreaPreviewRects.length) return;

    clearPrintingAreaHintTimeout();
    setShowPrintingAreaHint(true);
    printingAreaHintTimeoutRef.current = window.setTimeout(() => {
      setShowPrintingAreaHint(false);
      printingAreaHintTimeoutRef.current = null;
    }, 2000);
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
      setExpandedPartId(initialTemplate.colorParts[0]?.id || null);
      setFocusedPartId(initialTemplate.colorParts[0]?.id || null);
      setSelectedCategory(normalizeProductCategory(initialTemplate.category));
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
    setExpandedPartId(null);
    setFocusedPartId(null);
    setPartFinishes({});
  }, [productSlug]);

  function selectProductCategory(category: (typeof productCategoryOptions)[number]) {
    if (!categoryCounts.get(category)) return;

    setSelectedCategory(category);
    const nextTemplate = availableTemplates.find(
      (availableTemplate) => normalizeProductCategory(availableTemplate.category) === category
    );
    if (nextTemplate && normalizeProductCategory(template?.category) !== category) {
      router.push(`/mockup/${nextTemplate.slug}`);
    }
  }

  useEffect(() => {
    return () => {
      clearPreviewRetryTimeout();
      clearPrintingAreaHintTimeout();
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
    let isCancelled = false;

    setShowPrintingAreaHint(false);
    clearPrintingAreaHintTimeout();

    if (!template) {
      setPrintingAreaPreviewRects([]);
      return;
    }

    const printingAreaImageUrl = resolvePrintingAreaImageUrl(template, printingMethod);
    if (!printingAreaImageUrl) {
      setPrintingAreaPreviewRects([]);
      return;
    }

    loadImage(toAbsoluteAssetUrl(printingAreaImageUrl))
      .then((printingAreaImage) => {
        if (isCancelled) return;

        const imageWidth = printingAreaImage.naturalWidth || printingAreaImage.width;
        const imageHeight = printingAreaImage.naturalHeight || printingAreaImage.height;
        const detectedRects = detectRedPrintingAreaRects(
          printingAreaImage,
          imageWidth,
          imageHeight
        );
        setPrintingAreaPreviewRects(normalizePixelRects(detectedRects, imageWidth, imageHeight));
      })
      .catch(() => {
        if (!isCancelled) setPrintingAreaPreviewRects([]);
      });

    return () => {
      isCancelled = true;
    };
  }, [template, printingMethod]);

  useEffect(() => {
    if (!logoFile || !printingAreaPreviewRects.length) return;
    flashPrintingAreaHint();
  }, [logoFile, printingMethod, printingAreaPreviewRects.length]);

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

    if (!template) {
      return;
    }

    let selectedPartPantones: SelectedPartPantone[];
    try {
      selectedPartPantones = buildSelectedPartPantones(
        template,
        deferredPartPantones,
        deferredPartFinishes
      );
    } catch {
      return;
    }

    setCompositedPreviewUrl(null);
    setIsPreviewResolving(true);
    renderLayeredProductMockup({
      template,
      selectedPartPantones
    })
      .then((imageUrl) => {
        if (isCancelled) return;

        clearPreviewRetryTimeout();
        setPreviewImageUrl(imageUrl);
        setResult((current) =>
          current?.provider === "local-layered"
            ? {
                ...current,
                imageUrl
              }
            : current
        );
        setIsPreviewResolving(false);
        setSubmitError(null);
      })
      .catch((error) => {
        if (isCancelled) return;
        setIsPreviewResolving(false);
        setSubmitError(error instanceof Error ? error.message : "Layered preview failed.");
      });

    return () => {
      isCancelled = true;
    };
  }, [template, deferredPartPantones, deferredPartFinishes]);

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
    ? template.colorParts.every((part) => {
        const selectedFinish = resolveRenderablePartFinishSelection(
          template,
          part,
          partFinishes[part.id]
        );
        return isColorLockedFinish(selectedFinish) || Boolean(partPantones[part.id]);
      })
    : false;
  const primaryPrintMethodLabel = printingMethod
    ? getPrintingMethodPrompt(printingMethod).label
    : "Not selected";
  const filteredAvailableTemplates = useMemo(
    () =>
      availableTemplates.filter(
        (availableTemplate) => normalizeProductCategory(availableTemplate.category) === selectedCategory
      ),
    [availableTemplates, selectedCategory]
  );
  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const availableTemplate of availableTemplates) {
      const category = normalizeProductCategory(availableTemplate.category);
      counts.set(category, (counts.get(category) || 0) + 1);
    }
    return counts;
  }, [availableTemplates]);

  const isLayeredTemplate = Boolean(template);
  const canGenerate =
    Boolean(template) &&
    isLayeredTemplate &&
    hasAllPartPantones &&
    Boolean(logoPrintColor) &&
    Boolean(printingMethod) &&
    Boolean(logoFile) &&
    !isSubmitting;
  const canAdjustLogo = Boolean(
    (isLayeredTemplate ? previewImageUrl : result?.imageUrl) &&
      logoFile &&
      template
  );
  const logoMoveXPercent = Math.round(logoTransform.offsetX * 100);
  const logoMoveYPercent = Math.round(logoTransform.offsetY * 100);
  const logoScalePercent = Math.round(logoTransform.scale * 100);
  const logoRotationDegrees = Math.round(logoTransform.rotation);
  const activePartId =
    openPartId || expandedPartId || focusedPartId || template?.colorParts[0]?.id || null;
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
  const formStepDots = isLayeredTemplate
    ? [
        { kicker: "Step 1", label: "Colours" },
        { kicker: "Step 2", label: "Branding" },
        { kicker: "Logo", label: "Adjust" }
      ]
    : [
        { kicker: "Step 1", label: "Colours" },
        { kicker: "Step 2", label: "Branding" },
        { kicker: "Step 3", label: "Setup" },
        { kicker: "Step 4", label: "Adjust" }
      ];
  const logoAdjustSectionIndex = isLayeredTemplate ? 2 : 3;

  function updateLogoTransform(
    next: LogoTransform | ((current: LogoTransform) => LogoTransform),
    options?: { flashPrintingArea?: boolean }
  ) {
    if (options?.flashPrintingArea) {
      flashPrintingAreaHint();
    }

    setLogoTransform((current) =>
      normalizeLogoTransform(typeof next === "function" ? next(current) : next)
    );
  }

  function resetLogoTransform() {
    updateLogoTransform(createDefaultLogoTransform(), { flashPrintingArea: true });
  }

  function rotateLogoBy(deltaDegrees: number) {
    updateLogoTransform(
      (current) => ({
        ...current,
        rotation: current.rotation + deltaDegrees
      }),
      { flashPrintingArea: true }
    );
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

  function selectExpandedPart(partId: string) {
    setFocusedPartId(partId);
    setExpandedPartId(partId);
    setOpenPartId((current) => (current === partId ? current : null));
  }

  function handleLogoPointerDown(event: React.PointerEvent<HTMLImageElement>) {
    if (!canAdjustLogo) return;

    flashPrintingAreaHint();
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
    setGenerationStatus("Rendering local layered mockup...");
    setCompositedPreviewUrl(null);
    setLogoTransform(createDefaultLogoTransform());
    setIsLogoDragging(false);
    logoDragStateRef.current = null;

    try {
      const selectedPartPantones = buildSelectedPartPantones(template, partPantones, partFinishes);

      const imageUrl = await renderLayeredProductMockup({
        template,
        selectedPartPantones
      });

      setResult({
        success: true,
        imageUrl,
        provider: "local-layered",
        completed: true,
        state: "completed",
        debug: {
          provider: "local-layered",
          templateId: template.id,
          productSlug,
          selectedPartPantones: selectedPartPantones.map((selection) => ({
            partId: selection.partId,
            partLabel: selection.partLabel,
            pantoneCode: selection.pantoneCode,
            selectedFinish: selection.selectedFinish
          })),
          baseProductImagePath: template.baseImageUrl,
          instructionImagePath: template.instructionImageUrl,
          logoFileName: logoFile.name,
          promptUsed: "Local layered renderer"
        }
      });
      setGenerationStatus(null);
    } catch (error) {
      setGenerationStatus(null);
      setSubmitError(error instanceof Error ? error.message : "Local render failed.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="mockup-page">
      <header className="page-header">
        <div className="site-bar">
          <Link href="/" className="brand-lockup brand-home-link" aria-label="Back to homepage">
            <ChiliLogo className="brand-logo" />
            <span className="brand-title-stack">
              <span className="brand-product-title">Chili Product Mockup Generator</span>
              <span className="brand-product-subtitle">Interactive product preview</span>
            </span>
          </Link>
          <div className="site-bar-actions">
            {availableTemplates.length > 0 ? (
              <div className="nav-product-controls">
                <nav className="category-filter-bar" aria-label="Product categories">
                  {productCategoryOptions.map((category) => {
                    const isActive = selectedCategory === category;
                    const productCount = categoryCounts.get(category) || 0;

                    return (
                      <button
                        key={category}
                        type="button"
                        className={`category-filter-button${isActive ? " is-active" : ""}`}
                        disabled={!productCount}
                        onClick={() => selectProductCategory(category)}
                      >
                        {category}
                      </button>
                    );
                  })}
                </nav>
                <label className="product-switcher">
                  <span className="product-switcher-label">Product</span>
                  <select
                    className="product-switcher-select"
                    value={productSlug}
                    onChange={(event) => router.push(`/mockup/${event.target.value}`)}
                  >
                    {filteredAvailableTemplates.map((availableTemplate) => (
                      <option key={availableTemplate.slug} value={availableTemplate.slug}>
                        {availableTemplate.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            ) : null}
            <Link href="/setup" className="secondary-link-button">
              Setup studio
            </Link>
            <span className="mode-pill">Local layered studio</span>
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

                    {printingAreaPreviewRects.length ? (
                      <div
                        className={`printing-area-hint-layer${
                          showPrintingAreaHint ? " is-visible" : ""
                        }`}
                        aria-hidden="true"
                      >
                        {printingAreaPreviewRects.map((rect, rectIndex) => (
                          <div
                            key={`printing-area-hint-${rectIndex}`}
                            className="printing-area-hint-box"
                            style={{
                              left: `${rect.x * 100}%`,
                              top: `${rect.y * 100}%`,
                              width: `${rect.width * 100}%`,
                              height: `${rect.height * 100}%`
                            }}
                          />
                        ))}
                      </div>
                    ) : null}

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
                            does not rebuild the color layer.
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
                              }), { flashPrintingArea: true });
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
                              }), { flashPrintingArea: true });
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
                            max="100"
                            step="1"
                            value={logoScalePercent}
                            disabled={!canAdjustLogo}
                            onChange={(event) => {
                              const value = Number(event.currentTarget.value) / 100;
                              updateLogoTransform((current) => ({
                                ...current,
                                scale: value
                              }), { flashPrintingArea: true });
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
                  <h2 className="section-title">
                    {isLayeredTemplate ? "Configure live mockup" : "Local renderer setup needed"}
                  </h2>
                  <p className="panel-description">
                    {isLayeredTemplate
                      ? "Adjust colours, material finish, and logo treatment while the preview updates on the canvas."
                      : "This product needs material base images and part references before it can use the local layered renderer."}
                  </p>
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
                      const renderableFinishes = getRenderablePartFinishes(template, part);
                      const selectedFinish = resolveRenderablePartFinishSelection(
                        template,
                        part,
                        partFinishes[part.id]
                      );
                      const isSelectedFinishColorLocked = isColorLockedFinish(selectedFinish);
                      const partNumber = getPartNumberText(part.label, Math.max(partIndex, 0));
                      const isFocusedPart = activePartId === part.id;
                      const isMutedPart = Boolean(activePartId) && !isFocusedPart;
                      const isExpandedPart = expandedPartId === part.id;

                      return (
                        <div
                          key={part.id}
                          className={`part-selection-card${isFocusedPart ? " is-focused" : ""}${isMutedPart ? " is-muted" : ""}${isExpandedPart ? " is-expanded" : " is-collapsed"}`}
                          onClick={() => selectExpandedPart(part.id)}
                          onPointerEnter={() => setFocusedPartId(part.id)}
                          onFocusCapture={() => setFocusedPartId(part.id)}
                        >
                          <div className="part-selection-head">
                            <button
                              type="button"
                              className="part-collapse-trigger"
                              aria-expanded={isExpandedPart}
                              onClick={(event) => {
                                event.stopPropagation();
                                selectExpandedPart(part.id);
                              }}
                            >
                              <div className="part-selection-title-row">
                                <span className="part-index-badge" aria-hidden="true">
                                  {partNumber}
                                </span>
                                <span className="part-title-stack">
                                  <span className="control-label">
                                    {part.label} {isSelectedFinishColorLocked ? "Material reference" : "Pantone color"}
                                  </span>
                                  <span className="fine-print part-collapse-description">
                                    {part.description}
                                  </span>
                                </span>
                              </div>
                            </button>
                            <button
                              id={`part-${part.id}`}
                              type="button"
                              className="pantone-trigger"
                              aria-label={`${part.label} Pantone color`}
                              aria-expanded={openPartId === part.id}
                              disabled={isSelectedFinishColorLocked}
                              onClick={() => {
                                if (isSelectedFinishColorLocked) return;
                                setFocusedPartId(part.id);
                                setExpandedPartId(part.id);
                                setOpenPartId((current) => (current === part.id ? null : part.id));
                              }}
                            >
                              {isSelectedFinishColorLocked ? (
                                <span>{selectedFinish ? productFinishLabels[selectedFinish] : "Reference finish"}</span>
                              ) : selectedPantone ? (
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

                          <div className="part-selection-body">
                            <div className="part-selection-body-inner">
                              {isSelectedFinishColorLocked ? (
                                <p className="finish-locked-note">
                                  This finish keeps the reference material and does not use Pantone color.
                                </p>
                              ) : (
                                <div className="quick-color-row">
                                  {quickColorOptions.map((option) => (
                                    <button
                                      key={`${part.id}-${option.code}`}
                                      type="button"
                                      className={`quick-color-button${partPantones[part.id] === option.code ? " is-active" : ""}`}
                                      onClick={() => {
                                        selectExpandedPart(part.id);
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
                              )}

                              {selectedPantone && !isSelectedFinishColorLocked ? (
                                <div className="color-preview">
                                  <span
                                    className="color-swatch"
                                    style={{ backgroundColor: selectedPantone.previewHex }}
                                    aria-hidden="true"
                                  />
                                  <span>{selectedPantone.previewHex}</span>
                                </div>
                              ) : null}

                              {renderableFinishes.length ? (
                                <div className="part-finish-field">
                                  <span className="control-label">Material finish</span>
                                  <div
                                    className="quick-choice-row"
                                    aria-label={`${part.label} finish options`}
                                  >
                                    {renderableFinishes.map((finish) => (
                                      <button
                                        key={`${part.id}-${finish}`}
                                        type="button"
                                        className={`quick-choice-button${selectedFinish === finish ? " is-active" : ""}`}
                                        onClick={() => {
                                          selectExpandedPart(part.id);
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

                              {openPartId === part.id && !isSelectedFinishColorLocked ? (
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
                                        <span className="pantone-option-label">
                                          {option.label}
                                        </span>
                                        <span className="pantone-option-meta">
                                          {option.previewHex}
                                        </span>
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          </div>
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
                        if (file) flashPrintingAreaHint();
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

                {!isLayeredTemplate ? (
                  <section
                    className="form-section form-submit-section"
                    ref={(node) => {
                      formSectionRefs.current[2] = node;
                    }}
                  >
                    <div className="form-section-head">
                      <div>
                        <p className="panel-kicker">Step 3</p>
                        <h3 className="section-title">Enable local layered rendering</h3>
                      </div>
                      <p className="section-caption">
                        Upload material base images and part reference masks in Setup Studio.
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

                    <Link href="/setup" className="button-primary setup-required-link">
                      Open setup studio
                    </Link>
                  </section>
                ) : null}

                <section
                  className="form-section form-adjust-section"
                  ref={(node) => {
                    formSectionRefs.current[logoAdjustSectionIndex] = node;
                    if (isLayeredTemplate) {
                      formSectionRefs.current[3] = null;
                    }
                  }}
                >
                  <div className="form-section-head">
                    <div>
                      <p className="panel-kicker">{isLayeredTemplate ? "Logo" : "Step 4"}</p>
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
                            controls below. This does not rebuild the color layer.
                          </p>
                        </div>
                      </div>

                      <div className="logo-adjust-actions">
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
                              }), { flashPrintingArea: true });
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
                              }), { flashPrintingArea: true });
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
                            max="100"
                            step="1"
                            value={logoScalePercent}
                            disabled={!canAdjustLogo}
                            onChange={(event) => {
                              const value = Number(event.currentTarget.value) / 100;
                              updateLogoTransform((current) => ({
                                ...current,
                                scale: value
                              }), { flashPrintingArea: true });
                            }}
                          />
                          <output>{logoScalePercent}%</output>
                        </label>

                        <div className="logo-slider-row logo-rotation-readout">
                          <span>Rotate</span>
                          <div className="rotation-control-stack">
                            <div className="rotation-readout-track" aria-hidden="true" />
                            <div className="rotation-pill-group" aria-label="Rotate logo">
                              <button
                                className="rotation-pill-button"
                                type="button"
                                title="Rotate 90 degrees counterclockwise"
                                aria-label="Rotate 90 degrees counterclockwise"
                                onClick={() => rotateLogoBy(-logoQuarterTurnDegrees)}
                                disabled={!canAdjustLogo}
                              >
                                -90
                              </button>
                              <button
                                className="rotation-pill-button"
                                type="button"
                                title="Rotate 90 degrees clockwise"
                                aria-label="Rotate 90 degrees clockwise"
                                onClick={() => rotateLogoBy(logoQuarterTurnDegrees)}
                                disabled={!canAdjustLogo}
                              >
                                +90
                              </button>
                            </div>
                          </div>
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
