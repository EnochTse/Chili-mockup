import { getLiveSupabaseClient, getLiveTemplateStorageBucketName } from "@/lib/services/live-template-database.service";
import type { ProductFinishOption } from "@/lib/types";

export type LiveTemplateUploadedAssets = {
  baseImageUrl?: string;
  instructionImageUrl?: string;
  partMaskImageUrls: Record<string, string>;
  finishBaseImageUrls: Partial<Record<ProductFinishOption, string>>;
  printingAreaImageUrls: Record<string, string>;
};

type UploadLiveTemplateAssetsParams = {
  productSlug: string;
  version: number;
  baseImageFile?: File | null;
  instructionImageFile?: File | null;
  partMaskFiles?: Record<string, File | null>;
  finishBaseFiles?: Partial<Record<ProductFinishOption, File | null>>;
  printingAreaFiles?: Record<string, File | null>;
};

function sanitizePathSegment(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "asset";
}

function getFileExtension(file: File) {
  const match = file.name.toLowerCase().match(/(\.[a-z0-9]+)$/i);
  return match?.[1] || ".bin";
}

function buildAssetPath(params: {
  productSlug: string;
  version: number;
  group: string;
  key: string;
  file: File;
}) {
  const safeSlug = sanitizePathSegment(params.productSlug);
  const safeGroup = sanitizePathSegment(params.group);
  const safeKey = sanitizePathSegment(params.key);
  const extension = getFileExtension(params.file);
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `products/${safeSlug}/versions/v${params.version}/${safeGroup}/${safeKey}-${uniqueSuffix}${extension}`;
}

async function uploadSingleAsset(params: {
  productSlug: string;
  version: number;
  group: string;
  key: string;
  file: File;
}) {
  const client = getLiveSupabaseClient();
  const bucket = getLiveTemplateStorageBucketName();
  const assetPath = buildAssetPath(params);
  const { error } = await client.storage.from(bucket).upload(assetPath, params.file, {
    cacheControl: "31536000",
    contentType: params.file.type || undefined,
    upsert: false
  });

  if (error) {
    throw new Error(`Failed to upload ${params.key}: ${error.message}`);
  }

  const {
    data: { publicUrl }
  } = client.storage.from(bucket).getPublicUrl(assetPath);

  if (!publicUrl) {
    throw new Error(`Uploaded ${params.key}, but failed to resolve its public URL.`);
  }

  return publicUrl;
}

export async function uploadLiveTemplateAssets(
  params: UploadLiveTemplateAssetsParams
): Promise<LiveTemplateUploadedAssets> {
  const uploadedAssets: LiveTemplateUploadedAssets = {
    partMaskImageUrls: {},
    finishBaseImageUrls: {},
    printingAreaImageUrls: {}
  };

  if (params.baseImageFile) {
    uploadedAssets.baseImageUrl = await uploadSingleAsset({
      productSlug: params.productSlug,
      version: params.version,
      group: "base",
      key: "base-image",
      file: params.baseImageFile
    });
  }

  if (params.instructionImageFile) {
    uploadedAssets.instructionImageUrl = await uploadSingleAsset({
      productSlug: params.productSlug,
      version: params.version,
      group: "instruction",
      key: "instruction-image",
      file: params.instructionImageFile
    });
  }

  for (const [partId, file] of Object.entries(params.partMaskFiles || {})) {
    if (!file) continue;
    uploadedAssets.partMaskImageUrls[partId] = await uploadSingleAsset({
      productSlug: params.productSlug,
      version: params.version,
      group: "part-masks",
      key: partId,
      file
    });
  }

  for (const [finish, file] of Object.entries(params.finishBaseFiles || {}) as Array<
    [ProductFinishOption, File | null | undefined]
  >) {
    if (!file) continue;
    uploadedAssets.finishBaseImageUrls[finish] = await uploadSingleAsset({
      productSlug: params.productSlug,
      version: params.version,
      group: "finish-bases",
      key: finish,
      file
    });
  }

  for (const [method, file] of Object.entries(params.printingAreaFiles || {})) {
    if (!file) continue;
    uploadedAssets.printingAreaImageUrls[method] = await uploadSingleAsset({
      productSlug: params.productSlug,
      version: params.version,
      group: "printing-areas",
      key: method,
      file
    });
  }

  return uploadedAssets;
}
