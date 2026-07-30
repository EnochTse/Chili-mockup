"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import ChiliLogo from "@/components/chili-logo";
import {
  createLocalUploadReference,
  getLocalUploadFormField
} from "@/lib/local-library/asset-reference";
import type {
  LocalLibrarySnapshot,
  OnlinePublishConfiguration,
  LocalProductCatalogView,
  LocalReleaseStatus
} from "@/lib/local-library/types";
import {
  defaultLayeredFinishRules,
  productFinishLabels,
  productFinishOptions,
  resolvePartDefaultFinish
} from "@/lib/services/finish-option.service";
import {
  getLocalLibraryClientSnapshot,
  getLocalLibraryTemplate,
  getLocalProductExportUrl,
  getOnlinePublishClientConfiguration,
  importLocalLibraryProduct,
  isLocalStudioBrowser,
  publishLocalLibraryProductOnline,
  rollbackLocalLibraryProduct,
  saveLocalLibraryRelease
} from "@/lib/services/local-library.client";
import {
  normalizeProductCategory,
  productCategoryOptions
} from "@/lib/services/product-category.service";
import { getPrintingMethodPrompt } from "@/lib/services/prompt.service";
import type {
  LayeredRenderConfig,
  LayeredRenderFinishRule,
  LayeredMaterialMapKey,
  LogoOrientationPreset,
  PartIndicatorAnchor,
  ProductColorPart,
  ProductFinishOption,
  ProductSpecification,
  TemplatePublicDto,
  TemplateSummaryDto
} from "@/lib/types";

type TemplateUploadedAssets = {
  baseImageUrl?: string;
  instructionImageUrl?: string;
  partMaskImageUrls: Record<string, string>;
  finishBaseImageUrls: Partial<Record<ProductFinishOption, string>>;
  materialMapImageUrls: Partial<
    Record<ProductFinishOption, Partial<Record<LayeredMaterialMapKey, string>>>
  >;
  printingAreaImageUrls: Record<string, string>;
};

type MaterialMapFileSet = Partial<Record<LayeredMaterialMapKey, File | null>>;

type EditorFormState = {
  originalSlug: string;
  slug: string;
  name: string;
  category: string;
  description: string;
  size: string;
  specifications: ProductSpecification[];
  colorParts: ProductColorPart[];
  baseImageUrl: string;
  instructionImageUrl: string;
  baseImageFile: File | null;
  instructionImageFile: File | null;
  layeredRenderEnabled: boolean;
  layeredFallbackFinish: ProductFinishOption;
  layeredOutputWidth: string;
  layeredOutputHeight: string;
  layeredFinishBaseImages: Partial<Record<ProductFinishOption, string>>;
  layeredMaterialMaps: NonNullable<LayeredRenderConfig["materialMaps"]>;
  layeredFinishRules: Partial<Record<ProductFinishOption, LayeredRenderFinishRule>>;
  logoOrientationPreset: LogoOrientationPreset;
  logoPrintingAreaImages: Record<string, string>;
};

const newTemplateKey = "__new__";
const defaultPrintingMethods = [
  "silk_screen",
  "uv_print",
  "heat_transfer",
  "embroidery",
  "laser_engraving",
  "mirror_laser_engraving"
];
const defaultLogoPrintColors = ["white", "black", "original", "pantone_match"];
const defaultTemplateConstraints = {
  preserveBackground: true,
  preserveLighting: true,
  preserveProductShape: true,
  preserveMaterialTexture: true,
  allowOnlyDefinedRecolorRegion: true,
  allowOnlyDefinedLogoRegion: true,
  noPeople: true,
  noExtraProps: true,
  noExtraBranding: true,
  noExtraTextExceptLogo: true
};
const advancedMaterialMapDefinitions: Array<{
  key: Exclude<LayeredMaterialMapKey, "base">;
  label: string;
  description: string;
}> = [
  {
    key: "shadow",
    label: "Form shadow",
    description: "Broad product form and curvature. Use grayscale PNG or WebP."
  },
  {
    key: "highlight",
    label: "Soft highlight",
    description: "Broad light response without baked product color."
  },
  {
    key: "texture",
    label: "Surface texture",
    description: "Fine, low-contrast grain or material detail."
  },
  {
    key: "specular",
    label: "Specular / sheen",
    description: "Controlled reflective response for this finish."
  },
  {
    key: "edgeAo",
    label: "Edge AO",
    description: "Tight seam and contact darkening only."
  }
];

function createDraftPart(index: number): ProductColorPart {
  return {
    id: `part-${index}-${Math.random().toString(36).slice(2, 8)}`,
    label: `Part ${index}`,
    description: `Color-controlled region ${index}.`,
    instructionCue: "",
    instructionColorHex: "",
    partMaskImageFileName: "",
    defaultPantoneCode: "Pantone Black C",
    indicatorAnchors: [createDraftIndicatorAnchor(index, 1)]
  };
}

function createDraftIndicatorAnchor(partIndex: number, anchorIndex: number): PartIndicatorAnchor {
  return {
    id: `part-${partIndex}-indicator-${anchorIndex}-${Math.random().toString(36).slice(2, 8)}`,
    targetXPercent: 50,
    targetYPercent: 50,
    labelOffsetXPercent: anchorIndex % 2 === 1 ? 18 : -18,
    labelOffsetYPercent: -12
  };
}

function makeBlankFormState(): EditorFormState {
  return {
    originalSlug: "",
    slug: "",
    name: "",
    category: "",
    description: "",
    size: "",
    specifications: [{ label: "", value: "" }],
    colorParts: [
      {
        ...createDraftPart(1),
        description: "Primary recolorable area shown in the instruction image.",
      }
    ],
    baseImageUrl: "",
    instructionImageUrl: "",
    baseImageFile: null,
    instructionImageFile: null,
    layeredRenderEnabled: false,
    layeredFallbackFinish: "matte",
    layeredOutputWidth: "",
    layeredOutputHeight: "",
    layeredFinishBaseImages: {},
    layeredMaterialMaps: {},
    layeredFinishRules: Object.fromEntries(
      productFinishOptions.map((finish) => [
        finish,
        { ...defaultLayeredFinishRules[finish] }
      ])
    ),
    logoOrientationPreset: "horizontal",
    logoPrintingAreaImages: {}
  };
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildFormStateFromTemplate(template: TemplatePublicDto): EditorFormState {
  return {
    originalSlug: template.slug,
    slug: template.slug,
    name: template.name,
    category: normalizeProductCategory(template.category),
    description: template.description,
    size: template.size || "",
    specifications:
      template.specifications?.length ? template.specifications : [{ label: "", value: "" }],
    colorParts: template.colorParts.length
      ? template.colorParts.map((part, index) => ({
          ...part,
          partMaskImageFileName:
            part.partMaskImageFileName || template.layeredRender?.partMasks?.[part.id] || "",
          indicatorAnchors:
            part.indicatorAnchors?.length
              ? part.indicatorAnchors
              : [createDraftIndicatorAnchor(index + 1, 1)]
        }))
      : makeBlankFormState().colorParts,
    baseImageUrl: template.baseImageUrl,
    instructionImageUrl: template.instructionImageUrl,
    baseImageFile: null,
    instructionImageFile: null,
    layeredRenderEnabled: Boolean(template.layeredRender?.enabled),
    layeredFallbackFinish: template.layeredRender?.fallbackFinish || "matte",
    layeredOutputWidth: template.layeredRender?.outputSize?.width
      ? String(template.layeredRender.outputSize.width)
      : "",
    layeredOutputHeight: template.layeredRender?.outputSize?.height
      ? String(template.layeredRender.outputSize.height)
      : "",
    layeredFinishBaseImages: template.layeredRender?.finishBaseImages || {},
    layeredMaterialMaps: template.layeredRender?.materialMaps || {},
    layeredFinishRules: Object.fromEntries(
      productFinishOptions.map((finish) => [
        finish,
        {
          ...defaultLayeredFinishRules[finish],
          ...(template.layeredRender?.finishRules?.[finish] || {})
        }
      ])
    ),
    logoOrientationPreset: template.logoPlacement.orientationPreset || "horizontal",
    logoPrintingAreaImages: template.logoPlacement.printingAreaImages || {}
  };
}

function updatePartAtIndex(
  colorParts: ProductColorPart[],
  index: number,
  updater: (part: ProductColorPart) => ProductColorPart
) {
  return colorParts.map((item, itemIndex) => (itemIndex === index ? updater(item) : item));
}

function toggleFinishOption(
  part: ProductColorPart,
  finish: ProductFinishOption
): ProductColorPart {
  const current = part.allowedFinishes || [];
  const nextAllowedFinishes = current.includes(finish)
    ? current.filter((item) => item !== finish)
    : [...current, finish];

  return {
    ...part,
    allowedFinishes: nextAllowedFinishes.length ? nextAllowedFinishes : undefined,
    defaultFinish: resolvePartDefaultFinish({
      allowedFinishes: nextAllowedFinishes,
      defaultFinish: part.defaultFinish
    })
  };
}

function moveFinishOption(
  part: ProductColorPart,
  fromIndex: number,
  toIndex: number
): ProductColorPart {
  const current = [...(part.allowedFinishes || [])];
  if (
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= current.length ||
    toIndex >= current.length ||
    fromIndex === toIndex
  ) {
    return part;
  }

  const [movedFinish] = current.splice(fromIndex, 1);
  current.splice(toIndex, 0, movedFinish);

  return {
    ...part,
    allowedFinishes: current
  };
}

function clampPercent(value: number, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value));
}

function roundToSingleDecimal(value: number) {
  return Math.round(value * 10) / 10;
}

