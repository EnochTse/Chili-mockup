import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { loadPantoneLibrary } from "@/lib/services/pantone-library.service";
import type { TemplatePublicDto, TemplateSummaryDto } from "@/lib/types";
import { parseTemplatePublicDto } from "@/lib/validators/template-public.validator";

type LiveTemplateRow = {
  id: string;
  slug: string;
  version: number;
  status: "published";
  template: LiveTemplatePayload;
  updated_at: string | null;
};

type LiveTemplatePayload = Omit<TemplatePublicDto, "pantoneOptions"> & {
  pantoneOptions?: TemplatePublicDto["pantoneOptions"];
  pantoneLibrary?: string;
};

const summaryPayloadSchema = z.object({
  id: z.string().min(1),
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  name: z.string().min(1),
  category: z.string().min(1),
  description: z.string().min(1),
  size: z.string().optional(),
  baseImageUrl: z.string().min(1),
  instructionImageUrl: z.string().min(1)
});

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const supabasePublishableKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

let supabaseClient: SupabaseClient | null = null;

export function isLiveTemplateDatabaseConfigured() {
  return Boolean(supabaseUrl && supabasePublishableKey);
}

function getLiveSupabaseClient() {
  if (!supabaseUrl || !supabasePublishableKey) {
    throw new Error(
      "Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY."
    );
  }

  if (!supabaseClient) {
    supabaseClient = createClient(supabaseUrl, supabasePublishableKey);
  }

  return supabaseClient;
}

function hydratePublishedTemplate(
  payload: LiveTemplatePayload,
  fallbackTemplate?: TemplatePublicDto
) {
  const pantoneOptions =
    payload.pantoneOptions?.length
      ? payload.pantoneOptions
      : fallbackTemplate?.pantoneOptions?.length
        ? fallbackTemplate.pantoneOptions
        : loadPantoneLibrary(payload.pantoneLibrary || "pantone-solid-coated-v3");

  return parseTemplatePublicDto({
    ...payload,
    pantoneOptions
  });
}

function toTemplateSummaryDto(payload: LiveTemplatePayload): TemplateSummaryDto {
  const template = summaryPayloadSchema.parse(payload);
  return {
    id: template.id,
    slug: template.slug,
    name: template.name,
    category: template.category,
    description: template.description,
    size: template.size,
    baseImageUrl: template.baseImageUrl,
    instructionImageUrl: template.instructionImageUrl
  };
}

function collectPublishedTemplateSummaries(
  rows: LiveTemplateRow[] | null,
  fallbackSummaries: TemplateSummaryDto[] = []
) {
  const summariesBySlug = new Map(fallbackSummaries.map((template) => [template.slug, template]));
  const seenLiveSlugs = new Set<string>();

  for (const row of rows || []) {
    if (seenLiveSlugs.has(row.slug)) continue;
    seenLiveSlugs.add(row.slug);
    summariesBySlug.set(row.slug, toTemplateSummaryDto(row.template));
  }

  return Array.from(summariesBySlug.values()).sort((left, right) =>
    left.name.localeCompare(right.name)
  );
}

export async function listPublishedLiveTemplateSummaries(
  fallbackSummaries: TemplateSummaryDto[] = []
) {
  if (!isLiveTemplateDatabaseConfigured()) return fallbackSummaries;

  const client = getLiveSupabaseClient();
  const { data, error } = await client
    .from("product_template_versions")
    .select("id, slug, version, status, template, updated_at")
    .eq("status", "published")
    .order("version", { ascending: false });

  if (error) {
    throw new Error(`Failed to load published live templates: ${error.message}`);
  }

  return collectPublishedTemplateSummaries(data as LiveTemplateRow[] | null, fallbackSummaries);
}

export async function getPublishedLiveTemplate(
  slug: string,
  fallbackTemplate?: TemplatePublicDto
) {
  if (!isLiveTemplateDatabaseConfigured()) return null;

  const client = getLiveSupabaseClient();
  const { data, error } = await client
    .from("product_template_versions")
    .select("id, slug, version, status, template, updated_at")
    .eq("slug", slug)
    .eq("status", "published")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load published live template: ${error.message}`);
  }
  if (!data) return null;

  return hydratePublishedTemplate((data as LiveTemplateRow).template, fallbackTemplate);
}
