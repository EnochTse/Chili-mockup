import fs from "node:fs";
import path from "node:path";

const [sourcePath, outputPath, libraryId = "pantone-solid-coated-v3"] = process.argv.slice(2);

if (!sourcePath || !outputPath) {
  console.error(
    "Usage: node scripts/import-pantone-acb.mjs <source.acb> <output.json> [library-id]"
  );
  process.exit(1);
}

function readUtf16BeString(buffer, cursor) {
  const length = buffer.readUInt32BE(cursor.offset);
  cursor.offset += 4;

  let text = "";
  for (let index = 0; index < length; index += 1) {
    text += String.fromCharCode(buffer.readUInt16BE(cursor.offset));
    cursor.offset += 2;
  }

  return text.replace(/\0$/, "");
}

function extractMetadataValue(text, key) {
  const marker = `${key}=`;
  const index = text.indexOf(marker);
  if (index === -1) return "";

  return text.slice(index + marker.length).replace(/^"|"$/g, "");
}

function labBytesToLab(bytes) {
  return {
    l: (bytes[0] * 100) / 255,
    a: bytes[1] - 128,
    b: bytes[2] - 128
  };
}

function labToXyzD50({ l, a, b }) {
  const fy = (l + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  const delta = 6 / 29;
  const inverse = (value) =>
    value > delta ? value ** 3 : 3 * delta ** 2 * (value - 4 / 29);

  return {
    x: 96.4212 * inverse(fx),
    y: 100 * inverse(fy),
    z: 82.5188 * inverse(fz)
  };
}

function adaptD50ToD65({ x, y, z }) {
  return {
    x: 0.9555766 * x - 0.0230393 * y + 0.0631636 * z,
    y: -0.0282895 * x + 1.0099416 * y + 0.0210077 * z,
    z: 0.0122982 * x - 0.020483 * y + 1.3299098 * z
  };
}

function xyzD65ToSrgb({ x, y, z }) {
  const normalizedX = x / 100;
  const normalizedY = y / 100;
  const normalizedZ = z / 100;
  const linear = [
    3.2404542 * normalizedX - 1.5371385 * normalizedY - 0.4985314 * normalizedZ,
    -0.969266 * normalizedX + 1.8760108 * normalizedY + 0.041556 * normalizedZ,
    0.0556434 * normalizedX - 0.2040259 * normalizedY + 1.0572252 * normalizedZ
  ];
  const encode = (channel) =>
    channel <= 0.0031308 ? 12.92 * channel : 1.055 * channel ** (1 / 2.4) - 0.055;

  return linear.map((channel) =>
    Math.round(Math.max(0, Math.min(1, encode(channel))) * 255)
  );
}

function bytesToPreviewHex(bytes) {
  const lab = labBytesToLab(bytes);
  const xyzD50 = labToXyzD50(lab);
  const rgb = xyzD65ToSrgb(adaptD50ToD65(xyzD50));

  return `#${rgb.map((value) => value.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

function normalizePantoneName(prefix, name, postfix) {
  const fullName = `${prefix}${name}${postfix}`.trim();

  return fullName.replace(/^PANTONE\b/, "Pantone");
}

function parseAcb(buffer) {
  const cursor = { offset: 0 };
  const signature = buffer.subarray(cursor.offset, cursor.offset + 4).toString("ascii");
  cursor.offset += 4;

  if (signature !== "8BCB") {
    throw new Error("Unsupported ACB file: missing 8BCB signature.");
  }

  const version = buffer.readUInt16BE(cursor.offset);
  cursor.offset += 2;
  const bookId = buffer.readUInt16BE(cursor.offset);
  cursor.offset += 2;

  const titleText = readUtf16BeString(buffer, cursor);
  const prefixText = readUtf16BeString(buffer, cursor);
  const postfixText = readUtf16BeString(buffer, cursor);
  const descriptionText = readUtf16BeString(buffer, cursor);
  const colorCount = buffer.readUInt16BE(cursor.offset);
  cursor.offset += 2;
  const pageSize = buffer.readUInt16BE(cursor.offset);
  cursor.offset += 2;
  const pageKey = buffer.readUInt16BE(cursor.offset);
  cursor.offset += 2;
  const colorModel = buffer.readUInt16BE(cursor.offset);
  cursor.offset += 2;

  if (colorModel !== 7) {
    throw new Error(`Unsupported ACB color model ${colorModel}; expected Lab model 7.`);
  }

  const prefix = extractMetadataValue(prefixText, "prefix");
  const postfix = extractMetadataValue(postfixText, "postfix");
  const colors = [];

  for (let index = 0; index < colorCount; index += 1) {
    const name = readUtf16BeString(buffer, cursor);
    const swatchCode = buffer.subarray(cursor.offset, cursor.offset + 6).toString("ascii");
    cursor.offset += 6;
    const components = [
      buffer[cursor.offset],
      buffer[cursor.offset + 1],
      buffer[cursor.offset + 2]
    ];
    cursor.offset += 3;
    const label = normalizePantoneName(prefix, name, postfix);

    colors.push({
      code: label,
      label,
      previewHex: bytesToPreviewHex(components),
      bookCode: swatchCode
    });
  }

  return {
    metadata: {
      version,
      bookId,
      title: extractMetadataValue(titleText, "title"),
      description: extractMetadataValue(descriptionText, "description"),
      pageSize,
      pageKey,
      colorModel: "Lab",
      trailingMarker: buffer.subarray(cursor.offset).toString("ascii")
    },
    colors
  };
}

const source = path.resolve(sourcePath);
const output = path.resolve(outputPath);
const parsed = parseAcb(fs.readFileSync(source));
const library = {
  id: libraryId,
  name: "PANTONE+ Solid Coated V3",
  sourceFileName: path.basename(source),
  sourceColorModel: parsed.metadata.colorModel,
  colorCount: parsed.colors.length,
  colors: parsed.colors.map(({ bookCode: _bookCode, ...color }) => color)
};

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(library, null, 2)}\n`, "utf8");

console.log(
  `Imported ${library.colorCount} colors from ${library.sourceFileName} to ${path.relative(process.cwd(), output)}`
);
