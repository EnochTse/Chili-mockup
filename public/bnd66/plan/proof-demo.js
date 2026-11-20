import { proof } from '../product.js';
import { createRenderer, logoLayout } from '../render.js';

const frameMode = 'bnd66-proof-renderer';
const ownUrl = new URL(import.meta.url);
const productUrl = new URL('../', ownUrl);
const zone = proof.zones.find(({ id }) => id === 'zone1');
const box = zone.views.side;
const rotation = -90;
const scale = 70;
const colours = {
  bodyColour: '#0089ad',
  bodyFinish: 'Rubber',
  clipColour: 'original',
  clipFinish: 'Glossy'
};
const wordmark = 'NORTHLINE';
const typeface = '"Noto Sans HK", "PingFang HK", "Microsoft JhengHei", system-ui, sans-serif';
const previewSizes = {
  'exhibit-current': [1200, 900],
  'exhibit-client': [1600, 1200],
  'exhibit-proof': [1600, 1120]
};

function canvas(width, height) {
  const node = document.createElement('canvas');
  node.width = width;
  node.height = height;
  return node;
}

function makeWordmark() {
  const artwork = canvas(1000, 200);
  const drawing = artwork.getContext('2d');
  drawing.fillStyle = '#ffffff';
  drawing.beginPath();
  drawing.moveTo(0, 195);
  drawing.lineTo(104, 7);
  drawing.lineTo(219, 195);
  drawing.lineTo(170, 195);
  drawing.lineTo(104, 86);
  drawing.lineTo(43, 195);
  drawing.fill();
  drawing.beginPath();
  drawing.moveTo(90, 195);
  drawing.lineTo(110, 162);
  drawing.lineTo(134, 195);
  drawing.fill();
  drawing.font = '800 136px Arial, sans-serif';
  drawing.textBaseline = 'middle';
  drawing.fillText(wordmark, 269, 106, 725);
  return artwork;
}

async function getNativeProof() {
  const artwork = makeWordmark();
  const layout = logoLayout(artwork, box, zone, rotation, scale, 0, 0);
  const renderer = await createRenderer(canvas(proof.width, proof.height));
  const logo = { image: artwork, box, layout, rotation, method: 'uv', ink: 'original' };
  const preview = await renderer.export('side', colours, logo);
  if (!preview) throw new Error('Unable to render the BND66 example.');
  return { preview, dimensions: layout.millimetres.map(value => value.toFixed(1)).join(' × ') };
}

function proofFromProductFrame() {
  // The existing editor loads images relative to its own page. Scope the base URL
  // to a short-lived frame so the published renderer runs unchanged.
  return new Promise((resolve, reject) => {
    const frame = document.createElement('iframe');
    frame.hidden = true;
    frame.title = 'BND66 example renderer';
    const timeout = window.setTimeout(() => {
      release();
      reject(new Error('The BND66 exhibit renderer timed out.'));
    }, 10000);
    function release() {
      window.clearTimeout(timeout);
      window.removeEventListener('message', receive);
      frame.remove();
    }
    function receive(event) {
      if (event.origin !== ownUrl.origin || event.source !== frame.contentWindow ||
          event.data?.type !== frameMode) return;
      release();
      if (event.data.preview) resolve(event.data);
      else reject(new Error('The BND66 exhibit could not render.'));
    }
    window.addEventListener('message', receive);
    frame.srcdoc = '<!doctype html><html data-proof-exhibit-source>' +
      '<meta charset="utf-8"><base href="' + productUrl.href + '">' +
      '<script type="module" src="' + ownUrl.href + '"></script></html>';
    document.body.append(frame);
  });
}

function prepare(id) {
  const node = document.getElementById(id);
  if (!(node instanceof HTMLCanvasElement)) return null;
  const drawing = node.getContext('2d');
  [node.width, node.height] = previewSizes[id];
  drawing.imageSmoothingQuality = 'high';
  return drawing;
}

