import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { AppError } from "@/lib/errors";
import { parseLocalBlobReference } from "@/lib/local-library/asset-reference";
import type {
  OnlinePublishConfiguration,
  OnlinePublishResult
} from "@/lib/local-library/types";
import {
  getPublishedLocalReleaseManifest,
  readLocalBlob,
  recordOnlinePublication
} from "@/lib/services/local-library.service";
import type { TemplatePublicDto } from "@/lib/types";
import { parseTemplatePublicDto } from "@/lib/validators/template-public.validator";

const defaultBucket = "mockup-assets";
const defaultPantoneLibrary = "pantone-solid-coated-v3";
const bucketPattern = /^[a-z0-9][a-z0-9._-]*$/;
const uploadConcurrency = 4;

type OnlineTemplatePayload = Omit<TemplatePublicDto, "pantoneOptions"> & {
  pantoneLibrary: typeof defaultPantoneLibrary;
};

type PublishedVersionRow = {
  id: string;
  version: number;
  status: "published";
  published_at: string;
};

function getSupabaseUrl() {
  return process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || "";
}

function getSupabasePublishableKey() {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ||
    ""
  );
}

function getSupabaseSecretKey() {
  return (
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    ""
  );
}

function getStorageBucket() {
  const bucket =
    process.env.NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET?.trim() || defaultBucket;
  return bucketPattern.test(bucket) ? bucket : defaultBucket;
}

export function getOnlinePublishConfiguration(): OnlinePublishConfiguration {
  const missing: string[] = [];
  if (!getSupabaseUrl()) missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!getSupabasePublishableKey()) {
    missing.push("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  }
  if (!getSupabaseSecretKey()) missing.push("SUPABASE_SECRET_KEY");

  return {
    configured: missing.length === 0,
    bucket: getStorageBucket(),
    missing
  };
}

function getAdminClient() {
  const configuration = getOnlinePublishConfiguration();
  if (!configuration.configured) {
    throw new AppError(
      "ONLINE_PUBLISH_NOT_CONFIGURED",
      `Online publishing needs ${configuration.missing.join(", ")} in .env.local.`,
      503
    );
  }

  return createClient(getSupabaseUrl(), getSupabaseSecretKey(), {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  });
}

function remapAssetReferences(
  value: unknown,
  referenceMap: ReadonlyMap<string, string>
): unknown {
  if (typeof value === "string") {
    return referenceMap.get(value) || value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => remapAssetReferences(entry, referenceMap));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        remapAssetReferences(entry, referenceMap)
      ])
    );
  }
  return value;
}

function findLocalAssetReferences(value: unknown, references = new Set<string>()) {
  if (typeof value === "string") {
    if (parseLocalBlobReference(value)) references.add(value);
    return references;
  }
  if (Array.isArray(value)) {
    for (const entry of value) findLocalAssetReferences(entry, references);
    return references;
  }
  if (value && typeof value === "object") {
    for (const entry of Object.values(value)) {
      findLocalAssetReferences(entry, references);
    }
  }
  return references;
}

export function buildOnlineTemplatePayload(
  template: TemplatePublicDto,
  assetUrls: ReadonlyMap<string, string>
): OnlineTemplatePayload {
  const remapped = remapAssetReferences(template, assetUrls);
  const unresolved = Array.from(findLocalAssetReferences(remapped));
  if (unresolved.length) {
    throw new AppError(
      "ONLINE_PUBLISH_FAILED",
      `Online publishing could not resolve ${unresolved.length} local asset reference${
        unresolved.length === 1 ? "" : "s"
      }.`,
      500
    );
  }

  const parsed = parseTemplatePublicDto(remapped);
  const { pantoneOptions: _pantoneOptions, ...compactTemplate } = parsed;
  return {
    ...compactTemplate,
    pantoneLibrary: defaultPantoneLibrary
  };
}

export function getOnlineBlobObjectPath(blobName: string) {
  const safeBlobName = /^[a-f0-9]{64}\.(?:png|jpe?g|webp)$/i.test(blobName);
  if (!safeBlobName) {
    throw new AppError(
      "INVALID_TEMPLATE_ASSET",
      "A Local Studio asset has an invalid content hash.",
      400
    );
  }
  return `blobs/${blobName.slice(0, 2).toLowerCase()}/${blobName.toLowerCase()}`;
}

