export interface PantoneOption {
  code: string;
  previewHex: string;
  label: string;
}

export interface ProductSpecification {
  label: string;
  value: string;
}

export type ProductFinishOption = "matte" | "glossy" | "rubber" | "metallic";

export interface LayeredRenderFinishRule {
  colorOpacity: number;
  blendMode: GlobalCompositeOperation;
  highlightProtection?: number;
  textureStrength?: number;
  saturationBoost?: number;
}

export interface LayeredRenderConfig {
  enabled: boolean;
  mode: "local-layered";
  outputSize?: {
    width: number;
    height: number;
  };
  fallbackFinish: ProductFinishOption;
  finishBaseImages: Partial<Record<ProductFinishOption, string>>;
  partMasks: Record<string, string>;
  finishRules?: Partial<Record<ProductFinishOption, LayeredRenderFinishRule>>;
}

export interface ProductColorPart {
  id: string;
  label: string;
  description: string;
  instructionCue?: string;
  instructionColorHex?: string;
  partMaskImageFileName?: string;
  defaultPantoneCode?: string;
  allowedFinishes?: ProductFinishOption[];
  defaultFinish?: ProductFinishOption;
  indicatorAnchors?: PartIndicatorAnchor[];
}

export interface TemplatePublicColorPart extends ProductColorPart {
  partMaskImageUrl?: string;
}

export interface ResolvedProductColorPart extends ProductColorPart {
  partMaskImagePath?: string;
  partMaskImagePublicUrl?: string;
}

export interface PartIndicatorAnchor {
  id: string;
  targetXPercent: number;
  targetYPercent: number;
  labelOffsetXPercent: number;
  labelOffsetYPercent: number;
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
  layeredRender?: LayeredRenderConfig;
  logoPlacement: LogoPlacement;
  constraints: TemplateConstraints;
}

export interface ResolvedProductTemplate extends Omit<ProductTemplate, "colorParts"> {
  colorParts: ResolvedProductColorPart[];
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
  colorParts: TemplatePublicColorPart[];
  layeredRender?: LayeredRenderConfig;
  logoPlacement: LogoPlacement;
  constraints: TemplateConstraints;
}

export interface SelectedPartPantone {
  partId: string;
  partLabel: string;
  partDescription: string;
  instructionCue?: string;
  instructionColorHex?: string;
  partMaskImagePath?: string;
  partMaskImageUrl?: string;
  pantoneCode: string;
  pantone: PantoneOption;
  selectedFinish?: ProductFinishOption;
}

export interface ValidatedMockupRequest {
  productSlug: string;
  logoPrintColor: string;
  printingMethod: string;
  removeBackground: boolean;
  logoFile: File;
  selectedPartPantones: SelectedPartPantone[];
}
