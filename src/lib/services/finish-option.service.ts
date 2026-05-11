import type { ProductFinishOption } from "@/lib/types";

export const productFinishOptions = [
  "matte",
  "glossy",
  "rubber",
  "metallic"
] as const satisfies readonly ProductFinishOption[];

export const productFinishLabels: Record<ProductFinishOption, string> = {
  matte: "Matte",
  glossy: "Glossy",
  rubber: "Rubber",
  metallic: "Metallic"
};

type PartFinishConfig = {
  allowedFinishes?: unknown;
  defaultFinish?: unknown;
};

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