function isAlreadyStoredError(error: { message?: string; statusCode?: string | number }) {
  return (
    String(error.statusCode || "") === "409" ||
    /already exists|duplicate|resource exists/i.test(error.message || "")
  );
}

async function uploadBlob(
  client: SupabaseClient,
  bucket: string,
  asset: {
    reference: string;
    blobName: string;
    mimeType?: string;
  }
) {
  const blob = await readLocalBlob(asset.blobName);
  const objectPath = getOnlineBlobObjectPath(asset.blobName);
  const { error } = await client.storage.from(bucket).upload(objectPath, blob.buffer, {
    cacheControl: "31536000",
    contentType: asset.mimeType || blob.contentType,
    upsert: false
  });

  const reused = Boolean(error && isAlreadyStoredError(error));
  if (error && !reused) {
    throw new AppError(
      "ONLINE_PUBLISH_FAILED",
      `Failed to upload ${asset.blobName}: ${error.message}`,
      502
    );
  }

  const {
    data: { publicUrl }
  } = client.storage.from(bucket).getPublicUrl(objectPath);
  if (!publicUrl) {
    throw new AppError(
      "ONLINE_PUBLISH_FAILED",
      `Supabase did not return a public URL for ${asset.blobName}.`,
      502
    );
  }

  return {
    reference: asset.reference,
    publicUrl,
    reused
  };
}

async function mapWithConcurrency<T, Result>(
  values: T[],
  concurrency: number,
  mapper: (value: T) => Promise<Result>
) {
  const results = new Array<Result>(values.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < values.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(values[currentIndex]);
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(Math.max(concurrency, 1), values.length) },
      () => worker()
    )
  );
  return results;
}

export async function publishLocalProductOnline(
  slug: string
): Promise<OnlinePublishResult> {
  const client = getAdminClient();
  const bucket = getStorageBucket();
  const { manifest, template, localVersion, release } =
    await getPublishedLocalReleaseManifest(slug);
  const blobAssets = manifest.assets.map((asset) => {
    if (asset.source !== "blob" || !asset.blobName) {
      throw new AppError(
        "INVALID_TEMPLATE_ASSET",
        `Online publishing requires a local copy of ${asset.reference}.`,
        409
      );
    }
    return {
      reference: asset.reference,
      blobName: asset.blobName,
      mimeType: asset.mimeType
    };
  });

  const uploaded = await mapWithConcurrency(
    blobAssets,
    uploadConcurrency,
    (asset) => uploadBlob(client, bucket, asset)
  );
  const referenceMap = new Map(
    uploaded.map((asset) => [asset.reference, asset.publicUrl])
  );
  const onlineTemplate = buildOnlineTemplatePayload(template, referenceMap);
  const { data, error } = await client
    .rpc("publish_product_template", {
      p_slug: template.slug,
      p_name: template.name,
      p_category: template.category,
      p_template: onlineTemplate,
      p_source_local_version: localVersion,
      p_asset_count: release.assetCount,
      p_total_bytes: release.totalBytes
    })
    .single();

  if (error) {
    throw new AppError(
      "ONLINE_PUBLISH_FAILED",
      `Supabase could not publish the product version: ${error.message}`,
      502
    );
  }

  const published = data as PublishedVersionRow;
  const publishedAt = published.published_at || new Date().toISOString();
  const snapshot = await recordOnlinePublication(slug, {
    onlineVersion: published.version,
    sourceLocalVersion: localVersion,
    publishedAt,
    assetCount: release.assetCount,
    totalBytes: release.totalBytes
  });

  return {
    success: true,
    slug,
    localVersion,
    onlineVersion: published.version,
    publishedAt,
    uploadedAssetCount: uploaded.filter((asset) => !asset.reused).length,
    reusedAssetCount: uploaded.filter((asset) => asset.reused).length,
    totalBytes: release.totalBytes,
    snapshot
  };
}
