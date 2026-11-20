import { laser, proof } from './product.js';

function canvas(width, height) {
  const paper = document.createElement('canvas');
  paper.width = width;
  paper.height = height;
  return paper;
}

function ctx(paper) {
  return paper.getContext('2d', { willReadFrequently: true });
}

export function readImage(url) {
  const image = new Image();
  image.src = url;
  return image.decode().then(() => image);
}

function rgba(image) {
  const paper = canvas(image.width, image.height);
  const context = ctx(paper);
  context.drawImage(image, 0, 0);
  return context.getImageData(0, 0, image.width, image.height);
}

const clamp = (value, low = 0, high = 1) => Math.min(high, Math.max(low, value));
const luminance = (r, g, b) => (.2126 * r + .7152 * g + .0722 * b) / 255;
const component = (hex, channel) => parseInt(hex.slice(1 + channel * 2, 3 + channel * 2), 16);

function toneRange(source, mask) {
  const histogram = new Uint32Array(256);
  let total = 0;
  for (let at = 0; at < source.length; at += 4) {
    if (source[at + 3] > 245 && mask[at] > 245) {
      histogram[Math.round(luminance(source[at], source[at + 1], source[at + 2]) * 255)]++;
      total++;
    }
  }
  function quantile(fraction) {
    let cumulative = 0;
    for (let bin = 0; bin < histogram.length; bin++) {
      cumulative += histogram[bin];
      if (cumulative >= total * fraction) return bin / 255;
    }
    return 1;
  }
  return [quantile(.06), quantile(.50), quantile(.97)];
}

function tone(luma, range, finish, metallic) {
  const [dark, mid, light] = range;
  const shadow = clamp((mid - luma) / Math.max(.075, mid - dark));
  const highlight = clamp((luma - mid) / Math.max(.07, light - mid));
  if (metallic) return [1 - shadow * .51, highlight ** 2 * (finish === 'Matt' ? .43 : .68)];
  if (finish === 'Glossy') return [1 - shadow * .38, highlight ** 2.25 * .48];
  if (finish === 'Matt') return [1 - shadow * .26, highlight ** 1.5 * .21];
  return [1 - shadow * .32, highlight ** 1.65 * .17];
}

function recolour(original, target, gain, light, finish, metallic) {
  if (target === null) {
    const darken = metallic && finish === 'Matt' ? .88 : 1;
    return original * darken;
  }
  return target * gain * (1 - light) + 255 * light;
}

export function logoLayout(image, box, zone, rotation, scale, vertical, horizontal) {
  const [left, top, width, height] = box;
  const sideways = rotation !== 0;
  const extentX = sideways ? image.height : image.width;
  const extentY = sideways ? image.width : image.height;
  const ratio = Math.min(width / extentX, height / extentY) * scale / 100;
  const footprintX = extentX * ratio;
  const footprintY = extentY * ratio;
  return {
    x: left + width / 2 + (width - footprintX) / 2 * horizontal / 100,
    y: top + height / 2 + (height - footprintY) / 2 * vertical / 100,
    width: image.width * ratio,
    height: image.height * ratio,
    across: footprintX / width * zone.size[1],
    along: footprintY / height * zone.size[0],
    millimetres: [sideways ? footprintY / height * zone.size[0] : footprintX / width * zone.size[1],
      sideways ? footprintX / width * zone.size[1] : footprintY / height * zone.size[0]]
  };
}

function drawLogo(context, options) {
  const { image, box, layout, rotation, method, ink } = options;
  const stamp = canvas(Math.ceil(Math.max(1, layout.width)), Math.ceil(Math.max(1, layout.height)));
  const stampContext = ctx(stamp);
  stampContext.drawImage(image, 0, 0, stamp.width, stamp.height);
  const reflection = laser[method];
  if (reflection || ink !== 'original') {
    stampContext.globalCompositeOperation = 'source-in';
    if (reflection) {
      const silver = stampContext.createLinearGradient(0, 0, stamp.width, stamp.height);
      reflection.forEach((colour, index) => silver.addColorStop(index / (reflection.length - 1), colour));
      stampContext.fillStyle = silver;
    } else {
      stampContext.fillStyle = ink;
    }
    stampContext.fillRect(0, 0, stamp.width, stamp.height);
  }
  context.save();
  context.beginPath();
  context.rect(...box);
  context.clip();
  context.translate(layout.x, layout.y);
  context.rotate(rotation * Math.PI / 180);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(stamp, -layout.width / 2, -layout.height / 2, layout.width, layout.height);
  context.restore();
}

