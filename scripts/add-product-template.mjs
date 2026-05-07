import fs from "node:fs/promises";
import path from "node:path";

const slugPattern = /^[a-z0-9][a-z0-9-]*$/;

const [slug, name, category, baseImageSource, instructionImageSource] = process.argv.slice(2);

if (!slug || !name || !category || !baseImageSource || !instructionImageSource) {
  console.error(
    'Usage: npm run add:product -- <slug> "<name>" "<category>" "<base-image-path>" "<instruction-image-path>"'
  );
  process.exit(1);
}

if (!slugPattern.test(slug)) {
  console.error("The slug must use lowercase letters, numbers, and hyphens only.");
  process.exit(1);
}

const workspaceRoot = process.cwd();
const templateDir = path.resolve(workspaceRoot, "src", "lib", "templates", slug);
const assetDir = path.resolve(workspaceRoot, "public", "mockup-templates", slug);
const templatePath = path.resolve(templateDir, "template.json");
const resolvedBaseSource = path.resolve(baseImageSource);
const resolvedInstructionSource = path.resolve(instructionImageSource);

const templateExists = await exists(templatePath);
if (templateExists) {
  console.error(`Template already exists for slug "${slug}".`);
  process.exit(1);
}

const baseExtension = path.extname(resolvedBaseSource).toLowerCase();
const instructionExtension = path.extname(resolvedInstructionSource).toLowerCase();

if (!baseExtension || !instructionExtension) {
  console.error("Both source images must have a file extension.");
  process.exit(1);
}

await fs.mkdir(templateDir, { recursive: true });
await fs.mkdir(assetDir, { recursive: true });

const baseFileName = `base-product${baseExtension}`;
const instructionFileName = `instruction-image${instructionExtension}`;

await fs.copyFile(resolvedBaseSource, path.resolve(assetDir, baseFileName));
await fs.copyFile(
  resolvedInstructionSource,
  path.resolve(assetDir, instructionFileName)
);

const template = {
  id: slug,
  slug,
  name,
  category,
  description: `${name} mockup generator using the provided product and instruction images.`,
  size: "",
  specifications: [],
  assetFolderPublicPath: `/mockup-templates/${slug}`,
  baseImageFileName: baseFileName,
  instructionImageFileName: instructionFileName,
  usageType: "visual_reference_only",
  allowedLogoPrintColors: ["white", "black", "original", "pantone_match"],
  defaultLogoPrintColor: "white",
  allowedPrintingMethods: [
    "silk_screen",
    "uv_print",
    "heat_transfer",
    "embroidery",
    "laser_engraving"
  ],
  pantoneLibrary: "pantone-solid-coated-v3",
  colorParts: [
    {
      id: "part-1",
      label: "Part 1",
      description: "Primary recolorable area shown in the instruction image.",
      defaultPantoneCode: "Pantone Black C"
    }
  ],
  logoPlacement: {
    description: "Place the logo only inside the marked safe area from the instruction image.",
    maxWidthMm: 120,
    maxHeightMm: 45,
    notes: "Visual reference only; final artwork must be confirmed by Chili design team."
  },
  constraints: {
    preserveBackground: true,
    preserveLighting: true,
    preserveProductShape: true,
    preserveMaterialTexture: true,
    allowOnlyDefinedRecolorRegion: true,
    allowOnlyDefinedLogoRegion: true,
    noPeople: true,
    noExtraProps: true,
    noExtraBranding: true,
    noExtraTextExceptLogo: true
  }
};

await fs.writeFile(templatePath, `${JSON.stringify(template, null, 2)}\n`, "utf8");

console.log(`Created product template "${name}" at src/lib/templates/${slug}/template.json`);
console.log(`Copied assets to public/mockup-templates/${slug}/`);
console.log(`Open http://localhost:3000/mockup/${slug}`);

async function exists(target) {
  try {
    await fs.stat(target);
    return true;
  } catch {
    return false;
  }
}