function text(drawing, wording, x, y, size, options = {}) {
  drawing.fillStyle = options.colour || '#172f2a';
  drawing.font = (options.weight || 500) + ' ' + size + 'px ' + typeface;
  drawing.textAlign = options.align || 'left';
  drawing.textBaseline = 'alphabetic';
  drawing.fillText(wording, x, y);
}

function line(drawing, fromX, fromY, toX, toY, colour = '#b3c0b9', weight = 2) {
  drawing.strokeStyle = colour;
  drawing.lineWidth = weight;
  drawing.beginPath();
  drawing.moveTo(fromX, fromY);
  drawing.lineTo(toX, toY);
  drawing.stroke();
}

function rubberShadow(drawing, x, y, rx, ry) {
  drawing.save();
  drawing.translate(x, y);
  drawing.scale(rx, ry);
  const gradient = drawing.createRadialGradient(0, 0, .08, 0, 0, 1);
  gradient.addColorStop(0, '#173d3241');
  gradient.addColorStop(1, '#173d3200');
  drawing.fillStyle = gradient;
  drawing.fillRect(-1, -1, 2, 2);
  drawing.restore();
}

function horizontalPen(drawing, image, source, centreX, centreY, viewLength) {
  const [x, y, width, height] = source;
  const ratio = viewLength / height;
  drawing.save();
  drawing.translate(centreX, centreY);
  drawing.rotate(Math.PI / 2);
  drawing.drawImage(image, x, y, width, height,
    -width * ratio / 2, -viewLength / 2, width * ratio, viewLength);
  drawing.restore();
}

function renderCurrent(image) {
  const drawing = prepare('exhibit-current');
  if (!drawing) return;
  drawing.fillStyle = '#eff0eb';
  drawing.fillRect(0, 0, 1200, 900);
  const height = 816;
  const width = height * proof.width / proof.height;
  drawing.drawImage(image, (1200 - width) / 2, 42, width, height);
}

function renderClient(image) {
  const drawing = prepare('exhibit-client');
  if (!drawing) return;
  const wall = drawing.createLinearGradient(0, 0, 1340, 1170);
  wall.addColorStop(0, '#f6f8ec');
  wall.addColorStop(1, '#e0ebe3');
  drawing.fillStyle = wall;
  drawing.fillRect(0, 0, 1600, 1200);
  text(drawing, 'BND66 Slim', 90, 163, 88, { weight: 650 });
  text(drawing, 'Teal Rubber · Chrome', 96, 229, 37, { colour: '#37534b' });
  rubberShadow(drawing, 846, 543, 661, 76);
  horizontalPen(drawing, image, [236, 0, 194, proof.height], 790, 455, 1376);

  drawing.fillStyle = '#f8faf2';
  drawing.fillRect(91, 715, 1418, 370);
  text(drawing, '下筆桿 Logo 細節', 131, 853, 47, { weight: 650 });
  text(drawing, '白色 UV 印刷', 132, 916, 37, { colour: '#37534b' });
  const macro = [286, 750, 142, 480];
  const photo = { x: 566, y: 751, width: 909, height: 298 };
  drawing.save();
  drawing.beginPath();
  drawing.rect(photo.x, photo.y, photo.width, photo.height);
  drawing.clip();
  rubberShadow(drawing, 1023, 1006, 515, 53);
  horizontalPen(drawing, image, macro, 1020, 899, 966);
  drawing.restore();
}

