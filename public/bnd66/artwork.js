const limit = 10 * 1024 * 1024;
const maxSide = 1700;
const folder = new URL('./vendor/pdfjs/', import.meta.url).href;

function bitmapCanvas(image, width, height) {
  const ratio = Math.min(1, maxSide / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * ratio));
  canvas.height = Math.max(1, Math.round(height * ratio));
  const context = canvas.getContext('2d');
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export async function loadArtwork(file) {
  if (!file.size || file.size > limit) throw Error('Choose a non-empty logo file up to 10 MB.');
  const ext = file.name.toLowerCase().split('.').pop();
  if (!['ai', 'pdf', 'png', 'jpg', 'jpeg'].includes(ext)) throw Error('Choose a PDF-compatible AI, PDF, PNG or JPG.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const png = [137, 80, 78, 71, 13, 10, 26, 10].every((byte, offset) => bytes[offset] === byte);
  if (ext === 'png' || ext === 'jpg' || ext === 'jpeg') {
    if (!(ext === 'png' ? png : jpeg)) throw Error('The logo format does not match its filename.');
    const bitmap = await createImageBitmap(file);
    try {
      const image = bitmapCanvas(bitmap, bitmap.width, bitmap.height);
      return { name: file.name, pages: 1, jpeg, render: async () => image, close: async () => {} };
    } finally {
      bitmap.close();
    }
  }
  if (!new TextDecoder().decode(bytes.slice(0, 1024)).includes('%PDF-')) {
    throw Error(ext === 'ai' ? 'Save the AI with Create PDF Compatible File enabled, or export a PDF or PNG.'
      : 'This file could not be opened as a PDF.');
  }
  const pdfjs = await import(folder + 'pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = folder + 'pdf.worker.mjs';
  const task = pdfjs.getDocument({
    data: bytes, isEvalSupported: false, enableXfa: false, maxImageSize: 18000000,
    cMapUrl: folder + 'cmaps/', cMapPacked: true,
    wasmUrl: folder + 'wasm/', standardFontDataUrl: folder + 'standard_fonts/'
  });
  let pdf;
  try {
    pdf = await task.promise;
  } catch (error) {
    await task.destroy().catch(() => {});
    if (error.name === 'PasswordException') throw Error('Open the PDF in its editor and export an unlocked copy.');
    throw Error('This PDF or AI could not be opened. Try a new PDF or transparent PNG.');
  }
  return {
    name: file.name, pages: pdf.numPages, jpeg: false,
    async render(number) {
      const page = await pdf.getPage(number);
      const original = page.getViewport({ scale: 1 });
      if (!original.width || !original.height) throw Error('The chosen artboard is empty.');
      const viewport = page.getViewport({ scale: maxSide / Math.max(original.width, original.height) });
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.ceil(viewport.width));
      canvas.height = Math.max(1, Math.ceil(viewport.height));
      await page.render({ canvas, viewport, background: 'rgba(0,0,0,0)' }).promise;
      page.cleanup();
      return canvas;
    },
    close: () => task.destroy()
  };
}

export function removeJpegBackground(image) {
  const output = bitmapCanvas(image, image.width, image.height);
  const { width, height } = output;
  const context = output.getContext('2d');
  const pixels = context.getImageData(0, 0, width, height);
  const data = pixels.data;
  const corners = [0, width - 1, width * (height - 1), width * height - 1];
  const rgb = [0, 1, 2].map(channel => {
    const values = corners.map(at => data[at * 4 + channel]).sort((a, b) => a - b);
    return (values[1] + values[2]) / 2;
  });
  const near = (at, radius) => [0, 1, 2].every(ch => Math.abs(data[at * 4 + ch] - rgb[ch]) <= radius);
  if (corners.filter(at => near(at, 35)).length < 3) throw Error('Try a JPG with an even background or a transparent PNG.');
  const visited = new Uint8Array(width * height);
  const queue = new Uint32Array(visited.length);
  let count = 0;
  function push(at) {
    if (!visited[at] && near(at, 51)) {
      visited[at] = 1;
      queue[count++] = at;
    }
  }
  for (let x = 0; x < width; x++) { push(x); push((height - 1) * width + x); }
  for (let y = 0; y < height; y++) { push(y * width); push(y * width + width - 1); }
  for (let cursor = 0; cursor < count; cursor++) {
    const at = queue[cursor];
    const distance = Math.max(...[0, 1, 2].map(ch => Math.abs(data[at * 4 + ch] - rgb[ch])));
    data[at * 4 + 3] = Math.round(Math.max(0, (distance - 16) / 35) * 255);
    if (at % width > 0) push(at - 1);
    if (at % width < width - 1) push(at + 1);
    if (at >= width) push(at - width);
    if (at < width * (height - 1)) push(at + width);
  }
  if (count > width * height * .999) throw Error('The logo and background were too similar. Use a transparent PNG.');
  context.putImageData(pixels, 0, 0);
  return output;
}