function mergeTemplates(
  baseTemplates: TemplatePublicDto[],
  overridingTemplates: TemplatePublicDto[]
) {
  const mergedTemplates = new Map(baseTemplates.map((template) => [template.slug, template]));

  for (const template of overridingTemplates) {
    mergedTemplates.set(template.slug, template);
  }

  return Array.from(mergedTemplates.values()).sort((left, right) =>
    left.name.localeCompare(right.name)
  );
}

function mergeExpandedLocalProduct(
  snapshot: LocalLibrarySnapshot,
  product: LocalProductCatalogView
) {
  const products = snapshot.catalog.products.some(
    (candidate) => candidate.slug === product.slug
  )
    ? snapshot.catalog.products.map((candidate) =>
        candidate.slug === product.slug
          ? product
          : {
              ...candidate,
              releases: candidate.releases.slice(0, 1)
            }
      )
    : [...snapshot.catalog.products, product].sort((left, right) =>
        left.name.localeCompare(right.name)
      );

  return {
    ...snapshot,
    catalog: {
      ...snapshot.catalog,
      products
    }
  };
}

function buildLayeredRender(
  formState: EditorFormState,
  sourceTemplate: TemplatePublicDto | null,
  uploadedAssets: TemplateUploadedAssets
): LayeredRenderConfig | undefined {
  if (!formState.layeredRenderEnabled) return undefined;

  const outputWidth = Number(formState.layeredOutputWidth);
  const outputHeight = Number(formState.layeredOutputHeight);
  const outputSize =
    Number.isFinite(outputWidth) && outputWidth > 0 && Number.isFinite(outputHeight) && outputHeight > 0
      ? {
          width: outputWidth,
          height: outputHeight
        }
      : sourceTemplate?.layeredRender?.outputSize;
  const partMasks = Object.fromEntries(
    formState.colorParts
      .map((part) => [
        part.id,
        uploadedAssets.partMaskImageUrls[part.id] ||
          sourceTemplate?.layeredRender?.partMasks[part.id] ||
          sourceTemplate?.colorParts.find((sourcePart) => sourcePart.id === part.id)
            ?.partMaskImageUrl ||
          part.partMaskImageFileName ||
          ""
      ])
      .filter(([, assetUrl]) => Boolean(assetUrl))
  );
  const finishBaseImages = {
    ...formState.layeredFinishBaseImages,
    ...uploadedAssets.finishBaseImageUrls
  };
  const finishRules = Object.fromEntries(
    (Object.keys(finishBaseImages) as ProductFinishOption[]).map((finish) => [
      finish,
      {
        ...defaultLayeredFinishRules[finish],
        ...(formState.layeredFinishRules[finish] || {})
      }
    ])
  );
  const materialMaps: NonNullable<LayeredRenderConfig["materialMaps"]> = {};
  for (const finish of productFinishOptions) {
    const mapSet = {
      ...(formState.layeredMaterialMaps[finish] || {}),
      ...(uploadedAssets.materialMapImageUrls[finish] || {})
    };
    const hasCalibratedMap = advancedMaterialMapDefinitions.some(
      ({ key }) => Boolean(mapSet[key])
    );
    if (hasCalibratedMap) {
      materialMaps[finish] = mapSet;
    }
  }

  return {
    enabled: true,
    mode: "local-layered",
    ...(outputSize ? { outputSize } : {}),
    fallbackFinish: formState.layeredFallbackFinish,
    finishBaseImages,
    ...(Object.keys(materialMaps).length ? { materialMaps } : {}),
    partMasks,
    finishRules
  };
}

function buildTemplateFromFormState(
  formState: EditorFormState,
  sourceTemplate: TemplatePublicDto | null,
  fallbackPantoneOptions: TemplatePublicDto["pantoneOptions"],
  uploadedAssets: TemplateUploadedAssets
): TemplatePublicDto {
  const sourcePartsById = new Map((sourceTemplate?.colorParts || []).map((part) => [part.id, part]));
  const printingAreaImages = {
    ...(sourceTemplate?.logoPlacement.printingAreaImages || {}),
    ...formState.logoPrintingAreaImages,
    ...uploadedAssets.printingAreaImageUrls
  };

  return {
    id: formState.slug,
    slug: formState.slug,
    name: formState.name,
    category: formState.category,
    description: formState.description,
    size: formState.size || undefined,
    specifications: formState.specifications.filter((item) => item.label || item.value),
    baseImageUrl: uploadedAssets.baseImageUrl || formState.baseImageUrl || sourceTemplate?.baseImageUrl || "",
    instructionImageUrl:
      uploadedAssets.instructionImageUrl ||
      formState.instructionImageUrl ||
      sourceTemplate?.instructionImageUrl ||
      "",
    usageType: "visual_reference_only",
    allowedLogoPrintColors: sourceTemplate?.allowedLogoPrintColors || defaultLogoPrintColors,
    defaultLogoPrintColor: sourceTemplate?.defaultLogoPrintColor || "white",
    allowedPrintingMethods: sourceTemplate?.allowedPrintingMethods || defaultPrintingMethods,
    pantoneOptions: sourceTemplate?.pantoneOptions || fallbackPantoneOptions,
    colorParts: formState.colorParts.map((part) => ({
      ...part,
      partMaskImageUrl:
        uploadedAssets.partMaskImageUrls[part.id] ||
        sourcePartsById.get(part.id)?.partMaskImageUrl ||
        part.partMaskImageFileName
    })),
    layeredRender: buildLayeredRender(formState, sourceTemplate, uploadedAssets),
    logoPlacement: {
      ...(sourceTemplate?.logoPlacement || {
        description: "Keep logo inside the highlighted print area.",
        maxWidthMm: 40,
        maxHeightMm: 12,
        notes: "Final artwork, logo size, and production details must be confirmed by the Chili design team."
      }),
      orientationPreset: formState.logoOrientationPreset,
      ...(Object.keys(printingAreaImages).length
        ? { printingAreaImages }
        : {})
    },
    constraints: sourceTemplate?.constraints || defaultTemplateConstraints
  };
}

function buildLocalUploadAssets(params: {
  formState: EditorFormState;
  partMaskFiles: Record<string, File | null>;
  finishBaseFiles: Partial<Record<ProductFinishOption, File | null>>;
  materialMapFiles: Partial<Record<ProductFinishOption, MaterialMapFileSet>>;
  printingAreaFiles: Record<string, File | null>;
}): TemplateUploadedAssets {
  const {
    formState,
    partMaskFiles,
    finishBaseFiles,
    materialMapFiles,
    printingAreaFiles
  } = params;

  return {
    ...(formState.baseImageFile
      ? { baseImageUrl: createLocalUploadReference("base", "product-base") }
      : {}),
    ...(formState.instructionImageFile
      ? { instructionImageUrl: createLocalUploadReference("instruction", "instruction") }
      : {}),
    partMaskImageUrls: Object.fromEntries(
      formState.colorParts.flatMap((part) =>
        partMaskFiles[part.id]
          ? [[part.id, createLocalUploadReference("part-mask", part.id)]]
          : []
      )
    ),
    finishBaseImageUrls: Object.fromEntries(
      productFinishOptions.flatMap((finish) =>
        finishBaseFiles[finish]
          ? [[finish, createLocalUploadReference("finish-base", finish)]]
          : []
      )
    ),
    materialMapImageUrls: Object.fromEntries(
      productFinishOptions.flatMap((finish) => {
        const mapUrls = Object.fromEntries(
          advancedMaterialMapDefinitions.flatMap(({ key }) =>
            materialMapFiles[finish]?.[key]
              ? [
                  [
                    key,
                    createLocalUploadReference(
                      "material-map",
                      `${finish}:${key}`
                    )
                  ]
                ]
              : []
          )
        );
        return Object.keys(mapUrls).length ? [[finish, mapUrls]] : [];
      })
    ),
    printingAreaImageUrls: Object.fromEntries(
      Object.entries(printingAreaFiles).flatMap(([method, file]) =>
        file
          ? [[method, createLocalUploadReference("printing-area", method)]]
          : []
      )
    )
  };
}

function appendLocalUpload(formData: FormData, reference: string | undefined, file: File | null) {
  if (!reference || !file) return;
  formData.append(getLocalUploadFormField(reference), file);
}

function buildIndicatorExportPayload(formState: EditorFormState) {
  return {
    slug: formState.slug,
    name: formState.name,
    colorParts: formState.colorParts.map((part) => ({
      id: part.id,
      label: part.label,
      indicatorAnchors: part.indicatorAnchors || []
    }))
  };
}

async function copyTextToClipboard(text: string) {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  throw new Error("Clipboard is not available in this browser.");
}

function downloadJsonFile(fileName: string, payload: unknown) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json"
  });
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}

