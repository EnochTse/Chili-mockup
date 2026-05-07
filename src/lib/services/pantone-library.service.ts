import { z } from "zod";
import pantoneSolidCoatedV3 from "@/lib/pantone/pantone-solid-coated-v3.json";
import { AppError } from "@/lib/errors";
import type { PantoneOption } from "@/lib/types";

const libraryIdPattern = /^[a-z0-9][a-z0-9-]*$/;

const pantoneOptionSchema = z.object({
  code: z.string().min(1),
  label: z.string().min(1),
  previewHex: z.string().regex(/^#[0-9a-fA-F]{6}$/)
});

const pantoneLibrarySchema = z.object({
  id: z.string().regex(libraryIdPattern),
  name: z.string().min(1),
  sourceFileName: z.string().min(1),
  sourceColorModel: z.literal("Lab"),
  colorCount: z.number().int().positive(),
  colors: z.array(pantoneOptionSchema).min(1)
});

const pantoneLibraries: Record<string, unknown> = {
  "pantone-solid-coated-v3": pantoneSolidCoatedV3
};

const parsedLibraries = new Map<string, PantoneOption[]>();

export function loadPantoneLibrary(libraryId: string): PantoneOption[] {
  if (!libraryIdPattern.test(libraryId)) {
    throw new AppError("PRODUCT_TEMPLATE_NOT_FOUND", "The product template could not be found.", 404);
  }

  if (parsedLibraries.has(libraryId)) {
    return parsedLibraries.get(libraryId)!;
  }

  const rawLibrary = pantoneLibraries[libraryId];
  if (!rawLibrary) {
    throw new AppError("PRODUCT_TEMPLATE_NOT_FOUND", "The product template could not be found.", 404);
  }

  const library = pantoneLibrarySchema.parse(rawLibrary);
  if (library.id !== libraryId || library.colorCount !== library.colors.length) {
    throw new AppError("PRODUCT_TEMPLATE_NOT_FOUND", "The product template could not be found.", 404);
  }

  parsedLibraries.set(libraryId, library.colors);
  return library.colors;
}
