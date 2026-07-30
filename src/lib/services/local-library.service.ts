import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { AppError } from "@/lib/errors";
import {
  getLocalUploadFormField,
  parseLocalBlobReference,
  parseLocalUploadReference,
  toLocalBlobReference
} from "@/lib/local-library/asset-reference";
import {
  localLibrarySchemaVersion,
  localProductPackageSchemaVersion,
  type CompactLocalTemplate,
  type LocalAssetManifestEntry,
  type LocalImportResult,
  type LocalLibraryCatalog,
  type LocalLibrarySnapshot,
  type LocalOnlinePublication,
  type LocalProductCatalogEntry,
  type LocalProductCatalogView,
  type LocalReleaseManifest,
  type LocalReleaseMutationResult,
  type LocalReleaseStatus,
  type LocalReleaseSummary,
  type LocalRollbackResult,
  type LocalTemplateLookupResult
} from "@/lib/local-library/types";
import { loadPantoneLibrary } from "@/lib/services/pantone-library.service";
import {
  createStoredZip,
  readStoredZip
} from "@/lib/services/zip-archive.service";
import type {
  LayeredMaterialMapKey,
  ProductFinishOption,
  TemplatePublicDto,
  TemplateSummaryDto
} from "@/lib/types";
import {
  inspectImageBuffer,
  type InspectedImage
} from "@/lib/validators/asset.validator";
import { parseTemplatePublicDto } from "@/lib/validators/template-public.validator";

const slugPattern = /^[a-z0-9][a-z0-9-]*$/;
const blobNamePattern = /^[a-f0-9]{64}\.(?:png|jpe?g|webp)$/i;
const publicTemplatePrefix = "/mockup-templates/";
const localHostnames = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const materialMapKeys: LayeredMaterialMapKey[] = [
  "base",
  "shadow",
  "highlight",
  "texture",
  "specular",
  "edgeAo"
];
const calibratedMaterialMapKeys: LayeredMaterialMapKey[] = materialMapKeys.filter(
  (key) => key !== "base"
);

const localReleaseSummarySchema = z.object({
  version: z.number().int().positive(),
  status: z.enum(["draft", "published"]),
  createdAt: z.string().min(1),
  assetCount: z.number().int().nonnegative(),
  totalBytes: z.number().int().nonnegative(),
  externalAssetCount: z.number().int().nonnegative(),
  warnings: z.array(z.string())
});

const templateSummarySchema = z.object({
  id: z.string().min(1),
  slug: z.string().regex(slugPattern),
  name: z.string().min(1),
  category: z.string().min(1),
  description: z.string(),
  size: z.string().optional(),
  baseImageUrl: z.string().min(1),
  instructionImageUrl: z.string().min(1)
});

const localProductCatalogEntrySchema = z.object({
  slug: z.string().regex(slugPattern),
  name: z.string().min(1),
  category: z.string().min(1),
  latestVersion: z.number().int().positive(),
  latestDraftVersion: z.number().int().positive().optional(),
  publishedVersion: z.number().int().positive().optional(),
  publishedSummary: templateSummarySchema.optional(),
  onlinePublication: z
    .object({
      onlineVersion: z.number().int().positive(),
      sourceLocalVersion: z.number().int().positive(),
      publishedAt: z.string().min(1),
      assetCount: z.number().int().nonnegative(),
      totalBytes: z.number().int().nonnegative()
    })
    .optional(),
  releases: z.array(localReleaseSummarySchema)
});

const localLibraryCatalogSchema = z.object({
  schemaVersion: z.literal(localLibrarySchemaVersion),
  updatedAt: z.string().min(1),
  products: z.array(localProductCatalogEntrySchema)
});

const localAssetManifestEntrySchema = z.object({
  reference: z.string().min(1),
  roles: z.array(z.string().min(1)).min(1),
  source: z.enum(["blob", "external"]),
  blobName: z.string().regex(blobNamePattern).optional(),
  mimeType: z.string().min(1).optional(),
  byteSize: z.number().int().nonnegative().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional()
});

const localReleaseManifestSchema = z.object({
  schemaVersion: z.literal(localProductPackageSchemaVersion),
  slug: z.string().regex(slugPattern),
  version: z.number().int().positive(),
  status: z.enum(["draft", "published"]),
  createdAt: z.string().min(1),
  template: z.unknown(),
  assets: z.array(localAssetManifestEntrySchema),
  validation: z.object({
    checkedAt: z.string().min(1),
    passed: z.literal(true),
    warnings: z.array(z.string())
  })
});

type MutableAssetBinding = {
  role: string;
  reference: string;
  setReference: (reference: string) => void;
};

type MaterializedTemplate = {
  template: TemplatePublicDto;
  assets: LocalAssetManifestEntry[];
  createdBlobNames: Set<string>;
};

let mutationQueue = Promise.resolve();

