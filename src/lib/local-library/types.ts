import type { TemplatePublicDto, TemplateSummaryDto } from "@/lib/types";

export const localLibrarySchemaVersion = 1 as const;
export const localProductPackageSchemaVersion = 1 as const;

export type LocalReleaseStatus = "draft" | "published";

export type CompactLocalTemplate = Omit<TemplatePublicDto, "pantoneOptions"> & {
  pantoneLibrary: "pantone-solid-coated-v3";
};

export type LocalAssetManifestEntry = {
  reference: string;
  roles: string[];
  source: "blob" | "external";
  blobName?: string;
  mimeType?: string;
  byteSize?: number;
  width?: number;
  height?: number;
};

export type LocalValidationReport = {
  checkedAt: string;
  passed: true;
  warnings: string[];
};

export type LocalReleaseManifest = {
  schemaVersion: typeof localProductPackageSchemaVersion;
  slug: string;
  version: number;
  status: LocalReleaseStatus;
  createdAt: string;
  template: CompactLocalTemplate;
  assets: LocalAssetManifestEntry[];
  validation: LocalValidationReport;
};

export type LocalReleaseSummary = {
  version: number;
  status: LocalReleaseStatus;
  createdAt: string;
  assetCount: number;
  totalBytes: number;
  externalAssetCount: number;
  warnings: string[];
};

export type LocalOnlinePublication = {
  onlineVersion: number;
  sourceLocalVersion: number;
  publishedAt: string;
  assetCount: number;
  totalBytes: number;
};

export type LocalProductCatalogEntry = {
  slug: string;
  name: string;
  category: string;
  latestVersion: number;
  latestDraftVersion?: number;
  publishedVersion?: number;
  publishedSummary?: TemplateSummaryDto;
  onlinePublication?: LocalOnlinePublication;
  releases: LocalReleaseSummary[];
};

export type LocalLibraryCatalog = {
  schemaVersion: typeof localLibrarySchemaVersion;
  updatedAt: string;
  products: LocalProductCatalogEntry[];
};

export type LocalProductCatalogView = Omit<LocalProductCatalogEntry, "releases"> & {
  releaseCount: number;
  releases: LocalReleaseSummary[];
};

export type LocalLibrarySnapshot = {
  enabled: true;
  libraryPath: string;
  catalog: Omit<LocalLibraryCatalog, "products"> & {
    products: LocalProductCatalogView[];
  };
  publishedSummaries: TemplateSummaryDto[];
};

export type LocalTemplateLookupResult = {
  version: number;
  template: TemplatePublicDto;
  release: LocalReleaseSummary | null;
  product: LocalProductCatalogView | null;
};

export type LocalReleaseMutationResult = {
  success: true;
  version: number;
  status: LocalReleaseStatus;
  template: TemplatePublicDto;
  snapshot: LocalLibrarySnapshot;
};

export type LocalRollbackResult = {
  success: true;
  publishedVersion: number;
  template: TemplatePublicDto;
  snapshot: LocalLibrarySnapshot;
};

export type LocalImportResult = {
  success: true;
  version: number;
  template: TemplatePublicDto;
  snapshot: LocalLibrarySnapshot;
};

export type OnlinePublishConfiguration = {
  configured: boolean;
  bucket: string;
  missing: string[];
};

export type OnlinePublishResult = {
  success: true;
  slug: string;
  localVersion: number;
  onlineVersion: number;
  publishedAt: string;
  uploadedAssetCount: number;
  reusedAssetCount: number;
  totalBytes: number;
  snapshot: LocalLibrarySnapshot;
};
