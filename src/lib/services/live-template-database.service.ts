import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { TemplatePublicDto } from "@/lib/types";

type LiveTemplateStatus = "draft" | "published";

type LiveTemplateRow = {
  id: string;
  slug: string;
  version: number;
  status: LiveTemplateStatus | "archived";
  template: LiveTemplatePayload;
  updated_at: string | null;
};

type LiveTemplatePayload = Omit<TemplatePublicDto, "pantoneOptions"> & {
  pantoneOptions?: TemplatePublicDto["pantoneOptions"];
};

type LiveSaveResult = {
  id: string;
  version: number;
  status: LiveTemplateStatus;
  template: TemplatePublicDto;
};

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

let supabaseClient: SupabaseClient | null = null;

export function isLiveTemplateDatabaseConfigured() {
  return Boolean(supabaseUrl && supabaseAnonKey);
}

function getSupabaseClient() {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY."
    );
  }

  if (!supabaseClient) {
    supabaseClient = createClient(supabaseUrl, supabaseAnonKey);
  }

  return supabaseClient;
}

function compactTemplateForDatabase(template: TemplatePublicDto): LiveTemplatePayload {
  const { pantoneOptions: _pantoneOptions, ...templateWithoutPantones } = template;
  return templateWithoutPantones;
}

function hydrateLiveTemplate(
  payload: LiveTemplatePayload,
  fallbackTemplate?: TemplatePublicDto
): TemplatePublicDto {
  return {
    ...payload,
    pantoneOptions: payload.pantoneOptions || fallbackTemplate?.pantoneOptions || []
  };
}

function buildFallbackMap(fallbackTemplates: TemplatePublicDto[] = []) {
  return new Map(fallbackTemplates.map((template) => [template.slug, template]));
}

function collectLatestTemplates(
  rows: LiveTemplateRow[] | null,
  fallbackTemplates: TemplatePublicDto[] = []
) {
  const fallbackBySlug = buildFallbackMap(fallbackTemplates);
  const templatesBySlug = new Map<string, TemplatePublicDto>();

  for (const row of rows || []) {
    if (templatesBySlug.has(row.slug)) continue;
    templatesBySlug.set(row.slug, hydrateLiveTemplate(row.template, fallbackBySlug.get(row.slug)));
  }

  return Array.from(templatesBySlug.values()).sort((left, right) =>
    left.name.localeCompare(right.name)
  );
}

export async function listLatestLiveTemplates(fallbackTemplates: TemplatePublicDto[] = []) {
  if (!isLiveTemplateDatabaseConfigured()) return [];

  const client = getSupabaseClient();
  const { data, error } = await client
    .from("product_template_versions")
    .select("id, slug, version, status, template, updated_at")
    .in("status", ["draft", "published"])
    .order("version", { ascending: false });

  if (error) {
    throw new Error(`Failed to load live templates: ${error.message}`);
  }

  return collectLatestTemplates(data as LiveTemplateRow[] | null, fallbackTemplates);
}

export async function getPublishedLiveTemplate(
  slug: string,
  fallbackTemplate?: TemplatePublicDto
) {
  if (!isLiveTemplateDatabaseConfigured()) return null;

  const client = getSupabaseClient();
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

  const row = data as LiveTemplateRow;
  return hydrateLiveTemplate(row.template, fallbackTemplate);
}

async function getNextVersion(client: SupabaseClient, slug: string) {
  const { data, error } = await client
    .from("product_template_versions")
    .select("version")
    .eq("slug", slug)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to reserve live template version: ${error.message}`);
  }

  return ((data as { version?: number } | null)?.version || 0) + 1;
}

export async function saveLiveTemplateVersion(
  template: TemplatePublicDto,
  status: LiveTemplateStatus
): Promise<LiveSaveResult> {
  if (!template.slug) {
    throw new Error("A product slug is required before saving to Supabase.");
  }

  const client = getSupabaseClient();
  const updatedAt = new Date().toISOString();

  const { error: templateError } = await client.from("product_templates").upsert(
    {
      slug: template.slug,
      name: template.name,
      category: template.category,
      updated_at: updatedAt
    },
    { onConflict: "slug" }
  );

  if (templateError) {
    throw new Error(`Failed to save product template row: ${templateError.message}`);
  }

  const version = await getNextVersion(client, template.slug);
  const { data: versionRow, error: versionError } = await client
    .from("product_template_versions")
    .insert({
      slug: template.slug,
      version,
      status,
      template: compactTemplateForDatabase(template),
      updated_at: updatedAt
    })
    .select("id, version, status")
    .single();

  if (versionError) {
    throw new Error(`Failed to save live template version: ${versionError.message}`);
  }

  const savedVersion = versionRow as { id: string; version: number; status: LiveTemplateStatus };

  if (status === "published") {
    const { error: publishError } = await client
      .from("product_templates")
      .update({
        published_version_id: savedVersion.id,
        updated_at: updatedAt
      })
      .eq("slug", template.slug);

    if (publishError) {
      throw new Error(`Failed to publish live template: ${publishError.message}`);
    }

    await client
      .from("product_template_versions")
      .update({
        status: "archived",
        updated_at: updatedAt
      })
      .eq("slug", template.slug)
      .eq("status", "published")
      .neq("id", savedVersion.id);
  }

  return {
    id: savedVersion.id,
    version: savedVersion.version,
    status,
    template
  };
}