function getPositiveNumberEnvironmentValue(name: string, fallback: number) {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getMaxUploadBytes() {
  return getPositiveNumberEnvironmentValue("MAX_UPLOAD_SIZE_MB", 64) * 1024 * 1024;
}

function getMaxPackageBytes() {
  return getPositiveNumberEnvironmentValue("MAX_PRODUCT_PACKAGE_SIZE_MB", 512) * 1024 * 1024;
}

export function isLocalStudioServerEnabled() {
  const configured = process.env.CHILI_LOCAL_STUDIO_ENABLED?.trim().toLowerCase();
  if (configured === "false") return false;
  if (process.env.NODE_ENV === "production") return configured === "true";
  return true;
}

function isSameLocalOrigin(left: URL, right: URL) {
  return (
    localHostnames.has(left.hostname.toLowerCase()) &&
    localHostnames.has(right.hostname.toLowerCase()) &&
    left.protocol === right.protocol
  );
}

export function assertLocalStudioRequest(request: Request) {
  if (!isLocalStudioServerEnabled()) {
    throw new AppError("PRODUCT_TEMPLATE_NOT_FOUND", "Local Studio is disabled.", 404);
  }

  let requestUrl: URL;
  try {
    requestUrl = new URL(request.url);
  } catch {
    throw new AppError("INVALID_FORM_DATA", "Invalid Local Studio request.", 400);
  }

  const hostname = requestUrl.hostname.toLowerCase();
  if (!localHostnames.has(hostname)) {
    throw new AppError(
      "INVALID_FORM_DATA",
      "Local Studio API is available from localhost only.",
      403
    );
  }

  const fetchSite = request.headers.get("sec-fetch-site")?.toLowerCase();
  const origin = request.headers.get("origin");
  if (origin) {
    let originUrl: URL;
    try {
      originUrl = new URL(origin);
    } catch {
      throw new AppError("INVALID_FORM_DATA", "Invalid Local Studio request origin.", 403);
    }
    if (
      originUrl.origin !== requestUrl.origin &&
      !(
        isSameLocalOrigin(originUrl, requestUrl) &&
        (fetchSite === "same-origin" || fetchSite === "none")
      )
    ) {
      throw new AppError(
        "INVALID_FORM_DATA",
        "Cross-origin Local Studio requests are not allowed.",
        403
      );
    }
  }

  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    throw new AppError(
      "INVALID_FORM_DATA",
      "Cross-site Local Studio requests are not allowed.",
      403
    );
  }
}

export function getLocalLibraryRoot() {
  const configuredPath = process.env.CHILI_LOCAL_LIBRARY_PATH?.trim();
  return configuredPath
    ? path.resolve(configuredPath)
    : path.resolve(process.cwd(), ".chili-local-library");
}

function getCatalogPath() {
  return path.resolve(getLocalLibraryRoot(), "catalog.json");
}

function getBlobsRoot() {
  return path.resolve(getLocalLibraryRoot(), "blobs");
}

function getProductsRoot() {
  return path.resolve(getLocalLibraryRoot(), "products");
}

function assertSafeSlug(slug: string) {
  if (!slugPattern.test(slug)) {
    throw new AppError("INVALID_FORM_DATA", "Invalid product slug.", 400);
  }
}

function getReleasePath(slug: string, version: number) {
  assertSafeSlug(slug);
  if (!Number.isInteger(version) || version <= 0) {
    throw new AppError("INVALID_FORM_DATA", "Invalid product release version.", 400);
  }

  return path.resolve(getProductsRoot(), slug, "releases", `v${version}.json`);
}

async function getNextReleaseVersion(
  catalog: LocalLibraryCatalog,
  slug: string
) {
  const existing = catalog.products.find((entry) => entry.slug === slug);
  let version = (existing?.latestVersion || 0) + 1;
  while (await pathExists(getReleasePath(slug, version))) {
    version += 1;
  }
  return version;
}

function getBlobPath(blobName: string) {
  if (!blobNamePattern.test(blobName)) {
    throw new AppError("INVALID_TEMPLATE_ASSET", "Invalid Local Studio asset reference.", 400);
  }
  return path.resolve(getBlobsRoot(), blobName);
}

function createEmptyCatalog(): LocalLibraryCatalog {
  return {
    schemaVersion: localLibrarySchemaVersion,
    updatedAt: new Date().toISOString(),
    products: []
  };
}

async function ensureLibraryLayout() {
  await Promise.all([
    fs.mkdir(getBlobsRoot(), { recursive: true }),
    fs.mkdir(getProductsRoot(), { recursive: true })
  ]);
}

async function pathExists(targetPath: string) {
  try {
    await fs.stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function cleanupCreatedBlobs(blobNames: Set<string>) {
  await Promise.allSettled(
    Array.from(blobNames).map((blobName) =>
      fs.rm(getBlobPath(blobName), { force: true })
    )
  );
}

async function readCatalog(): Promise<LocalLibraryCatalog> {
  await ensureLibraryLayout();

  try {
    const raw = await fs.readFile(getCatalogPath(), "utf8");
    return localLibraryCatalogSchema.parse(JSON.parse(raw)) as LocalLibraryCatalog;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return createEmptyCatalog();
    }
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      throw new AppError(
        "INVALID_FORM_DATA",
        "Local Studio catalog.json is invalid. Restore it from backup before continuing.",
        500
      );
    }
    throw error;
  }
}

