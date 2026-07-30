import type {
  LayeredRenderFinishRule,
  ProductFinishOption
} from "@/lib/types";

export const productFinishOptions = [
  "matte",
  "glossy",
  "rubber",
  "metallic",
  "chrome"
] as const satisfies readonly ProductFinishOption[];

export const productFinishLabels: Record<ProductFinishOption, string> = {
  matte: "Matte",
  glossy: "Glossy",
  rubber: "Rubber",
  metallic: "Metallic",
  chrome: "Chrome"
};

export const defaultLayeredFinishRules: Record<
  ProductFinishOption,
  LayeredRenderFinishRule
> = {
  matte: {
    colorOpacity: 0.98,
    blendMode: "source-over",
    highlightProtection: 0.14,
    textureStrength: 0.18,
    saturationBoost: 0.05
  },
  glossy: {
    colorOpacity: 0.97,
    blendMode: "source-over",
    highlightProtection: 0.28,
    textureStrength: 0.18,
    saturationBoost: 0.08
  },
  rubber: {
    colorOpacity: 0.98,
    blendMode: "source-over",
    highlightProtection: 0.2,
    textureStrength: 0.18,
    saturationBoost: 0.06
  },
  metallic: {
    colorOpacity: 0.96,
    blendMode: "source-over",
    highlightProtection: 0.34,
    textureStrength: 0.2,
    saturationBoost: 0.04
  },
  chrome: {
    colorOpacity: 0.16,
    blendMode: "source-over",
    highlightProtection: 0.72,
    textureStrength: 0.34,
    saturationBoost: 0
  }
};

export const colorLockedFinishOptions = ["chrome"] as const satisfies readonly ProductFinishOption[];
const colorLockedFinishSet: readonly ProductFinishOption[] = colorLockedFinishOptions;

type PartFinishConfig = {
  allowedFinishes?: unknown;
  defaultFinish?: unknown;
};

export function isColorLockedFinish(finish: ProductFinishOption | undefined) {
  return Boolean(finish && colorLockedFinishSet.includes(finish));
}

export function normalizeProductFinishOption(value: unknown): ProductFinishOption | undefined {
  if (typeof value !== "string") return undefined;

  const normalized = value.trim().toLowerCase();
  return productFinishOptions.find((option) => option === normalized);
}

export function sanitizeAllowedFinishes(values: unknown): ProductFinishOption[] | undefined {
  if (!Array.isArray(values)) return undefined;

  const unique = Array.from(
    new Set(values.map((value) => normalizeProductFinishOption(value)).filter(Boolean))
  ) as ProductFinishOption[];

  return unique.length ? unique : undefined;
}

export function resolvePartDefaultFinish(part: PartFinishConfig): ProductFinishOption | undefined {
  const allowed = sanitizeAllowedFinishes(part.allowedFinishes);
  if (!allowed?.length) return undefined;

  const normalizedDefault = normalizeProductFinishOption(part.defaultFinish);
  if (normalizedDefault && allowed.includes(normalizedDefault)) {
    return normalizedDefault;
  }

  return allowed[0];
}

export function resolvePartFinishSelection(
  part: PartFinishConfig,
  selectedValue: unknown
): ProductFinishOption | undefined {
  const allowed = sanitizeAllowedFinishes(part.allowedFinishes);
  if (!allowed?.length) return undefined;

  const normalizedSelected = normalizeProductFinishOption(selectedValue);
  if (normalizedSelected && allowed.includes(normalizedSelected)) {
    return normalizedSelected;
  }

  return resolvePartDefaultFinish({ ...part, allowedFinishes: allowed });
}
