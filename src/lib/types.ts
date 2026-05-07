export interface PantoneOption {
  code: string;
  previewHex: string;
  label: string;
}

export interface ProductSpecification {
  label: string;
  value: string;
}

export interface ProductColorPart {
  id: string;
  label: string;
  description: string;
  instructionCue?: string;
  instructionColorHex?: string;
  defaultPantoneCode?: string;
}

export interface LogoPlacement {
  description: string;
  maxWidthMm: number;
  maxHeightMm: number;
  notes: string;
}

export interface TemplateConstraints {
  preserveBackground: boolean;
  preserveLighting: boolean;
  preserveProductShape: boolean;
  preserveMaterialTexture: boolean;
  allowOnlyDefinedRecolorRegion: boolean;
  allowOnlyDefinedLogoRegion: boolean;
  noPeople: boolean;
  noExtraProps: boolean;
  noExtraBranding: boolean;
  noExtraTextExceptLogo: boolean;
}

export interface ProductTemplate {
  id: string;
  slug: string;
  name: string;
  category: string;
  description: string;
  size?: string;
  specifications?: ProductSpecification[];
  assetFolderPublicPath: string;
  baseImageFileName: string;
  instructionImageFileName: string;
  usageType: "visual_reference_only";
  allowedLogoPrintColors: string[];
  defaultLogoPrintColor: string;
  allowedPrintingMethods: string[];
  pantoneLibrary?: string;
  pantoneOptions: PantoneOption[];
  colorParts: ProductColorPart[];
  logoPlacement: LogoPlacement;
  constraints: TemplateConstraints;
}

export interface ResolvedProductTemplate extends ProductTemplate {
  baseImagePublicUrl: string;
  instructionImagePublicUrl: string;
  baseProductImagePath: string;
  instructionImagePath: string;
}

export interface TemplateSummaryDto {
  id: string;
  slug: string;
  name: string;
  category: string;
  description: string;
  size?: string;
  baseImageUrl: string;
  instructionImageUrl: string;
}

export interface TemplatePublicDto {
  id: string;
  slug: string;
  name: string;
  category: string;
  description: string;
  size?: string;
  specifications?: ProductSpecification[];
  baseImageUrl: string;
  instructionImageUrl: string;
  usageType: "visual_reference_only";
  allowedLogoPrintColors: string[];
  defaultLogoPrintColor: string;
  allowedPrintingMethods: string[];
  pantoneOptions: PantoneOption[];
  colorParts: ProductColorPart[];
  logoPlacement: LogoPlacement;
  constraints: TemplateConstraints;
}

export interface SelectedPartPantone {
  partId: string;
  partLabel: string;
  partDescription: string;
  instructionCue?: string;
  instructionColorHex?: string;
  pantoneCode: string;
  pantone: PantoneOption;
}

export interface ValidatedMockupRequest {
  productSlug: string;
  logoPrintColor: string;
  printingMethod: string;
  removeBackground: boolean;
  logoFile: File;
  selectedPartPantones: SelectedPartPantone[];
}