export async function createRenderer(visible) {
  const [photo, bodyImage, clipImage, rear] = await Promise.all([
    readImage('assets/bnd66-product.webp'), readImage('assets/bnd66-body-mask.png'),
    readImage('assets/bnd66-clip-mask.png'), readImage('assets/bnd66-back-outline.png')
  ]);
  if ([photo, bodyImage, clipImage].some(img => img.width !== proof.width || img.height !== proof.height)
      || rear.width !== proof.rearWidth || rear.height !== proof.height) throw Error('The product assets are misaligned.');
  const source = rgba(photo).data;
  const body = rgba(bodyImage).data;
  const clip = rgba(clipImage).data;
  const bodyRange = toneRange(source, body);
  const clipRange = toneRange(source, clip);
  const base = canvas(proof.width, proof.height);
  const baseContext = ctx(base);
  const buffer = baseContext.createImageData(base.width, base.height);
  const indices = [];
  for (let at = 0; at < source.length; at += 4) if (source[at + 3]) indices.push(at);
  const active = new Uint32Array(indices);
  let lastColours = '';

  function paintBase(colours) {
    const { bodyColour, clipColour, bodyFinish, clipFinish } = colours;
    const signature = [bodyColour, clipColour, bodyFinish, clipFinish].join('|');
    if (signature === lastColours) return;
    lastColours = signature;
    const bodyRgb = bodyColour === 'original' ? null : [0, 1, 2].map(i => component(bodyColour, i));
    const clipRgb = clipColour === 'original' ? null : [0, 1, 2].map(i => component(clipColour, i));
    const out = buffer.data;
    for (const at of active) {
      const part = body[at] / 255;
      const metal = clip[at] / 255;
      const lum = luminance(source[at], source[at + 1], source[at + 2]);
      const [bodyGain, bodyLight] = tone(lum, bodyRange, bodyFinish, false);
      const [clipGain, clipLight] = tone(lum, clipRange, clipFinish, true);
      for (let k = 0; k < 3; k++) {
        const pixel = source[at + k];
        let paintedBody = recolour(pixel, bodyRgb?.[k] ?? null, bodyGain, bodyLight, bodyFinish, false);
        if (bodyRgb === null && bodyFinish !== 'Rubber') {
          const reflection = bodyFinish === 'Glossy' ? bodyLight * .65 : bodyLight * .25;
          paintedBody = pixel * (1 - reflection) + 255 * reflection;
        }
        const paintedClip = recolour(pixel, clipRgb?.[k] ?? null, clipGain, clipLight, clipFinish, true);
        out[at + k] = pixel * (1 - part - metal) + paintedBody * part + paintedClip * metal;
      }
      out[at + 3] = source[at + 3];
    }
    baseContext.putImageData(buffer, 0, 0);
  }

  function paint(destination, view, colours, logo) {
    const rearView = view === 'rear';
    const expected = rearView ? proof.rearWidth : proof.width;
    if (destination.width !== expected) destination.width = expected;
    if (destination.height !== proof.height) destination.height = proof.height;
    const context = ctx(destination);
    context.clearRect(0, 0, destination.width, destination.height);
    if (rearView) context.drawImage(rear, 0, 0);
    else {
      paintBase(colours);
      context.drawImage(base, 0, 0);
    }
    if (logo) drawLogo(context, logo);
  }

  return {
    draw(view, colours, logo) { paint(visible, view, colours, logo); },
    export(view, colours, logo) {
      const output = canvas(1, 1);
      paint(output, view, colours, logo);
      return new Promise(resolve => output.toBlob(resolve, 'image/png'));
    }
  };
}