async function writeJsonAtomic(targetPath: string, value: unknown) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  const temporaryPath = `${targetPath}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");

  try {
    await fs.rename(temporaryPath, targetPath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true });
    throw error;
  }
}

async function writeCatalog(catalog: LocalLibraryCatalog) {
  await writeJsonAtomic(getCatalogPath(), {
    ...catalog,
    updatedAt: new Date().toISOString(),
    products: [...catalog.products].sort((left, right) => left.name.localeCompare(right.name))
  });
}

function compactTemplate(template: TemplatePublicDto): CompactLocalTemplate {
  const { pantoneOptions: _pantoneOptions, ...compact } = template;
  return {
    ...compact,
    pantoneLibrary: "pantone-solid-coated-v3"
  };
}

function hydrateCompactTemplate(template: CompactLocalTemplate): TemplatePublicDto {
  const { pantoneLibrary, ...payload } = template;
  return parseTemplatePublicDto({
    ...payload,
    pantoneOptions: loadPantoneLibrary(pantoneLibrary)
  });
}

function parseReleaseManifest(value: unknown): LocalReleaseManifest {
  const parsed = localReleaseManifestSchema.parse(value);
  const template = parsed.template as CompactLocalTemplate;
  const hydrated = hydrateCompactTemplate(template);

  if (hydrated.slug !== parsed.slug) {
    throw new AppError(
      "INVALID_FORM_DATA",
      "The Local Studio release slug does not match its template.",
      500
    );
  }

  return {
    ...parsed,
    template
  } as LocalReleaseManifest;
}

async function readReleaseManifest(slug: string, version: number) {
  try {
    const raw = await fs.readFile(getReleasePath(slug, version), "utf8");
    return parseReleaseManifest(JSON.parse(raw));
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      throw new AppError(
        "PRODUCT_TEMPLATE_NOT_FOUND",
        `Local Studio release v${version} could not be found.`,
        404
      );
    }
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      throw new AppError(
        "INVALID_FORM_DATA",
        `Local Studio release v${version} is invalid.`,
        500
      );
    }
    throw error;
  }
}

function toTemplateSummary(template: TemplatePublicDto): TemplateSummaryDto {
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

function toProductCatalogView(
  product: LocalProductCatalogEntry,
  includeFullHistory: boolean
): LocalProductCatalogView {
  return {
    ...product,
    releaseCount: product.releases.length,
    releases: includeFullHistory ? product.releases : product.releases.slice(0, 1)
  };
}

export async function getLocalLibrarySnapshot(
  expandedProductSlug?: string
): Promise<LocalLibrarySnapshot> {
  const catalog = await readCatalog();
  const publishedSummaries: TemplateSummaryDto[] = [];

  for (const product of catalog.products) {
    if (product.publishedVersion) {
      if (product.publishedSummary) {
        publishedSummaries.push(product.publishedSummary);
      } else {
        // Older catalogs are repaired on the next publish or rollback.
        const publishedManifest = await readReleaseManifest(
          product.slug,
          product.publishedVersion
        );
        publishedSummaries.push(
          toTemplateSummary(hydrateCompactTemplate(publishedManifest.template))
        );
      }
    }
  }

  return {
    enabled: true,
    libraryPath: getLocalLibraryRoot(),
    catalog: {
      ...catalog,
      products: catalog.products.map((product) =>
        toProductCatalogView(product, product.slug === expandedProductSlug)
      )
    },
    publishedSummaries: publishedSummaries.sort((left, right) =>
      left.name.localeCompare(right.name)
    )
  };
}

export async function getLocalTemplate(
  slug: string,
  channel: "latest" | "published" = "published"
): Promise<LocalTemplateLookupResult | null> {
  assertSafeSlug(slug);
  const catalog = await readCatalog();
  const product = catalog.products.find((entry) => entry.slug === slug);
  if (!product) return null;

  const version = channel === "latest" ? product.latestVersion : product.publishedVersion;
  if (!version) return null;

  const manifest = await readReleaseManifest(slug, version);
  return {
    version,
    template: hydrateCompactTemplate(manifest.template),
    release: product.releases.find((release) => release.version === version) || null,
    product: toProductCatalogView(product, true)
  };
}

export async function getPublishedLocalReleaseManifest(slug: string) {
  assertSafeSlug(slug);
  const catalog = await readCatalog();
  const product = catalog.products.find((entry) => entry.slug === slug);
  if (!product?.publishedVersion) {
    throw new AppError(
      "PRODUCT_TEMPLATE_NOT_FOUND",
      "Publish this product to the local preview before publishing it online.",
      409
    );
  }

  const manifest = await readReleaseManifest(slug, product.publishedVersion);
  const externalAssets = manifest.assets.filter((asset) => asset.source === "external");
  if (externalAssets.length) {
    throw new AppError(
      "INVALID_TEMPLATE_ASSET",
      "This local release still links external assets. Upload local copies before publishing online.",
      409
    );
  }

  return {
    manifest,
    template: hydrateCompactTemplate(manifest.template),
    localVersion: product.publishedVersion,
    release: buildReleaseSummary(manifest)
  };
}

export async function recordOnlinePublication(
  slug: string,
  publication: LocalOnlinePublication
) {
  assertSafeSlug(slug);

  return withMutationLock(async () => {
    const catalog = await readCatalog();
    const product = catalog.products.find((entry) => entry.slug === slug);
    if (!product) {
      throw new AppError(
        "PRODUCT_TEMPLATE_NOT_FOUND",
        "The local product could not be found after online publishing.",
        404
      );
    }

    product.onlinePublication = publication;
    await writeCatalog(catalog);
    return getLocalLibrarySnapshot(slug);
  });
}

function collectTemplateAssetBindings(template: TemplatePublicDto): MutableAssetBinding[] {
  const bindings: MutableAssetBinding[] = [
    {
      role: "base",
      reference: template.baseImageUrl,
      setReference: (reference) => {
        template.baseImageUrl = reference;
      }
    },
    {
      role: "instruction",
      reference: template.instructionImageUrl,
      setReference: (reference) => {
        template.instructionImageUrl = reference;
      }
    }
  ];

  const colorPartsById = new Map(template.colorParts.map((part) => [part.id, part]));
  for (const part of template.colorParts) {
    const reference =
      part.partMaskImageUrl ||
      template.layeredRender?.partMasks[part.id] ||
      part.partMaskImageFileName;
    if (!reference) continue;

    bindings.push({
      role: `part-mask:${part.id}`,
      reference,
      setReference: (nextReference) => {
        part.partMaskImageUrl = nextReference;
        part.partMaskImageFileName = nextReference;
        if (template.layeredRender) {
          template.layeredRender.partMasks[part.id] = nextReference;
        }
      }
    });
  }

  for (const [partId, reference] of Object.entries(template.layeredRender?.partMasks || {})) {
    if (colorPartsById.has(partId)) continue;
    bindings.push({
      role: `part-mask:${partId}`,
      reference,
      setReference: (nextReference) => {
        if (template.layeredRender) {
          template.layeredRender.partMasks[partId] = nextReference;
        }
      }
    });
  }

  for (const [finish, reference] of Object.entries(
    template.layeredRender?.finishBaseImages || {}
  ) as Array<[ProductFinishOption, string]>) {
    bindings.push({
      role: `finish-base:${finish}`,
      reference,
      setReference: (nextReference) => {
        if (template.layeredRender) {
          template.layeredRender.finishBaseImages[finish] = nextReference;
        }
      }
    });
  }

  for (const [finish, mapSet] of Object.entries(
    template.layeredRender?.materialMaps || {}
  ) as Array<[ProductFinishOption, Partial<Record<LayeredMaterialMapKey, string>>]>) {
    for (const mapKey of materialMapKeys) {
      const reference = mapSet[mapKey];
      if (!reference) continue;
      bindings.push({
        role: `material-map:${finish}:${mapKey}`,
        reference,
        setReference: (nextReference) => {
          if (template.layeredRender?.materialMaps?.[finish]) {
            template.layeredRender.materialMaps[finish]![mapKey] = nextReference;
          }
        }
      });
    }
  }

  for (const [method, reference] of Object.entries(
    template.logoPlacement.printingAreaImages || {}
  )) {
    bindings.push({
      role: `printing-area:${method}`,
      reference,
      setReference: (nextReference) => {
        if (template.logoPlacement.printingAreaImages) {
          template.logoPlacement.printingAreaImages[method] = nextReference;
        }
      }
    });
  }

  return bindings;
}

function getCanonicalImageExtension(info: InspectedImage) {
  if (info.mimeType === "image/png") return ".png";
  if (info.mimeType === "image/jpeg") return ".jpg";
  if (info.mimeType === "image/webp") return ".webp";
  throw new AppError(
    "INVALID_TEMPLATE_ASSET",
    "Local Studio product assets must use PNG, JPEG, or WebP.",
    400
  );
}

function requiresLosslessImage(role: string) {
  return role.startsWith("part-mask:") || role.startsWith("material-map:");
}

async function storeImageBuffer(params: {
  buffer: Buffer;
  fileName: string;
  role: string;
  uploadMimeType?: string;
  enforceUploadLimit?: boolean;
  expectedBlobName?: string;
  createdBlobNames?: Set<string>;
}) {
  if (params.enforceUploadLimit && params.buffer.length > getMaxUploadBytes()) {
    throw new AppError(
      "INVALID_TEMPLATE_ASSET",
      `${params.fileName} is larger than the ${getPositiveNumberEnvironmentValue(
        "MAX_UPLOAD_SIZE_MB",
        64
      )} MB upload limit.`,
      413
    );
  }

  let info: InspectedImage;
  try {
    info = inspectImageBuffer(params.buffer, params.fileName);
  } catch (error) {
    if (error instanceof AppError) {
      throw new AppError(error.errorCode, error.message, 400);
    }
    throw error;
  }
  if (info.mimeType === "image/svg+xml") {
    throw new AppError(
      "INVALID_TEMPLATE_ASSET",
      `${params.fileName} must use PNG, JPEG, or WebP. SVG is not accepted for same-origin product assets.`,
      400
    );
  }
  if (params.uploadMimeType && params.uploadMimeType !== info.mimeType) {
    throw new AppError(
      "INVALID_TEMPLATE_ASSET",
      `${params.fileName} does not match its declared image type.`,
      400
    );
  }
  if (requiresLosslessImage(params.role) && info.mimeType === "image/jpeg") {
    throw new AppError(
      "INVALID_TEMPLATE_ASSET",
      `${params.role} must use lossless PNG or WebP so mask edges and material maps remain accurate.`,
      400
    );
  }

  const hash = crypto.createHash("sha256").update(params.buffer).digest("hex");
  const blobName = `${hash}${getCanonicalImageExtension(info)}`;
  if (params.expectedBlobName && params.expectedBlobName !== blobName) {
    throw new AppError(
      "INVALID_TEMPLATE_ASSET",
      `The package integrity check failed for ${params.expectedBlobName}.`,
      400
    );
  }
  const blobPath = getBlobPath(blobName);

  if (!(await pathExists(blobPath))) {
    try {
      await fs.writeFile(blobPath, params.buffer, { flag: "wx" });
      params.createdBlobNames?.add(blobName);
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== "EEXIST") throw error;
    }
  }

  return {
    reference: toLocalBlobReference(blobName),
    blobName,
    mimeType: info.mimeType,
    byteSize: params.buffer.length,
    width: info.width,
    height: info.height
  };
}

async function readRepositoryAsset(reference: string) {
  const pathname = reference.split(/[?#]/, 1)[0];
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    throw new AppError("INVALID_TEMPLATE_ASSET", "Invalid repository asset URL.", 400);
  }

  if (!decodedPath.startsWith(publicTemplatePrefix)) {
    throw new AppError(
      "INVALID_TEMPLATE_ASSET",
      `Unsupported local asset reference: ${reference}`,
      400
    );
  }

  const publicRoot = path.resolve(process.cwd(), "public");
  const targetPath = path.resolve(publicRoot, decodedPath.replace(/^\/+/, ""));
  if (!targetPath.startsWith(publicRoot + path.sep)) {
    throw new AppError("INVALID_TEMPLATE_ASSET", "Unsafe repository asset path.", 400);
  }

  try {
    return {
      buffer: await fs.readFile(targetPath),
      fileName: path.basename(targetPath)
    };
  } catch {
    throw new AppError(
      "INVALID_TEMPLATE_ASSET",
      `Repository asset could not be found: ${reference}`,
      400
    );
  }
}

async function materializeTemplateAssets(
  sourceTemplate: TemplatePublicDto,
  formData: FormData
): Promise<MaterializedTemplate> {
  const template = structuredClone(sourceTemplate);
  const bindings = collectTemplateAssetBindings(template);
  const processed = new Map<
    string,
    Omit<LocalAssetManifestEntry, "roles"> & { roles: Set<string> }
  >();
  const createdBlobNames = new Set<string>();
  let uploadedBytes = 0;

  try {
    for (const binding of bindings) {
      const existing = processed.get(binding.reference);
      if (existing) {
        existing.roles.add(binding.role);
        binding.setReference(existing.reference);
        continue;
      }

      const uploadReference = parseLocalUploadReference(binding.reference);
      if (uploadReference) {
        const uploaded = formData.get(getLocalUploadFormField(binding.reference));
        if (!(uploaded instanceof File) || uploaded.size <= 0) {
          throw new AppError(
            "INVALID_TEMPLATE_ASSET",
            `The uploaded file for ${binding.role} is missing.`,
            400
          );
        }

        uploadedBytes += uploaded.size;
        if (uploadedBytes > getMaxPackageBytes()) {
          throw new AppError(
            "INVALID_TEMPLATE_ASSET",
            "The combined product upload is larger than the configured package limit.",
            413
          );
        }

        const buffer = Buffer.from(await uploaded.arrayBuffer());
        const stored = await storeImageBuffer({
          buffer,
          fileName: uploaded.name,
          role: binding.role,
          uploadMimeType: uploaded.type || undefined,
          enforceUploadLimit: true,
          createdBlobNames
        });
        const entry = {
          ...stored,
          source: "blob" as const,
          roles: new Set([binding.role])
        };
        processed.set(binding.reference, entry);
        binding.setReference(stored.reference);
        continue;
      }

      const localBlobName = parseLocalBlobReference(binding.reference);
      if (localBlobName) {
        const buffer = await fs.readFile(getBlobPath(localBlobName));
        const stored = await storeImageBuffer({
          buffer,
          fileName: localBlobName,
          role: binding.role,
          createdBlobNames
        });
        const entry = {
          ...stored,
          source: "blob" as const,
          roles: new Set([binding.role])
        };
        processed.set(binding.reference, entry);
        binding.setReference(stored.reference);
        continue;
      }

      if (binding.reference.startsWith(publicTemplatePrefix)) {
        const source = await readRepositoryAsset(binding.reference);
        const stored = await storeImageBuffer({
          buffer: source.buffer,
          fileName: source.fileName,
          role: binding.role,
          createdBlobNames
        });
        const entry = {
          ...stored,
          source: "blob" as const,
          roles: new Set([binding.role])
        };
        processed.set(binding.reference, entry);
        binding.setReference(stored.reference);
        continue;
      }

      if (/^https:\/\//i.test(binding.reference)) {
        const entry = {
          reference: binding.reference,
          source: "external" as const,
          roles: new Set([binding.role])
        };
        processed.set(binding.reference, entry);
        binding.setReference(binding.reference);
        continue;
      }

      throw new AppError(
        "INVALID_TEMPLATE_ASSET",
        `Unsupported asset reference for ${binding.role}: ${binding.reference}`,
        400
      );
    }

    const assetsByReference = new Map<
      string,
      Omit<LocalAssetManifestEntry, "roles"> & { roles: Set<string> }
    >();
    for (const entry of processed.values()) {
      const combined = assetsByReference.get(entry.reference);
      if (combined) {
        for (const role of entry.roles) combined.roles.add(role);
      } else {
        assetsByReference.set(entry.reference, {
          ...entry,
          roles: new Set(entry.roles)
        });
      }
    }
    const assets = Array.from(assetsByReference.values()).map((entry) => ({
      ...entry,
      roles: Array.from(entry.roles).sort()
    }));

    return {
      template: parseTemplatePublicDto(template),
      assets,
      createdBlobNames
    };
  } catch (error) {
    await cleanupCreatedBlobs(createdBlobNames);
    throw error;
  }
}

function findAssetForRole(assets: LocalAssetManifestEntry[], role: string) {
  return assets.find((asset) => asset.roles.includes(role));
}

function validateAssetManifestBindings(
  template: TemplatePublicDto,
  assets: LocalAssetManifestEntry[]
) {
  const assetsByReference = new Map<string, LocalAssetManifestEntry>();
  for (const asset of assets) {
    if (assetsByReference.has(asset.reference)) {
      throw new AppError(
        "INVALID_TEMPLATE_ASSET",
        `The asset manifest contains duplicate reference ${asset.reference}.`,
        400
      );
    }
    assetsByReference.set(asset.reference, asset);

    if (
      asset.mimeType === "image/jpeg" &&
      asset.roles.some((role) => requiresLosslessImage(role))
    ) {
      throw new AppError(
        "INVALID_TEMPLATE_ASSET",
        `${asset.roles.join(", ")} must use lossless PNG or WebP so mask edges and material maps remain accurate.`,
        400
      );
    }

    if (
      asset.source === "blob" &&
      (!asset.blobName || parseLocalBlobReference(asset.reference) !== asset.blobName)
    ) {
      throw new AppError(
        "INVALID_TEMPLATE_ASSET",
        `The asset manifest reference for ${asset.roles.join(", ")} does not match its content hash.`,
        400
      );
    }
  }

  const expectedBindings = collectTemplateAssetBindings(structuredClone(template));
  const expectedRoleKeys = new Set(
    expectedBindings.map((binding) => `${binding.reference}\0${binding.role}`)
  );
  for (const binding of expectedBindings) {
    const asset = assetsByReference.get(binding.reference);
    if (!asset?.roles.includes(binding.role)) {
      throw new AppError(
        "INVALID_TEMPLATE_ASSET",
        `The asset manifest is missing ${binding.role}.`,
        400
      );
    }
  }

  for (const asset of assets) {
    for (const role of asset.roles) {
      if (!expectedRoleKeys.has(`${asset.reference}\0${role}`)) {
        throw new AppError(
          "INVALID_TEMPLATE_ASSET",
          `The asset manifest contains an unexpected ${role} binding.`,
          400
        );
      }
    }
  }
}

function validateMaterializedTemplate(
  template: TemplatePublicDto,
  assets: LocalAssetManifestEntry[]
) {
  validateAssetManifestBindings(template, assets);
  const warnings: string[] = [];
  const externalAssets = assets.filter((asset) => asset.source === "external");
  if (externalAssets.length) {
    warnings.push(
      `${externalAssets.length} external asset${
        externalAssets.length === 1 ? "" : "s"
      } remain linked. Replace them with local uploads before creating a portable package.`
    );
  }

  const baseAsset = findAssetForRole(assets, "base");
  if (baseAsset?.width && baseAsset.width < 2048) {
    warnings.push("The product base image is below 2048px and may look soft in downloaded mockups.");
  }

  const hasJpegPrintingArea = assets.some(
    (asset) =>
      asset.mimeType === "image/jpeg" &&
      asset.roles.some((role) => role.startsWith("printing-area:"))
  );
  if (hasJpegPrintingArea) {
    warnings.push(
      "A printing-area mask uses legacy JPEG. It remains usable, but PNG or WebP will keep red-mask edges more accurate."
    );
  }

  const layered = template.layeredRender;
  if (!layered) {
    warnings.push("The local layered renderer is disabled; Pantone material previews are unavailable.");
    return warnings;
  }

  const fallbackAsset = findAssetForRole(assets, `finish-base:${layered.fallbackFinish}`);
  const expectedWidth = layered.outputSize?.width || fallbackAsset?.width;
  const expectedHeight = layered.outputSize?.height || fallbackAsset?.height;
  if (!expectedWidth || !expectedHeight) {
    throw new AppError(
      "INVALID_TEMPLATE_ASSET",
      "The fallback material image must be local so its dimensions can be validated.",
      400
    );
  }

  let scaledLayerCount = 0;
  for (const asset of assets) {
    const mustAlign = asset.roles.some(
      (role) =>
        role.startsWith("finish-base:") ||
        role.startsWith("part-mask:") ||
        role.startsWith("material-map:") ||
        role.startsWith("printing-area:")
    );
    if (!mustAlign || asset.source === "external") continue;

    const expectedAspectRatio = expectedWidth / expectedHeight;
    const assetAspectRatio = (asset.width || 0) / (asset.height || 1);
    if (Math.abs(assetAspectRatio - expectedAspectRatio) > 0.002) {
      throw new AppError(
        "INVALID_TEMPLATE_ASSET",
        `${asset.roles.join(", ")} is ${asset.width}x${asset.height}; every compositing layer in this view must use the ${expectedWidth}:${expectedHeight} aspect ratio.`,
        400
      );
    }

    if (asset.width !== expectedWidth || asset.height !== expectedHeight) {
      scaledLayerCount += 1;
    }
  }
  if (scaledLayerCount) {
    warnings.push(
      `${scaledLayerCount} compositing asset${
        scaledLayerCount === 1 ? "" : "s"
      } use a different source resolution and will be scaled to ${expectedWidth}x${expectedHeight}. Confirm camera and crop alignment in Preview latest.`
    );
  }

  const finishesByReference = new Map<string, string[]>();
  for (const [finish, reference] of Object.entries(layered.finishBaseImages)) {
    const finishes = finishesByReference.get(reference) || [];
    finishes.push(finish);
    finishesByReference.set(reference, finishes);
  }
  for (const finishes of finishesByReference.values()) {
    if (finishes.length > 1) {
      warnings.push(
        `${finishes.join(
          ", "
        )} currently share one visual source. Use separate product-specific references when their surface response differs.`
      );
    }
  }

  for (const finish of Object.keys(layered.finishBaseImages) as ProductFinishOption[]) {
    const hasCalibratedMaps = calibratedMaterialMapKeys.some(
      (key) => Boolean(layered.materialMaps?.[finish]?.[key])
    );
    if (!hasCalibratedMaps) {
      warnings.push(
        `${finish} uses maps derived from its reference image. Add calibrated maps only if the visual reference is not accurate enough.`
      );
    }
  }

  if (expectedWidth > 4096 || expectedHeight > 4096) {
    warnings.push(
      "The renderer output is above 4096px and may exceed browser memory on mobile devices."
    );
  }

  return warnings;
}

function buildReleaseSummary(manifest: LocalReleaseManifest): LocalReleaseSummary {
  return {
    version: manifest.version,
    status: manifest.status,
    createdAt: manifest.createdAt,
    assetCount: manifest.assets.length,
    totalBytes: manifest.assets.reduce((total, asset) => total + (asset.byteSize || 0), 0),
    externalAssetCount: manifest.assets.filter((asset) => asset.source === "external").length,
    warnings: manifest.validation.warnings
  };
}

function updateCatalogWithRelease(
  catalog: LocalLibraryCatalog,
  manifest: LocalReleaseManifest
) {
  const template = hydrateCompactTemplate(manifest.template);
  const existing = catalog.products.find((entry) => entry.slug === manifest.slug);
  const product: LocalProductCatalogEntry = existing || {
    slug: manifest.slug,
    name: template.name,
    category: template.category,
    latestVersion: manifest.version,
    releases: []
  };

  product.name = template.name;
  product.category = template.category;
  product.latestVersion = manifest.version;
  product.releases = [
    buildReleaseSummary(manifest),
    ...product.releases.filter((release) => release.version !== manifest.version)
  ].sort((left, right) => right.version - left.version);

  if (manifest.status === "published") {
    product.publishedVersion = manifest.version;
    product.publishedSummary = toTemplateSummary(template);
  } else {
    product.latestDraftVersion = manifest.version;
  }

  if (!existing) {
    catalog.products.push(product);
  }

  return product;
}

function withMutationLock<T>(operation: () => Promise<T>) {
  const run = mutationQueue.then(operation, operation);
  mutationQueue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

function parseTemplateFormPayload(formData: FormData) {
  const templateValue = formData.get("template");
  const statusValue = formData.get("status");
  if (typeof templateValue !== "string" || !templateValue.trim()) {
    throw new AppError("INVALID_FORM_DATA", "Local Studio template data is missing.", 400);
  }
  if (statusValue !== "draft" && statusValue !== "published") {
    throw new AppError("INVALID_FORM_DATA", "Invalid Local Studio release status.", 400);
  }

  try {
    return {
      template: parseTemplatePublicDto(JSON.parse(templateValue)),
      status: statusValue as LocalReleaseStatus
    };
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      throw new AppError(
        "INVALID_FORM_DATA",
        "The product setup is incomplete or contains invalid values.",
        400
      );
    }
    throw error;
  }
}

export async function saveLocalReleaseFromFormData(
  formData: FormData
): Promise<LocalReleaseMutationResult> {
  const payload = parseTemplateFormPayload(formData);

  return withMutationLock(async () => {
    const catalog = await readCatalog();
    const version = await getNextReleaseVersion(catalog, payload.template.slug);
    const createdAt = new Date().toISOString();
    const materialized = await materializeTemplateAssets(payload.template, formData);
    let committed = false;
    const releasePath = getReleasePath(payload.template.slug, version);
    let releaseWritten = false;
    try {
      const warnings = validateMaterializedTemplate(materialized.template, materialized.assets);
      const manifest: LocalReleaseManifest = {
        schemaVersion: localProductPackageSchemaVersion,
        slug: materialized.template.slug,
        version,
        status: payload.status,
        createdAt,
        template: compactTemplate(materialized.template),
        assets: materialized.assets,
        validation: {
          checkedAt: createdAt,
          passed: true,
          warnings
        }
      };

      await writeJsonAtomic(releasePath, manifest);
      releaseWritten = true;
      updateCatalogWithRelease(catalog, manifest);
      await writeCatalog(catalog);
      committed = true;

      return {
        success: true,
        version,
        status: payload.status,
        template: materialized.template,
        snapshot: await getLocalLibrarySnapshot(materialized.template.slug)
      };
    } catch (error) {
      if (!committed) {
        if (releaseWritten) {
          await fs.rm(releasePath, { force: true });
        }
        await cleanupCreatedBlobs(materialized.createdBlobNames);
      }
      throw error;
    }
  });
}

export async function rollbackLocalProduct(
  slug: string,
  version: number
): Promise<LocalRollbackResult> {
  assertSafeSlug(slug);

  return withMutationLock(async () => {
    const catalog = await readCatalog();
    const product = catalog.products.find((entry) => entry.slug === slug);
    if (!product || !product.releases.some((release) => release.version === version)) {
      throw new AppError(
        "PRODUCT_TEMPLATE_NOT_FOUND",
        `Local Studio release v${version} could not be found.`,
        404
      );
    }

    const manifest = await readReleaseManifest(slug, version);
    product.publishedVersion = version;
    product.publishedSummary = toTemplateSummary(hydrateCompactTemplate(manifest.template));
    await writeCatalog(catalog);

    return {
      success: true,
      publishedVersion: version,
      template: hydrateCompactTemplate(manifest.template),
      snapshot: await getLocalLibrarySnapshot(slug)
    };
  });
}

export async function readLocalBlob(blobName: string) {
  let buffer: Buffer;
  try {
    buffer = await fs.readFile(getBlobPath(blobName));
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      throw new AppError(
        "PRODUCT_TEMPLATE_NOT_FOUND",
        "The Local Studio asset could not be found.",
        404
      );
    }
    throw error;
  }
  const info = inspectImageBuffer(buffer, blobName);
  return {
    buffer,
    contentType: info.mimeType,
    etag: `"${path.parse(blobName).name}"`
  };
}

export async function buildLocalProductPackage(slug: string, requestedVersion?: number) {
  assertSafeSlug(slug);
  const catalog = await readCatalog();
  const product = catalog.products.find((entry) => entry.slug === slug);
  if (!product) {
    throw new AppError("PRODUCT_TEMPLATE_NOT_FOUND", "Local product could not be found.", 404);
  }

  const version = requestedVersion || product.publishedVersion || product.latestVersion;
  const manifest = await readReleaseManifest(slug, version);
  const externalAssets = manifest.assets.filter((asset) => asset.source === "external");
  if (externalAssets.length) {
    throw new AppError(
      "INVALID_TEMPLATE_ASSET",
      "This release still links external assets. Upload local copies before exporting a portable product package.",
      409
    );
  }

  const packageRoot = `chili-product/${slug}`;
  const readme = [
    "Chili Mockup product package",
    `Product: ${manifest.template.name}`,
    `Slug: ${slug}`,
    `Source release: v${version}`,
    "",
    "Import this ZIP from Local Studio. Do not edit blob file names."
  ].join("\n");
  const entries: Array<{ name: string; data: Buffer }> = [
    {
      name: `${packageRoot}/README.txt`,
      data: Buffer.from(`${readme}\n`, "utf8")
    },
    {
      name: `${packageRoot}/manifest.json`,
      data: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8")
    }
  ];
  const uniqueBlobNames = Array.from(
    new Set(manifest.assets.flatMap((asset) => (asset.blobName ? [asset.blobName] : [])))
  );

  for (const blobName of uniqueBlobNames) {
    entries.push({
      name: `${packageRoot}/assets/${blobName}`,
      data: await fs.readFile(getBlobPath(blobName))
    });
  }

  return {
    fileName: `${slug}-v${version}.chili-product.zip`,
    buffer: createStoredZip(entries)
  };
}

export async function importLocalProductPackage(formData: FormData): Promise<LocalImportResult> {
  const packageFile = formData.get("package");
  if (!(packageFile instanceof File) || packageFile.size <= 0) {
    throw new AppError("INVALID_FORM_DATA", "Choose a Chili product package to import.", 400);
  }
  if (packageFile.size > getMaxPackageBytes()) {
    throw new AppError(
      "INVALID_TEMPLATE_ASSET",
      "The Chili product package is larger than the configured import limit.",
      413
    );
  }

  const packageBuffer = Buffer.from(await packageFile.arrayBuffer());
  let entries: Array<{ name: string; data: Buffer }>;
  try {
    entries = readStoredZip(packageBuffer, {
      maxEntries: 500,
      maxTotalBytes: getMaxPackageBytes()
    });
  } catch (error) {
    throw new AppError(
      "INVALID_TEMPLATE_ASSET",
      error instanceof Error ? error.message : "Invalid Chili product package.",
      400
    );
  }

  const manifestEntries = entries.filter((entry) => entry.name.endsWith("/manifest.json"));
  if (manifestEntries.length !== 1) {
    throw new AppError(
      "INVALID_TEMPLATE_ASSET",
      "The Chili product package must contain exactly one manifest.json.",
      400
    );
  }
  const manifestEntry = manifestEntries[0];

  let importedManifest: LocalReleaseManifest;
  try {
    importedManifest = parseReleaseManifest(JSON.parse(manifestEntry.data.toString("utf8")));
  } catch (error) {
    throw new AppError(
      "INVALID_TEMPLATE_ASSET",
      error instanceof Error ? error.message : "The package manifest is invalid.",
      400
    );
  }

  if (importedManifest.assets.some((asset) => asset.source === "external")) {
    throw new AppError(
      "INVALID_TEMPLATE_ASSET",
      "Portable product packages cannot contain external asset links.",
      400
    );
  }

  const packageRoot = `chili-product/${importedManifest.slug}`;
  if (manifestEntry.name !== `${packageRoot}/manifest.json`) {
    throw new AppError(
      "INVALID_TEMPLATE_ASSET",
      "The product package folder does not match its manifest slug.",
      400
    );
  }
  const entriesByName = new Map(entries.map((entry) => [entry.name, entry]));

  return withMutationLock(async () => {
    await ensureLibraryLayout();
    const verifiedAssets: LocalAssetManifestEntry[] = [];
    const createdBlobNames = new Set<string>();
    let committed = false;
    let writtenReleasePath: string | null = null;

    try {
      for (const asset of importedManifest.assets) {
        if (!asset.blobName) {
          throw new AppError(
            "INVALID_TEMPLATE_ASSET",
            "The package manifest contains an asset without a blob name.",
            400
          );
        }

        const assetEntry = entriesByName.get(`${packageRoot}/assets/${asset.blobName}`);
        if (!assetEntry) {
          throw new AppError(
            "INVALID_TEMPLATE_ASSET",
            `The package is missing ${asset.blobName}.`,
            400
          );
        }

        const role = asset.roles[0];
        const stored = await storeImageBuffer({
          buffer: assetEntry.data,
          fileName: asset.blobName,
          role,
          expectedBlobName: asset.blobName,
          createdBlobNames
        });

        verifiedAssets.push({
          ...stored,
          source: "blob",
          roles: [...asset.roles]
        });
      }

      const template = hydrateCompactTemplate(importedManifest.template);
      const warnings = validateMaterializedTemplate(template, verifiedAssets);
      const catalog = await readCatalog();
      const version = await getNextReleaseVersion(catalog, template.slug);
      const createdAt = new Date().toISOString();
      const releasePath = getReleasePath(template.slug, version);
      const manifest: LocalReleaseManifest = {
        ...importedManifest,
        version,
        status: "draft",
        createdAt,
        assets: verifiedAssets,
        validation: {
          checkedAt: createdAt,
          passed: true,
          warnings
        }
      };

      await writeJsonAtomic(releasePath, manifest);
      writtenReleasePath = releasePath;
      updateCatalogWithRelease(catalog, manifest);
      await writeCatalog(catalog);
      committed = true;

      return {
        success: true,
        version,
        template,
        snapshot: await getLocalLibrarySnapshot(template.slug)
      };
    } catch (error) {
      if (!committed) {
        if (writtenReleasePath) {
          await fs.rm(writtenReleasePath, { force: true });
        }
        await cleanupCreatedBlobs(createdBlobNames);
      }
      throw error;
    }
  });
}