function renderProof(image, dimensions) {
  const drawing = prepare('exhibit-proof');
  if (!drawing) return;
  const accent = '#0e5d6f';
  drawing.fillStyle = '#ffffff';
  drawing.fillRect(0, 0, 1600, 1120);
  text(drawing, 'BND66 印刷校稿單', 66, 127, 66, { weight: 700 });
  text(drawing, '版面示意', 1534, 92, 32, { align: 'right', colour: accent, weight: 650 });
  text(drawing, 'v01 · 待客戶確認', 1534, 133, 27, { align: 'right', colour: '#516860' });
  line(drawing, 65, 177, 1535, 177, '#1f3935', 3);

  const drawingTop = 228;
  const drawingHeight = 740;
  const ratio = drawingHeight / proof.height;
  const x = 403;
  drawing.drawImage(image, x, drawingTop, proof.width * ratio, drawingHeight);
  text(drawing, '正面', x + proof.centres.front * ratio, 1017, 31, { align: 'center' });
  text(drawing, '側面', x + proof.centres.side * ratio, 1017, 31, { align: 'center', colour: accent, weight: 650 });

  const [zx, zy, zw, zh] = box;
  const zoneLeft = x + zx * ratio;
  const zoneTop = drawingTop + zy * ratio;
  const zoneWidth = zw * ratio;
  const zoneHeight = zh * ratio;
  drawing.save();
  drawing.setLineDash([11, 7]);
  drawing.lineWidth = 3;
  drawing.strokeStyle = accent;
  drawing.strokeRect(zoneLeft - 2, zoneTop, zoneWidth + 4, zoneHeight);
  drawing.restore();
  const centreY = zoneTop + zoneHeight / 2;
  line(drawing, zoneLeft + zoneWidth + 6, centreY, 670, centreY, accent, 3);
  text(drawing, 'Zone 1', 690, centreY + 10, 34, { weight: 650, colour: accent });
  text(drawing, '40 × 7 mm', 690, centreY + 54, 32, { colour: accent });

  line(drawing, 930, 222, 930, 1003);
  text(drawing, '印刷設定', 984, 282, 45, { weight: 650 });
  const fields = [
    ['印刷區', '下筆桿 · 側面'],
    ['Logo 尺寸', dimensions + ' mm'],
    ['方向與位置', '由下至上 · 置中'],
    ['印刷', '白色 UV'],
    ['筆身及配件', 'Teal Rubber · Chrome']
  ];
  for (const [index, [label, value]] of fields.entries()) {
    const y = 350 + index * 115;
    text(drawing, label, 984, y, 29, { colour: '#516860' });
    text(drawing, value, 984, y + 49, 39, { weight: 600 });
    line(drawing, 984, y + 69, 1535, y + 69, '#dfe6e2');
  }
  line(drawing, 65, 1052, 1535, 1052, '#dfe6e2');
  text(drawing, '示意尺寸以毫米顯示。實際生產須核對實物及原稿。', 65, 1096, 28, { colour: '#516860' });
}

async function renderExhibits() {
  if (!Object.keys(previewSizes).some(id => document.getElementById(id))) return;
  const status = document.getElementById('art-status');
  try {
    const { preview, dimensions } = await proofFromProductFrame();
    const image = await createImageBitmap(preview);
    try {
      renderCurrent(image);
      renderClient(image);
      renderProof(image, dimensions);
      if (status) status.hidden = true;
    } finally {
      image.close();
    }
  } catch (error) {
    console.warn(error.message);
    if (status) status.textContent = 'BND66 原圖暫時未能載入。請重新整理頁面再試。';
    for (const id of Object.keys(previewSizes)) {
      const drawing = prepare(id);
      if (!drawing) continue;
      drawing.fillStyle = '#eff0eb';
      drawing.fillRect(0, 0, drawing.canvas.width, drawing.canvas.height);
      text(drawing, '示意圖暫時未能載入', drawing.canvas.width / 2,
        drawing.canvas.height / 2, 40, { align: 'center' });
    }
  }
}

if (document.documentElement.hasAttribute('data-proof-exhibit-source')) {
  getNativeProof().then(result => {
    parent.postMessage({ type: frameMode, ...result }, ownUrl.origin);
  }).catch(() => parent.postMessage({ type: frameMode }, ownUrl.origin));
} else {
  renderExhibits();
}