function useResolvedAssetPreview(file: File | null, fallbackUrl: string) {
  const [previewUrl, setPreviewUrl] = useState(fallbackUrl);

  useEffect(() => {
    if (!file) {
      setPreviewUrl(fallbackUrl);
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    setPreviewUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file, fallbackUrl]);

  return previewUrl;
}

function FinishBaseAssetField({
  finish,
  currentUrl,
  pendingFile,
  onFileChange
}: {
  finish: ProductFinishOption;
  currentUrl: string;
  pendingFile: File | null;
  onFileChange: (file: File | null) => void;
}) {
  const previewUrl = useResolvedAssetPreview(pendingFile, currentUrl);

  return (
    <label className="setup-field">
      <span className="control-label">{productFinishLabels[finish]} base image</span>
      {previewUrl ? (
        <div className="catalog-image-frame compact-frame">
          <img src={previewUrl} alt={`${productFinishLabels[finish]} material base`} />
        </div>
      ) : null}
      <input
        className="input-shell"
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={(event) => onFileChange(event.target.files?.[0] || null)}
      />
      {pendingFile ? <p className="fine-print">Pending file: {pendingFile.name}</p> : null}
      {currentUrl && !pendingFile ? <p className="fine-print">Current asset: {currentUrl}</p> : null}
    </label>
  );
}

type EditableFinishRuleKey =
  | "colorOpacity"
  | "highlightProtection"
  | "textureStrength"
  | "saturationBoost";

const finishCalibrationFields: Array<{
  key: EditableFinishRuleKey;
  label: string;
  max: number;
}> = [
  { key: "colorOpacity", label: "Pantone coverage", max: 1 },
  { key: "highlightProtection", label: "Highlight", max: 1 },
  { key: "textureStrength", label: "Surface detail", max: 1 },
  { key: "saturationBoost", label: "Saturation", max: 0.5 }
];

function MaterialCalibrationFields({
  finish,
  rule,
  onChange
}: {
  finish: ProductFinishOption;
  rule: LayeredRenderFinishRule;
  onChange: (key: EditableFinishRuleKey, value: number) => void;
}) {
  return (
    <div className="material-calibration-panel">
      <div className="material-calibration-head">
        <strong>{productFinishLabels[finish]} response</strong>
        <span>Product-specific calculation</span>
      </div>
      <div className="material-calibration-grid">
        {finishCalibrationFields.map((field) => {
          const fallbackValue = defaultLayeredFinishRules[finish][field.key] ?? 0;
          const value = rule[field.key] ?? fallbackValue;

          return (
            <label className="material-calibration-field" key={`${finish}-${field.key}`}>
              <span>{field.label}</span>
              <input
                className="input-shell"
                type="number"
                min="0"
                max={field.max}
                step="0.01"
                value={value}
                onChange={(event) => {
                  const nextValue = Number(event.target.value);
                  if (Number.isFinite(nextValue)) {
                    onChange(field.key, Math.min(field.max, Math.max(0, nextValue)));
                  }
                }}
              />
            </label>
          );
        })}
      </div>
    </div>
  );
}

function MaterialMapAssetFields({
  finish,
  currentMaps,
  pendingFiles,
  onFileChange,
  onRemove
}: {
  finish: ProductFinishOption;
  currentMaps: Partial<Record<LayeredMaterialMapKey, string>>;
  pendingFiles: MaterialMapFileSet;
  onFileChange: (
    key: Exclude<LayeredMaterialMapKey, "base">,
    file: File | null
  ) => void;
  onRemove: (key: Exclude<LayeredMaterialMapKey, "base">) => void;
}) {
  const configuredCount = advancedMaterialMapDefinitions.filter(
    ({ key }) => currentMaps[key] || pendingFiles[key]
  ).length;

  return (
    <details className="material-map-details">
      <summary>
        <span>Advanced calibrated maps</span>
        <small>
          {configuredCount
            ? `${configuredCount} of ${advancedMaterialMapDefinitions.length} configured`
            : "Optional"}
        </small>
      </summary>
      <div className="material-map-content">
        <p className="fine-print">
          Leave these empty to derive the material response from this product&apos;s{" "}
          {productFinishLabels[finish]} reference. Add a map only when that automatic
          result needs correction.
        </p>
        <div className="material-map-grid">
          {advancedMaterialMapDefinitions.map(({ key, label, description }) => {
            const currentUrl = currentMaps[key];
            const pendingFile = pendingFiles[key];

            return (
              <div className="material-map-field" key={`${finish}-${key}`}>
                <label>
                  <span className="control-label">{label}</span>
                  <span className="fine-print">{description}</span>
                  <input
                    className="input-shell"
                    type="file"
                    accept="image/png,image/webp"
                    onChange={(event) =>
                      onFileChange(key, event.target.files?.[0] || null)
                    }
                  />
                </label>
                {pendingFile ? (
                  <p className="fine-print">Pending replacement: {pendingFile.name}</p>
                ) : currentUrl ? (
                  <div className="material-map-current">
                    <p className="fine-print" title={currentUrl}>
                      Calibrated map saved
                    </p>
                    <button
                      className="text-button"
                      type="button"
                      onClick={() => onRemove(key)}
                    >
                      Use automatic map
                    </button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </details>
  );
}

function PrintingAreaAssetField({
  method,
  currentUrl,
  pendingFile,
  onFileChange
}: {
  method: string;
  currentUrl: string;
  pendingFile: File | null;
  onFileChange: (file: File | null) => void;
}) {
  const previewUrl = useResolvedAssetPreview(pendingFile, currentUrl);
  const methodLabel = getPrintingMethodPrompt(method).label;

  return (
    <label className="setup-field">
      <span className="control-label">{methodLabel} printing area</span>
      {previewUrl ? (
        <div className="catalog-image-frame compact-frame">
          <img src={previewUrl} alt={`${methodLabel} printing area`} />
        </div>
      ) : null}
      <input
        className="input-shell"
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={(event) => onFileChange(event.target.files?.[0] || null)}
      />
      {pendingFile ? <p className="fine-print">Pending file: {pendingFile.name}</p> : null}
      {currentUrl && !pendingFile ? <p className="fine-print">Current asset: {currentUrl}</p> : null}
    </label>
  );
}

function PartIndicatorVisualEditor({
  part,
  previewImageUrl,
  onAnchorChange
}: {
  part: ProductColorPart;
  previewImageUrl: string;
  onAnchorChange: (anchorIndex: number, next: Partial<PartIndicatorAnchor>) => void;
}) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [frameSize, setFrameSize] = useState({ width: 0, height: 0 });
  const [activeAnchorId, setActiveAnchorId] = useState<string | null>(
    part.indicatorAnchors?.[0]?.id || null
  );
  const [dragState, setDragState] = useState<{
    anchorIndex: number;
    pointerId: number;
    mode: "target" | "label";
  } | null>(null);

  useEffect(() => {
    if (!part.indicatorAnchors?.length) {
      setActiveAnchorId(null);
      return;
    }

    const hasActiveAnchor = part.indicatorAnchors.some((anchor) => anchor.id === activeAnchorId);
    if (!hasActiveAnchor) {
      setActiveAnchorId(part.indicatorAnchors[0].id);
    }
  }, [activeAnchorId, part.indicatorAnchors]);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || typeof ResizeObserver === "undefined") return;

    const updateSize = () => {
      const bounds = frame.getBoundingClientRect();
      setFrameSize({
        width: bounds.width,
        height: bounds.height
      });
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [previewImageUrl]);

  useEffect(() => {
    if (!dragState) return;
    const currentDragState = dragState;

    function handlePointerMove(event: PointerEvent) {
      if (event.pointerId !== currentDragState.pointerId) return;

      const frame = frameRef.current;
      const anchor = part.indicatorAnchors?.[currentDragState.anchorIndex];
      if (!frame || !anchor) return;

      const bounds = frame.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;

      const pointerXPercent = clampPercent(((event.clientX - bounds.left) / bounds.width) * 100);
      const pointerYPercent = clampPercent(((event.clientY - bounds.top) / bounds.height) * 100);

      if (currentDragState.mode === "target") {
        onAnchorChange(currentDragState.anchorIndex, {
          targetXPercent: roundToSingleDecimal(pointerXPercent),
          targetYPercent: roundToSingleDecimal(pointerYPercent)
        });
      } else {
        onAnchorChange(currentDragState.anchorIndex, {
          labelOffsetXPercent: roundToSingleDecimal(pointerXPercent - anchor.targetXPercent),
          labelOffsetYPercent: roundToSingleDecimal(pointerYPercent - anchor.targetYPercent)
        });
      }
    }

    function handlePointerUp(event: PointerEvent) {
      if (event.pointerId === currentDragState.pointerId) {
        setDragState(null);
      }
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [dragState, onAnchorChange, part.indicatorAnchors]);

  if (!previewImageUrl) {
    return (
      <div className="indicator-visual-empty">
        Upload or keep a product image to enable direct indicator positioning.
      </div>
    );
  }

  return (
    <div className="indicator-visual-editor">
      <div className="indicator-visual-head">
        <p className="fine-print">
          Drag the dot to place the target. Drag the pill label to place the callout.
        </p>
      </div>
      <div className="indicator-visual-frame" ref={frameRef}>
        <img src={previewImageUrl} alt={`${part.label} indicator preview`} />
        <div className="indicator-visual-overlay">
          {(part.indicatorAnchors || []).map((anchor, anchorIndex) => {
            const labelXPercent = clampPercent(
              anchor.targetXPercent + anchor.labelOffsetXPercent
            );
            const labelYPercent = clampPercent(
              anchor.targetYPercent + anchor.labelOffsetYPercent
            );
            const targetX = (frameSize.width * anchor.targetXPercent) / 100;
            const targetY = (frameSize.height * anchor.targetYPercent) / 100;
            const labelX = (frameSize.width * labelXPercent) / 100;
            const labelY = (frameSize.height * labelYPercent) / 100;
            const deltaX = targetX - labelX;
            const deltaY = targetY - labelY;
            const isActive = activeAnchorId === anchor.id;

            return (
              <div
                key={anchor.id}
                className={`indicator-visual-anchor${isActive ? " is-active" : ""}`}
              >
                <div
                  className="indicator-visual-line"
                  style={{
                    left: `${labelX}px`,
                    top: `${labelY}px`,
                    width: `${Math.hypot(deltaX, deltaY)}px`,
                    transform: `translateY(-50%) rotate(${(Math.atan2(deltaY, deltaX) * 180) / Math.PI}deg)`
                  }}
                />
                <button
                  type="button"
                  className="indicator-visual-target"
                  style={{
                    left: `${anchor.targetXPercent}%`,
                    top: `${anchor.targetYPercent}%`
                  }}
                  onPointerDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setActiveAnchorId(anchor.id);
                    setDragState({
                      anchorIndex,
                      pointerId: event.pointerId,
                      mode: "target"
                    });
                  }}
                  aria-label={`Drag target for ${part.label} indicator ${anchorIndex + 1}`}
                />
                <button
                  type="button"
                  className="indicator-visual-label"
                  style={{
                    left: `${labelXPercent}%`,
                    top: `${labelYPercent}%`
                  }}
                  onPointerDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setActiveAnchorId(anchor.id);
                    setDragState({
                      anchorIndex,
                      pointerId: event.pointerId,
                      mode: "label"
                    });
                  }}
                >
                  <span className="indicator-visual-label-number">{anchorIndex + 1}</span>
                  <span className="indicator-visual-label-copy">Drag callout</span>
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default function TemplateSetupStudio({
  initialTemplates,
  pantoneOptions
}: {
  initialTemplates: TemplateSummaryDto[];
  pantoneOptions: TemplatePublicDto["pantoneOptions"];
}) {
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const selectionRequestRef = useRef(0);
  const [templates, setTemplates] = useState<TemplatePublicDto[]>([]);
  const [selectedSlug, setSelectedSlug] = useState(
    initialTemplates[0]?.slug || newTemplateKey
  );
  const [formState, setFormState] = useState<EditorFormState>(makeBlankFormState);
  const [partMaskFiles, setPartMaskFiles] = useState<Record<string, File | null>>({});
  const [finishBaseFiles, setFinishBaseFiles] = useState<
    Partial<Record<ProductFinishOption, File | null>>
  >({});
  const [materialMapFiles, setMaterialMapFiles] = useState<
    Partial<Record<ProductFinishOption, MaterialMapFileSet>>
  >({});
  const [printingAreaFiles, setPrintingAreaFiles] = useState<Record<string, File | null>>({});
  const [draggedFinishOrder, setDraggedFinishOrder] = useState<{
    partId: string;
    finish: ProductFinishOption;
  } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isPublishingOnline, setIsPublishingOnline] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isLoadingTemplate, setIsLoadingTemplate] = useState(false);
  const [libraryAccess, setLibraryAccess] = useState<
    "checking" | "available" | "remote" | "unavailable"
  >("checking");
  const [localSnapshot, setLocalSnapshot] = useState<LocalLibrarySnapshot | null>(null);
  const [onlineConfiguration, setOnlineConfiguration] =
    useState<OnlinePublishConfiguration | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const baseImagePreviewUrl = useResolvedAssetPreview(
    formState.baseImageFile,
    formState.baseImageUrl
  );
  const instructionImagePreviewUrl = useResolvedAssetPreview(
    formState.instructionImageFile,
    formState.instructionImageUrl
  );

  const selectedTemplate = useMemo(
    () => templates.find((template) => template.slug === selectedSlug) || null,
    [selectedSlug, templates]
  );
  const availableProducts = useMemo(() => {
    const productsBySlug = new Map(
      initialTemplates.map((template) => [
        template.slug,
        {
          slug: template.slug,
          name: template.name,
          category: template.category
        }
      ])
    );

    for (const template of templates) {
      productsBySlug.set(template.slug, {
        slug: template.slug,
        name: template.name,
        category: template.category
      });
    }

    for (const product of localSnapshot?.catalog.products || []) {
      productsBySlug.set(product.slug, {
        slug: product.slug,
        name: product.name,
        category: product.category
      });
    }

    return Array.from(productsBySlug.values()).sort((left, right) =>
      left.name.localeCompare(right.name)
    );
  }, [initialTemplates, localSnapshot, templates]);
  const isNewTemplate = selectedSlug === newTemplateKey || !selectedTemplate;
  const canSaveTemplate = libraryAccess === "available" && !isLoadingTemplate;
  const saveModeLabel =
    libraryAccess === "checking"
      ? "Checking localhost"
      : libraryAccess === "available"
        ? "Local Asset Library"
        : libraryAccess === "remote"
          ? "Remote setup locked"
          : "Local API unavailable";
  const selectedLocalProduct = useMemo(
    () =>
      localSnapshot?.catalog.products.find((product) => product.slug === formState.slug) || null,
    [formState.slug, localSnapshot]
  );
  const onlinePublicationIsCurrent = Boolean(
    selectedLocalProduct?.onlinePublication &&
      selectedLocalProduct.onlinePublication.sourceLocalVersion ===
        selectedLocalProduct.publishedVersion
  );
  const canPublishOnline = Boolean(
    onlineConfiguration?.configured &&
      selectedLocalProduct?.publishedVersion &&
      !isLoadingTemplate
  );
  const logoPrintingMethods =
    selectedTemplate?.allowedPrintingMethods?.length
      ? selectedTemplate.allowedPrintingMethods
      : defaultPrintingMethods;
  const activeMaterialFinishes = useMemo(() => {
    const finishes = new Set<ProductFinishOption>([formState.layeredFallbackFinish]);
    for (const part of formState.colorParts) {
      for (const finish of part.allowedFinishes || []) {
        finishes.add(finish);
      }
    }
    return productFinishOptions.filter((finish) => finishes.has(finish));
  }, [formState.colorParts, formState.layeredFallbackFinish]);

  useEffect(() => {
    if (!isLocalStudioBrowser()) {
      setLibraryAccess("remote");
      return;
    }

    let isCancelled = false;

    getOnlinePublishClientConfiguration()
      .then((configuration) => {
        if (!isCancelled) setOnlineConfiguration(configuration);
      })
      .catch(() => {
        if (!isCancelled) {
          setOnlineConfiguration({
            configured: false,
            bucket: "mockup-assets",
            missing: ["Local Supabase configuration"]
          });
        }
      });

    getLocalLibraryClientSnapshot()
      .then(async (snapshot) => {
        if (isCancelled) return;
        setLocalSnapshot(snapshot);
        setLibraryAccess("available");

        const preferredSlug =
          selectedSlug !== newTemplateKey
            ? selectedSlug
            : initialTemplates[0]?.slug || snapshot.catalog.products[0]?.slug;
        let preferredTemplate: TemplatePublicDto | undefined;
        if (preferredSlug) {
          const localTemplate = await getLocalLibraryTemplate(
            preferredSlug,
            "latest",
            true
          );
          if (isCancelled) return;
          const expandedProduct = localTemplate?.product;
          if (expandedProduct) {
            setLocalSnapshot((current) =>
              current
                ? mergeExpandedLocalProduct(current, expandedProduct)
                : current
            );
          }
          preferredTemplate = localTemplate?.template;
        }

        if (preferredTemplate) {
          setTemplates((current) => mergeTemplates(current, [preferredTemplate]));
          setSelectedSlug(preferredTemplate.slug);
          setFormState(buildFormStateFromTemplate(preferredTemplate));
        }
        setSaveMessage(
          snapshot.catalog.products.length
            ? `Local Asset Library ready with ${snapshot.catalog.products.length} product${
                snapshot.catalog.products.length === 1 ? "" : "s"
              }.`
            : "Local Asset Library ready. Save the first product as a draft when its assets are ready."
        );
      })
      .catch((error) => {
        if (isCancelled) return;
        setLibraryAccess("unavailable");
        setSaveError(
          error instanceof Error
            ? error.message
            : "Failed to open the Local Asset Library."
        );
      });

    return () => {
      isCancelled = true;
    };
  }, []);

  function updateIndicatorAnchorField(
    partIndex: number,
    anchorIndex: number,
    next: Partial<PartIndicatorAnchor>
  ) {
    setFormState((current) => ({
      ...current,
      colorParts: updatePartAtIndex(current.colorParts, partIndex, (item) => ({
        ...item,
        indicatorAnchors: (item.indicatorAnchors || []).map((itemAnchor, itemAnchorIndex) =>
          itemAnchorIndex === anchorIndex ? { ...itemAnchor, ...next } : itemAnchor
        )
      }))
    }));
  }

  async function selectTemplate(slug: string) {
    const requestId = selectionRequestRef.current + 1;
    selectionRequestRef.current = requestId;

    if (slug === newTemplateKey) {
      setIsLoadingTemplate(false);
      setSelectedSlug(newTemplateKey);
      setFormState(makeBlankFormState());
      setPartMaskFiles({});
      setFinishBaseFiles({});
      setMaterialMapFiles({});
      setPrintingAreaFiles({});
      setDraggedFinishOrder(null);
      setSaveError(null);
      setSaveMessage(null);
      return;
    }

    let template = templates.find((candidate) => candidate.slug === slug);
    const localProduct = localSnapshot?.catalog.products.find(
      (product) => product.slug === slug
    );
    const repositoryProduct = initialTemplates.find(
      (product) => product.slug === slug
    );
    if (libraryAccess === "available" && (localProduct || !template)) {
      setIsLoadingTemplate(true);
      setSaveError(null);
      setSaveMessage(
        `Loading ${localProduct?.name || repositoryProduct?.name || slug}...`
      );
      try {
        const localTemplate = await getLocalLibraryTemplate(
          slug,
          "latest",
          true
        );
        if (selectionRequestRef.current !== requestId) return;
        if (!localTemplate) {
          throw new Error("The selected product template could not be loaded.");
        }
        const expandedProduct = localTemplate.product;
        if (expandedProduct) {
          setLocalSnapshot((current) =>
            current
              ? mergeExpandedLocalProduct(current, expandedProduct)
              : current
          );
        }
        template = localTemplate?.template || template;
      } catch (error) {
        if (selectionRequestRef.current !== requestId) return;
        setSaveError(
          error instanceof Error ? error.message : "Failed to load the local product."
        );
        setSaveMessage(null);
        return;
      } finally {
        if (selectionRequestRef.current === requestId) {
          setIsLoadingTemplate(false);
        }
      }
    }
    if (!template || selectionRequestRef.current !== requestId) return;

    setTemplates((current) => mergeTemplates(current, [template]));
    setSelectedSlug(slug);
    setFormState(buildFormStateFromTemplate(template));
    setPartMaskFiles({});
    setFinishBaseFiles({});
    setMaterialMapFiles({});
    setPrintingAreaFiles({});
    setDraggedFinishOrder(null);
    setSaveError(null);
    setSaveMessage(null);
  }

  function handlePartMaskFileChange(partId: string, file: File | null) {
    setPartMaskFiles((current) => ({
      ...current,
      [partId]: file
    }));
  }

  function handleFinishBaseFileChange(finish: ProductFinishOption, file: File | null) {
    setFinishBaseFiles((current) => ({
      ...current,
      [finish]: file
    }));
  }

  function handleMaterialMapFileChange(
    finish: ProductFinishOption,
    key: Exclude<LayeredMaterialMapKey, "base">,
    file: File | null
  ) {
    setMaterialMapFiles((current) => ({
      ...current,
      [finish]: {
        ...(current[finish] || {}),
        [key]: file
      }
    }));
  }

  function handleMaterialMapRemove(
    finish: ProductFinishOption,
    key: Exclude<LayeredMaterialMapKey, "base">
  ) {
    setMaterialMapFiles((current) => ({
      ...current,
      [finish]: {
        ...(current[finish] || {}),
        [key]: null
      }
    }));
    setFormState((current) => {
      const mapSet = { ...(current.layeredMaterialMaps[finish] || {}) };
      delete mapSet[key];
      const nextMaterialMaps = { ...current.layeredMaterialMaps };
      if (Object.keys(mapSet).length) {
        nextMaterialMaps[finish] = mapSet;
      } else {
        delete nextMaterialMaps[finish];
      }

      return {
        ...current,
        layeredMaterialMaps: nextMaterialMaps
      };
    });
  }

  function handleFinishRuleChange(
    finish: ProductFinishOption,
    key: EditableFinishRuleKey,
    value: number
  ) {
    setFormState((current) => ({
      ...current,
      layeredFinishRules: {
        ...current.layeredFinishRules,
        [finish]: {
          ...defaultLayeredFinishRules[finish],
          ...(current.layeredFinishRules[finish] || {}),
          [key]: value
        }
      }
    }));
  }

  function handlePrintingAreaFileChange(method: string, file: File | null) {
    setPrintingAreaFiles((current) => ({
      ...current,
      [method]: file
    }));
  }

  async function handleCopyAllIndicators() {
    try {
      await copyTextToClipboard(
        JSON.stringify(buildIndicatorExportPayload(formState), null, 2)
      );
      setSaveError(null);
      setSaveMessage("Indicator JSON copied to clipboard.");
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : "Failed to copy indicator JSON."
      );
      setSaveMessage(null);
    }
  }

  async function handleCopyPartIndicators(part: ProductColorPart) {
    try {
      await copyTextToClipboard(
        JSON.stringify(
          {
            id: part.id,
            label: part.label,
            indicatorAnchors: part.indicatorAnchors || []
          },
          null,
          2
        )
      );
      setSaveError(null);
      setSaveMessage(`${part.label} indicator JSON copied.`);
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : "Failed to copy part indicator JSON."
      );
      setSaveMessage(null);
    }
  }

  function handleExportIndicators() {
    try {
      const safeSlug = slugify(formState.slug || formState.name || "product");
      downloadJsonFile(
        `${safeSlug || "product"}-indicator-positions.json`,
        buildIndicatorExportPayload(formState)
      );
      setSaveError(null);
      setSaveMessage("Indicator JSON exported.");
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : "Failed to export indicator JSON."
      );
      setSaveMessage(null);
    }
  }

  function applyLocalSnapshot(snapshot: LocalLibrarySnapshot, selectedTemplate?: TemplatePublicDto) {
    setLocalSnapshot(snapshot);

    if (selectedTemplate) {
      setTemplates((current) => mergeTemplates(current, [selectedTemplate]));
      setSelectedSlug(selectedTemplate.slug);
      setFormState(buildFormStateFromTemplate(selectedTemplate));
    }
  }

  function clearPendingAssetFiles() {
    setPartMaskFiles({});
    setFinishBaseFiles({});
    setMaterialMapFiles({});
    setPrintingAreaFiles({});
  }

  async function handleLocalTemplateSave(status: LocalReleaseStatus) {
    if (!canSaveTemplate) {
      setSaveError(
        "Local Studio can only save while this project is running on localhost with npm run dev."
      );
      setSaveMessage(null);
      return;
    }

    setIsSaving(true);
    setSaveError(null);
    setSaveMessage(null);

    try {
      const uploadedAssets = buildLocalUploadAssets({
        formState,
        partMaskFiles,
        finishBaseFiles,
        materialMapFiles,
        printingAreaFiles
      });
      const template = buildTemplateFromFormState(
        formState,
        selectedTemplate,
        pantoneOptions,
        uploadedAssets
      );
      const formData = new FormData();
      formData.append("status", status);
      formData.append("template", JSON.stringify(template));
      appendLocalUpload(
        formData,
        uploadedAssets.baseImageUrl,
        formState.baseImageFile
      );
      appendLocalUpload(
        formData,
        uploadedAssets.instructionImageUrl,
        formState.instructionImageFile
      );

      formState.colorParts.forEach((part) => {
        appendLocalUpload(
          formData,
          uploadedAssets.partMaskImageUrls[part.id],
          partMaskFiles[part.id] || null
        );
      });
      productFinishOptions.forEach((finish) => {
        appendLocalUpload(
          formData,
          uploadedAssets.finishBaseImageUrls[finish],
          finishBaseFiles[finish] || null
        );
        advancedMaterialMapDefinitions.forEach(({ key }) => {
          appendLocalUpload(
            formData,
            uploadedAssets.materialMapImageUrls[finish]?.[key],
            materialMapFiles[finish]?.[key] || null
          );
        });
      });
      logoPrintingMethods.forEach((method) => {
        appendLocalUpload(
          formData,
          uploadedAssets.printingAreaImageUrls[method],
          printingAreaFiles[method] || null
        );
      });

      const result = await saveLocalLibraryRelease(formData);
      applyLocalSnapshot(result.snapshot, result.template);
      clearPendingAssetFiles();
      const release = result.snapshot.catalog.products
        .find((product) => product.slug === result.template.slug)
        ?.releases.find((item) => item.version === result.version);
      const warningCopy = release?.warnings.length
        ? ` ${release.warnings.length} quality note${release.warnings.length === 1 ? "" : "s"} recorded.`
        : "";
      setSaveMessage(
        status === "published"
          ? `Published ${result.template.name} locally as v${result.version}.${warningCopy}`
          : `Saved ${result.template.name} draft v${result.version}.${warningCopy}`
      );
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : "Failed to save the Local Studio release."
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function handleImportProductPackage(file: File | null) {
    if (!file) return;
    setIsImporting(true);
    setSaveError(null);
    setSaveMessage(null);

    try {
      const result = await importLocalLibraryProduct(file);
      applyLocalSnapshot(result.snapshot, result.template);
      clearPendingAssetFiles();
      setSaveMessage(
        `Imported ${result.template.name} as local draft v${result.version}. Review it before publishing.`
      );
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : "Failed to import the Chili product package."
      );
    } finally {
      setIsImporting(false);
      if (importInputRef.current) {
        importInputRef.current.value = "";
      }
    }
  }

  async function handleOnlinePublish() {
    if (!formState.slug || !selectedLocalProduct?.publishedVersion) {
      setSaveError("Publish this product to the local preview before publishing it online.");
      setSaveMessage(null);
      return;
    }
    if (!onlineConfiguration?.configured) {
      setSaveError(
        `Online publishing needs ${onlineConfiguration?.missing.join(", ") || "Supabase configuration"} in .env.local.`
      );
      setSaveMessage(null);
      return;
    }

    setIsPublishingOnline(true);
    setSaveError(null);
    setSaveMessage(null);

    try {
      const result = await publishLocalLibraryProductOnline(formState.slug);
      const publishedProduct = result.snapshot.catalog.products.find(
        (product) => product.slug === result.slug
      );
      setLocalSnapshot(result.snapshot);
      setSaveMessage(
        `Published ${publishedProduct?.name || formState.name} online as v${result.onlineVersion} from local v${result.localVersion}. ` +
          `${result.uploadedAssetCount} new asset${result.uploadedAssetCount === 1 ? "" : "s"} uploaded and ` +
          `${result.reusedAssetCount} reused.`
      );
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : "Failed to publish this product online."
      );
    } finally {
      setIsPublishingOnline(false);
    }
  }

  async function handleRollback(version: number) {
    if (!formState.slug) return;
    setIsSaving(true);
    setSaveError(null);
    setSaveMessage(null);

    try {
      const result = await rollbackLocalLibraryProduct(formState.slug, version);
      applyLocalSnapshot(result.snapshot, result.template);
      clearPendingAssetFiles();
      setSaveMessage(`Restored ${result.template.name} release v${version} as the local published version.`);
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : "Failed to restore the selected release."
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await handleLocalTemplateSave("draft");
  }

  if (libraryAccess !== "available") {
    const isChecking = libraryAccess === "checking";
    const isRemote = libraryAccess === "remote";

    return (
      <main className="setup-page setup-access-page">
        <header className="catalog-header">
          <div className="brand-lockup">
            <ChiliLogo className="brand-logo" />
          </div>
          <div className="site-bar-actions">
            <Link href="/" className="secondary-link-button">
              Product library
            </Link>
            <span className="mode-pill">Local Studio</span>
          </div>
        </header>
        <section className="surface setup-access-panel">
          <p className="eyebrow">{isChecking ? "Connecting" : "Protected workspace"}</p>
          <h1 className="hero-title">
            {isChecking
              ? "Opening the Local Asset Library"
              : isRemote
                ? "Setup Studio is available on localhost only"
                : "Local Studio API is unavailable"}
          </h1>
          <p className="panel-description">
            {isChecking
              ? "Checking the local catalog and release history."
              : isRemote
                ? "Run this project locally with npm run dev to create, publish, export, or restore product assets. The Netlify deployment does not expose any admin write API."
                : "Start the project with npm run dev and check the Local Studio configuration in .env.local."}
          </p>
          {saveError ? <p className="alert-error inline-alert">{saveError}</p> : null}
        </section>
      </main>
    );
  }

  return (
    <main className="setup-page">
      <header className="catalog-header">
        <div className="brand-lockup">
          <ChiliLogo className="brand-logo" />
        </div>
        <div className="site-bar-actions">
          <Link href="/" className="secondary-link-button">
            Product library
          </Link>
          <span className="mode-pill">Local Studio</span>
        </div>
      </header>

      <section className="catalog-hero">
        <div className="hero-copy-stack">
          <p className="eyebrow">Product production workspace</p>
          <h1 className="hero-title">Build and publish reliable product asset packs</h1>
        </div>
        <div className="hero-aside-stack">
          <div className="hero-stat-grid" aria-label="Setup overview">
            <article className="stat-card">
              <span className="stat-label">Products available</span>
              <strong className="stat-value">{availableProducts.length}</strong>
            </article>
            <article className="stat-card">
              <span className="stat-label">Current mode</span>
              <strong className="stat-value stat-value-compact">{saveModeLabel}</strong>
            </article>
            <article className="stat-card">
              <span className="stat-label">Local releases</span>
              <strong className="stat-value">
                {localSnapshot?.catalog.products.reduce(
                  (total, product) => total + product.releases.length,
                  0
                ) || 0}
              </strong>
            </article>
          </div>
        </div>
      </section>

      <section className="section-heading-row">
        <div>
          <p className="panel-kicker">Asset production</p>
          <h2 className="section-title">Products, materials, print areas, release</h2>
        </div>
      </section>

      <div className="setup-layout">
        <aside className="surface setup-sidebar">
          <div className="panel-head">
            <p className="panel-kicker">Products</p>
            <h2 className="section-title">Local catalog</h2>
            <p className="fine-print local-library-path" title={localSnapshot?.libraryPath}>
              {localSnapshot?.libraryPath}
            </p>
            <input
              ref={importInputRef}
              className="visually-hidden"
              type="file"
              accept=".zip,.chili-product.zip,application/zip"
              onChange={(event) => handleImportProductPackage(event.target.files?.[0] || null)}
            />
            <button
              type="button"
              className="secondary-link-button"
              disabled={isImporting}
              onClick={() => importInputRef.current?.click()}
            >
              {isImporting ? "Importing..." : "Import product package"}
            </button>
          </div>
          <div className="setup-sidebar-body">
            <button
              type="button"
              className={`list-row-button${isNewTemplate ? " is-active" : ""}`}
              onClick={() => selectTemplate(newTemplateKey)}
            >
              New product
            </button>
            {availableProducts.map((template) => (
              <button
                key={template.slug}
                type="button"
                disabled={isLoadingTemplate}
                className={`list-row-button${selectedSlug === template.slug ? " is-active" : ""}`}
                onClick={() => selectTemplate(template.slug)}
              >
                <span>{template.name}</span>
                <span className="list-row-meta">{template.category}</span>
              </button>
            ))}
          </div>
          {selectedLocalProduct ? (
            <div className="local-release-panel">
              <div className="local-release-heading">
                <div>
                  <p className="panel-kicker">Release history</p>
                  <h3>{selectedLocalProduct.name}</h3>
                </div>
                <a
                  className="text-link"
                  href={getLocalProductExportUrl(
                    selectedLocalProduct.slug,
                    selectedLocalProduct.publishedVersion || selectedLocalProduct.latestVersion
                  )}
                  download
                >
                  Export ZIP
                </a>
              </div>
              <div className="local-release-list">
                {selectedLocalProduct.releases.map((release) => {
                  const isPublished =
                    selectedLocalProduct.publishedVersion === release.version;

                  return (
                    <article
                      className={`local-release-row${isPublished ? " is-published" : ""}`}
                      key={`${selectedLocalProduct.slug}-v${release.version}`}
                    >
                      <div>
                        <strong>v{release.version}</strong>
                        <span>{isPublished ? "Local preview" : release.status}</span>
                      </div>
                      <small>
                        {release.assetCount} assets
                        {release.warnings.length ? ` / ${release.warnings.length} notes` : ""}
                      </small>
                      {!isPublished ? (
                        <button
                          type="button"
                          className="text-link button-reset"
                          disabled={isSaving || isPublishingOnline}
                          onClick={() => handleRollback(release.version)}
                        >
                          Restore
                        </button>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            </div>
          ) : null}
        </aside>

        <section className="surface setup-form-panel">
          <div className="panel-head">
            <p className="panel-kicker">{isNewTemplate ? "Create product" : "Edit product"}</p>
            <h2 className="section-title">
              {isNewTemplate ? "New template" : formState.name || formState.slug}
            </h2>
            {formState.slug ? (
              <p className="panel-description">Local preview: /mockup?slug={formState.slug}</p>
            ) : null}
            <div className="setup-inline-actions">
              <span className="status-pill is-complete">{saveModeLabel}</span>
              <span className="status-pill">
                {selectedLocalProduct
                  ? `Latest v${selectedLocalProduct.latestVersion}`
                  : isNewTemplate
                    ? "Unsaved product"
                    : "Repository source"}
              </span>
              {selectedLocalProduct?.publishedVersion ? (
                <span className="status-pill is-complete">
                  Local preview v{selectedLocalProduct.publishedVersion}
                </span>
              ) : null}
              {selectedLocalProduct?.onlinePublication ? (
                <span
                  className={`status-pill${onlinePublicationIsCurrent ? " is-complete" : ""}`}
                >
                  Online v{selectedLocalProduct.onlinePublication.onlineVersion} / local v
                  {selectedLocalProduct.onlinePublication.sourceLocalVersion}
                  {onlinePublicationIsCurrent ? "" : " / update needed"}
                </span>
              ) : null}
            </div>
            <p className="fine-print">
              Drafts and local preview releases are stored outside Git. Publish Online uploads
              content-addressed assets to Supabase and makes only the published version public.
            </p>
            <div className="setup-inline-actions">
              <button
                type="button"
                className="secondary-link-button"
                onClick={handleCopyAllIndicators}
              >
                Copy indicator JSON
              </button>
              <button
                type="button"
                className="secondary-link-button"
                onClick={handleExportIndicators}
              >
                Export indicators JSON
              </button>
            </div>
          </div>

          <form className="setup-form" onSubmit={handleSubmit}>
            <div className="field-grid">
              <label className="setup-field">
                <span className="control-label">Product slug</span>
                <input
                  className="input-shell"
                  value={formState.slug}
                  disabled={!isNewTemplate}
                  onChange={(event) =>
                    setFormState((current) => ({ ...current, slug: slugify(event.target.value) }))
                  }
                  placeholder="umbrella-classic-black"
                />
              </label>

              <label className="setup-field">
                <span className="control-label">Product name</span>
                <input
                  className="input-shell"
                  value={formState.name}
                  onChange={(event) =>
                    setFormState((current) => ({ ...current, name: event.target.value }))
                  }
                  placeholder="Classic Umbrella"
                />
              </label>

              <label className="setup-field">
                <span className="control-label">Category</span>
                <select
                  className="input-shell"
                  value={formState.category}
                  onChange={(event) =>
                    setFormState((current) => ({ ...current, category: event.target.value }))
                  }
                >
                  <option value="">Select category</option>
                  {productCategoryOptions.map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </select>
              </label>

              <label className="setup-field">
                <span className="control-label">Size</span>
                <input
                  className="input-shell"
                  value={formState.size}
                  onChange={(event) =>
                    setFormState((current) => ({ ...current, size: event.target.value }))
                  }
                  placeholder="Standard full-size canopy"
                />
              </label>
            </div>

            <label className="setup-field">
              <span className="control-label">Description</span>
              <textarea
                className="textarea-shell"
                value={formState.description}
                onChange={(event) =>
                  setFormState((current) => ({ ...current, description: event.target.value }))
                }
                rows={4}
                placeholder="Describe the product and how the template should be used."
              />
            </label>

            <section className="setup-section">
              <div className="setup-section-head">
                <div>
                  <p className="panel-kicker">Description fields</p>
                  <h3 className="section-title">Specifications</h3>
                </div>
                <button
                  type="button"
                  className="secondary-link-button"
                  onClick={() =>
                    setFormState((current) => ({
                      ...current,
                      specifications: [...current.specifications, { label: "", value: "" }]
                    }))
                  }
                >
                  Add specification
                </button>
              </div>
              <div className="repeater-grid">
                {formState.specifications.map((specification, index) => (
                  <div key={`spec-${index}`} className="repeater-row">
                    <input
                      className="input-shell"
                      value={specification.label}
                      onChange={(event) =>
                        setFormState((current) => ({
                          ...current,
                          specifications: current.specifications.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, label: event.target.value } : item
                          )
                        }))
                      }
                      placeholder="Label, e.g. Size"
                    />
                    <input
                      className="input-shell"
                      value={specification.value}
                      onChange={(event) =>
                        setFormState((current) => ({
                          ...current,
                          specifications: current.specifications.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, value: event.target.value } : item
                          )
                        }))
                      }
                      placeholder="Value, e.g. 27 inch canopy"
                    />
                    <button
                      type="button"
                      className="secondary-link-button"
                      onClick={() =>
                        setFormState((current) => ({
                          ...current,
                          specifications:
                            current.specifications.length > 1
                              ? current.specifications.filter((_, itemIndex) => itemIndex !== index)
                              : [{ label: "", value: "" }]
                        }))
                      }
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            </section>

            <section className="setup-section">
              <div className="setup-section-head">
                <div>
                  <p className="panel-kicker">Color controls</p>
                  <h3 className="section-title">Recolorable parts</h3>
                  <p className="fine-print">
                    Add the exact cue used in the instruction image, such as a mask color,
                    callout label, or highlighted region name.
                  </p>
                </div>
                <button
                  type="button"
                  className="secondary-link-button"
                  onClick={() =>
                    setFormState((current) => ({
                      ...current,
                      colorParts: [
                        ...current.colorParts,
                        createDraftPart(current.colorParts.length + 1)
                      ]
                    }))
                  }
                >
                  Add part
                </button>
              </div>
              <div className="part-stack">
                {formState.colorParts.map((part, index) => (
                  <div key={part.id || `part-${index}`} className="part-card">
                    <div className="field-grid">
                      <label className="setup-field">
                        <span className="control-label">Part label</span>
                        <input
                          className="input-shell"
                          value={part.label}
                          onChange={(event) =>
                            setFormState((current) => ({
                              ...current,
                              colorParts: current.colorParts.map((item, itemIndex) =>
                                itemIndex === index
                                  ? { ...item, label: event.target.value }
                                  : item
                              )
                            }))
                          }
                          placeholder="Part 1"
                        />
                      </label>

                      <label className="setup-field">
                        <span className="control-label">Default Pantone</span>
                        <input
                          className="input-shell"
                          value={part.defaultPantoneCode || ""}
                          onChange={(event) =>
                            setFormState((current) => ({
                              ...current,
                              colorParts: current.colorParts.map((item, itemIndex) =>
                                itemIndex === index
                                  ? { ...item, defaultPantoneCode: event.target.value }
                                  : item
                              )
                            }))
                          }
                          placeholder="Black"
                        />
                      </label>
                    </div>

                    <label className="setup-field">
                      <span className="control-label">Product area</span>
                      <textarea
                        className="textarea-shell"
                        value={part.description}
                        onChange={(event) =>
                          setFormState((current) => ({
                            ...current,
                            colorParts: current.colorParts.map((item, itemIndex) =>
                              itemIndex === index
                                ? { ...item, description: event.target.value }
                                : item
                            )
                          }))
                        }
                        rows={3}
                        placeholder="Describe the real product area, e.g. Bottom bottle body"
                      />
                    </label>

                    <div className="field-grid">
                      <label className="setup-field">
                        <span className="control-label">Instruction cue</span>
                        <input
                          className="input-shell"
                          value={part.instructionCue || ""}
                          onChange={(event) =>
                            setFormState((current) => ({
                              ...current,
                              colorParts: current.colorParts.map((item, itemIndex) =>
                                itemIndex === index
                                  ? { ...item, instructionCue: event.target.value }
                                  : item
                              )
                            }))
                          }
                          placeholder="Blue lower bottle region"
                        />
                      </label>

                      <label className="setup-field">
                        <span className="control-label">Instruction overlay color</span>
                        <input
                          className="input-shell"
                          value={part.instructionColorHex || ""}
                          onChange={(event) =>
                            setFormState((current) => ({
                              ...current,
                              colorParts: current.colorParts.map((item, itemIndex) =>
                                itemIndex === index
                                  ? { ...item, instructionColorHex: event.target.value }
                                  : item
                              )
                            }))
                          }
                          placeholder="#1450FF"
                        />
                      </label>

                      <label className="setup-field">
                        <span className="control-label">Part reference image file</span>
                        <input
                          className="input-shell"
                          value={part.partMaskImageFileName || ""}
                          onChange={(event) =>
                            setFormState((current) => ({
                              ...current,
                              colorParts: current.colorParts.map((item, itemIndex) =>
                                itemIndex === index
                                  ? { ...item, partMaskImageFileName: event.target.value }
                                  : item
                              )
                            }))
                          }
                          placeholder="layered/part-1-mask.png"
                        />
                      </label>
                    </div>
                    <p className="fine-print">
                      Optional. Add a per-part reference or mask image stored in
                      {` `}
                      <code>{`/public/mockup-templates/${formState.slug || "<slug>"}/`}</code>
                      {` `}
                      for local layered coloring and isolated part references.
                    </p>
                    <div className="setup-inline-actions">
                      <label className="secondary-link-button" htmlFor={`partMaskUpload-${part.id}`}>
                        Upload part reference
                      </label>
                      <input
                        id={`partMaskUpload-${part.id}`}
                        type="file"
                        accept=".png,.jpg,.jpeg,.webp"
                        hidden
                        onChange={(event) => {
                          const file = event.target.files?.[0] || null;
                          handlePartMaskFileChange(part.id, file);
                          event.currentTarget.value = "";
                        }}
                      />
                      {partMaskFiles[part.id] ? (
                        <button
                          type="button"
                          className="secondary-link-button"
                          onClick={() => handlePartMaskFileChange(part.id, null)}
                        >
                          Clear pending reference
                        </button>
                      ) : null}
                    </div>
                    {partMaskFiles[part.id] ? (
                      <p className="fine-print">
                        Pending reference upload: {partMaskFiles[part.id]?.name}
                      </p>
                    ) : part.partMaskImageFileName ? (
                      <p className="fine-print">
                        Current reference asset: {part.partMaskImageFileName}
                      </p>
                    ) : null}

                    <div className="setup-subsection">
                      <div className="setup-subsection-head">
                        <div>
                          <span className="control-label">Material finish options</span>
                          <p className="fine-print">
                            Turn on only the finishes that this exact product part can offer.
                          </p>
                        </div>
                      </div>

                      <div className="quick-choice-row" aria-label={`${part.label} finish options`}>
                        {productFinishOptions.map((finish) => {
                          const isActive = part.allowedFinishes?.includes(finish) || false;

                          return (
                            <button
                              key={`${part.id}-${finish}`}
                              type="button"
                              className={`quick-choice-button${isActive ? " is-active" : ""}`}
                              onClick={() =>
                                setFormState((current) => ({
                                  ...current,
                                  colorParts: updatePartAtIndex(current.colorParts, index, (item) =>
                                    toggleFinishOption(item, finish)
                                  )
                                }))
                              }
                            >
                              {productFinishLabels[finish]}
                            </button>
                          );
                        })}
                      </div>

                      {part.allowedFinishes?.length ? (
                        <div className="finish-order-panel">
                          <span className="control-label">Material finish display order</span>
                          <div
                            className="finish-order-list"
                            aria-label={`${part.label} material finish display order`}
                          >
                            {part.allowedFinishes.map((finish, finishIndex) => (
                              <button
                                key={`${part.id}-order-${finish}`}
                                type="button"
                                className={`finish-order-item${
                                  draggedFinishOrder?.partId === part.id &&
                                  draggedFinishOrder.finish === finish
                                    ? " is-dragging"
                                    : ""
                                }`}
                                draggable
                                onDragStart={(event) => {
                                  setDraggedFinishOrder({ partId: part.id, finish });
                                  event.dataTransfer.effectAllowed = "move";
                                  event.dataTransfer.setData("text/plain", finish);
                                }}
                                onDragOver={(event) => {
                                  event.preventDefault();
                                  event.dataTransfer.dropEffect = "move";
                                }}
                                onDrop={(event) => {
                                  event.preventDefault();
                                  const source = draggedFinishOrder;
                                  if (!source || source.partId !== part.id) return;

                                  const fromIndex = part.allowedFinishes?.indexOf(source.finish) ?? -1;
                                  if (fromIndex < 0 || fromIndex === finishIndex) return;

                                  setFormState((current) => ({
                                    ...current,
                                    colorParts: updatePartAtIndex(current.colorParts, index, (item) =>
                                      moveFinishOption(item, fromIndex, finishIndex)
                                    )
                                  }));
                                  setDraggedFinishOrder(null);
                                }}
                                onDragEnd={() => setDraggedFinishOrder(null)}
                              >
                                <span className="finish-order-grip" aria-hidden="true">
                                  grip
                                </span>
                                <span className="finish-order-index">{finishIndex + 1}</span>
                                <span>{productFinishLabels[finish]}</span>
                              </button>
                            ))}
                          </div>
                          <p className="fine-print">
                            Drag finishes to control how they appear in the product Configuration
                            panel.
                          </p>
                        </div>
                      ) : null}

                      {part.allowedFinishes?.length ? (
                        <label className="setup-field finish-default-field">
                          <span className="control-label">Default finish</span>
                          <select
                            className="input-shell"
                            value={part.defaultFinish || resolvePartDefaultFinish(part) || ""}
                            onChange={(event) =>
                              setFormState((current) => ({
                                ...current,
                                colorParts: updatePartAtIndex(current.colorParts, index, (item) => ({
                                  ...item,
                                  defaultFinish: (event.target.value || undefined) as
                                    | ProductFinishOption
                                    | undefined
                                }))
                              }))
                            }
                          >
                            <option value="">Select default finish</option>
                            {part.allowedFinishes.map((finish) => (
                              <option key={`${part.id}-default-${finish}`} value={finish}>
                                {productFinishLabels[finish]}
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : null}
                    </div>

                    <div className="setup-subsection">
                      <div className="setup-subsection-head">
                        <div>
                          <span className="control-label">Part indicators</span>
                          <p className="fine-print">
                            Add 1 to 3 arrow targets for the big preview image. Use percentages so
                            the callouts stay aligned responsively.
                          </p>
                        </div>
                        <div className="setup-inline-actions">
                          <button
                            type="button"
                            className="secondary-link-button"
                            onClick={() => handleCopyPartIndicators(part)}
                          >
                            Copy part JSON
                          </button>
                          <button
                            type="button"
                            className="secondary-link-button"
                            disabled={(part.indicatorAnchors?.length || 0) >= 3}
                            onClick={() =>
                              setFormState((current) => ({
                                ...current,
                                colorParts: updatePartAtIndex(current.colorParts, index, (item) => ({
                                  ...item,
                                  indicatorAnchors: [
                                    ...(item.indicatorAnchors || []),
                                    createDraftIndicatorAnchor(
                                      index + 1,
                                      (item.indicatorAnchors?.length || 0) + 1
                                    )
                                  ]
                                }))
                              }))
                            }
                          >
                            Add indicator
                          </button>
                        </div>
                      </div>

                      <PartIndicatorVisualEditor
                        part={part}
                        previewImageUrl={baseImagePreviewUrl}
                        onAnchorChange={(anchorIndex, next) =>
                          updateIndicatorAnchorField(index, anchorIndex, next)
                        }
                      />

                    </div>

                    <button
                      type="button"
                      className="secondary-link-button"
                      onClick={() =>
                        setFormState((current) => ({
                          ...current,
                          colorParts:
                            current.colorParts.length > 1
                              ? current.colorParts.filter((_, itemIndex) => itemIndex !== index)
                              : current.colorParts
                        }))
                      }
                    >
                      Remove part
                    </button>
                  </div>
                ))}
              </div>
            </section>

            <section className="setup-section">
              <p className="panel-kicker">Assets</p>
              <h3 className="section-title">Product image and instruction image</h3>
              <div className="asset-upload-grid">
                <label className="setup-field">
                  <span className="control-label">Product image</span>
                  {baseImagePreviewUrl ? (
                    <div className="catalog-image-frame compact-frame">
                      <img src={baseImagePreviewUrl} alt="Current product asset" />
                    </div>
                  ) : null}
                  <input
                    className="input-shell"
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={(event) =>
                      setFormState((current) => ({
                        ...current,
                        baseImageFile: event.target.files?.[0] || null
                      }))
                    }
                  />
                  {formState.baseImageFile ? (
                    <p className="fine-print">Pending file: {formState.baseImageFile.name}</p>
                  ) : null}
                </label>

                <label className="setup-field">
                  <span className="control-label">Instruction image</span>
                  {instructionImagePreviewUrl ? (
                    <div className="catalog-image-frame compact-frame">
                      <img src={instructionImagePreviewUrl} alt="Current instruction asset" />
                    </div>
                  ) : null}
                  <input
                    className="input-shell"
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={(event) =>
                      setFormState((current) => ({
                        ...current,
                        instructionImageFile: event.target.files?.[0] || null
                      }))
                    }
                  />
                  {formState.instructionImageFile ? (
                    <p className="fine-print">
                      Pending file: {formState.instructionImageFile.name}
                    </p>
                  ) : null}
                </label>
              </div>

              <div className="setup-subsection">
                <div className="setup-subsection-head">
                  <div>
                    <span className="control-label">Logo printing area and orientation</span>
                    <p className="fine-print">
                      Upload red-mask printing area images per printing method. Multiple red
                      islands are supported; the mockup page keeps the logo inside the selected
                      area.
                    </p>
                  </div>
                </div>

                <label className="setup-field">
                  <span className="control-label">Logo orientation preset</span>
                  <select
                    className="input-shell"
                    value={formState.logoOrientationPreset}
                    onChange={(event) =>
                      setFormState((current) => ({
                        ...current,
                        logoOrientationPreset: event.target.value as LogoOrientationPreset
                      }))
                    }
                  >
                    <option value="horizontal">Horizontal</option>
                    <option value="vertical">Vertical</option>
                  </select>
                  <p className="fine-print">
                    New uploaded logos auto-rotate to this orientation before fitting into the
                    printing area.
                  </p>
                </label>

                <div className="asset-upload-grid">
                  {logoPrintingMethods.map((method) => (
                    <PrintingAreaAssetField
                      key={`printing-area-${method}`}
                      method={method}
                      currentUrl={formState.logoPrintingAreaImages[method] || ""}
                      pendingFile={printingAreaFiles[method] || null}
                      onFileChange={(file) => handlePrintingAreaFileChange(method, file)}
                    />
                  ))}
                </div>
              </div>

              <div className="setup-subsection">
                <div className="setup-subsection-head">
                  <div>
                    <span className="control-label">Local layered renderer</span>
                    <p className="fine-print">
                      Upload neutral material bases and part references to use the same local coloring
                      system as BND62.
                    </p>
                  </div>
                  <label className="setup-toggle">
                    <input
                      type="checkbox"
                      checked={formState.layeredRenderEnabled}
                      onChange={(event) =>
                        setFormState((current) => ({
                          ...current,
                          layeredRenderEnabled: event.target.checked
                        }))
                      }
                    />
                    <span>Enable</span>
                  </label>
                </div>

                <div className="field-grid">
                  <label className="setup-field">
                    <span className="control-label">Fallback material</span>
                    <select
                      className="input-shell"
                      value={formState.layeredFallbackFinish}
                      onChange={(event) =>
                        setFormState((current) => ({
                          ...current,
                          layeredFallbackFinish: event.target.value as ProductFinishOption
                        }))
                      }
                    >
                      {productFinishOptions.map((finish) => (
                        <option key={`fallback-${finish}`} value={finish}>
                          {productFinishLabels[finish]}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="setup-field">
                    <span className="control-label">Output width</span>
                    <input
                      className="input-shell"
                      type="number"
                      min="1"
                      step="1"
                      value={formState.layeredOutputWidth}
                      onChange={(event) =>
                        setFormState((current) => ({
                          ...current,
                          layeredOutputWidth: event.target.value
                        }))
                      }
                      placeholder="Use base image width"
                    />
                  </label>

                  <label className="setup-field">
                    <span className="control-label">Output height</span>
                    <input
                      className="input-shell"
                      type="number"
                      min="1"
                      step="1"
                      value={formState.layeredOutputHeight}
                      onChange={(event) =>
                        setFormState((current) => ({
                          ...current,
                          layeredOutputHeight: event.target.value
                        }))
                      }
                      placeholder="Use base image height"
                    />
                  </label>
                </div>

                <div className="asset-upload-grid">
                  {activeMaterialFinishes.map((finish) => {
                    const rule = {
                      ...defaultLayeredFinishRules[finish],
                      ...(formState.layeredFinishRules[finish] || {})
                    };

                    return (
                      <article className="material-instance-card" key={`finish-base-${finish}`}>
                        <FinishBaseAssetField
                          finish={finish}
                          currentUrl={formState.layeredFinishBaseImages[finish] || ""}
                          pendingFile={finishBaseFiles[finish] || null}
                          onFileChange={(file) => handleFinishBaseFileChange(finish, file)}
                        />
                        <MaterialCalibrationFields
                          finish={finish}
                          rule={rule}
                          onChange={(key, value) =>
                            handleFinishRuleChange(finish, key, value)
                          }
                        />
                        <MaterialMapAssetFields
                          finish={finish}
                          currentMaps={formState.layeredMaterialMaps[finish] || {}}
                          pendingFiles={materialMapFiles[finish] || {}}
                          onFileChange={(key, file) =>
                            handleMaterialMapFileChange(finish, key, file)
                          }
                          onRemove={(key) => handleMaterialMapRemove(finish, key)}
                        />
                      </article>
                    );
                  })}
                </div>
              </div>
            </section>

            <div className="setup-footer">
              {saveError ? <p className="alert-error inline-alert">{saveError}</p> : null}
              {saveMessage ? <p className="success-message">{saveMessage}</p> : null}
              <div
                className={`online-publish-note${
                  onlineConfiguration?.configured ? " is-ready" : ""
                }`}
              >
                <strong>
                  {onlineConfiguration?.configured
                    ? "Supabase online publishing ready"
                    : "Supabase online publishing not configured"}
                </strong>
                <span>
                  {onlineConfiguration?.configured
                    ? `Publishes the current local preview release to ${onlineConfiguration.bucket}.`
                    : onlineConfiguration
                      ? `Missing: ${onlineConfiguration.missing.join(", ")}.`
                      : "Checking local Supabase configuration..."}
                </span>
              </div>
              {selectedLocalProduct?.releases[0]?.warnings.length ? (
                <div className="local-quality-notes">
                  <strong>Quality notes for v{selectedLocalProduct.releases[0].version}</strong>
                  <ul>
                    {selectedLocalProduct.releases[0].warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <div className="setup-footer-actions">
                {formState.slug ? (
                  <Link
                    href={`/mockup?slug=${encodeURIComponent(formState.slug)}&preview=latest`}
                    className="secondary-link-button"
                  >
                    Preview latest
                  </Link>
                ) : null}
                <button
                  className="secondary-link-button"
                  type="button"
                  disabled={isSaving || isPublishingOnline || !canSaveTemplate}
                  title="Validate and publish a release for localhost preview"
                  onClick={() => handleLocalTemplateSave("published")}
                >
                  {isSaving ? "Working..." : "Publish to local preview"}
                </button>
                <button
                  className="secondary-link-button"
                  type="submit"
                  disabled={isSaving || isPublishingOnline || !canSaveTemplate}
                  title="Validate and save an immutable local draft"
                >
                  {isSaving ? "Working..." : "Save draft"}
                </button>
                <button
                  className="button-primary"
                  type="button"
                  disabled={
                    isSaving ||
                    isPublishingOnline ||
                    !canSaveTemplate ||
                    !canPublishOnline
                  }
                  title={
                    canPublishOnline
                      ? "Publish the current local preview release to Supabase"
                      : "Publish a local preview release and configure Supabase first"
                  }
                  onClick={handleOnlinePublish}
                >
                  {isPublishingOnline ? "Publishing online..." : "Publish online"}
                </button>
              </div>
            </div>
          </form>
        </section>
      </div>
    </main>
  );
}
