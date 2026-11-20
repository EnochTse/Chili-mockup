import { bodyOptions, clipOptions, findColour, laser, methods, proof } from './product.js';
import { createRenderer, logoLayout } from './render.js';
import { loadArtwork, removeJpegBackground } from './artwork.js';

const $ = id => document.getElementById(id);
const state = {
  source: 'live', guide: 'parts', part: 'clip', body: 'reference', clip: 'chrome',
  bodyFinish: 'Rubber', clipFinish: 'Glossy', method: 'none',
  zone: 'zone1', view: 'side', preferredView: 'side', photo: 'product',
  document: null, logo: null, originalLogo: null, noBackground: false, busy: false
};
const formatter = new Intl.NumberFormat('en', { maximumFractionDigits: 1 });
const titleView = { front: 'Front', side: 'Side', rear: 'Rear' };
const number = zone => zone.id.slice(-1);
const customSwatch = 'conic-gradient(from 45deg,#ff7770,#ffdf75,#58cfa4,#68c4ff,#8671e7,#ff7770)';
let renderer, artworkRequest = 0, exportUrl, frame = 0, guidesKey = '';
document.getElementById('design-form').addEventListener('submit', event => event.preventDefault());

function make(tag, label, attrs = {}) {
  const el = document.createElement(tag);
  if (label) el.textContent = label;
  for (const [key, val] of Object.entries(attrs)) el.setAttribute(key, val);
  return el;
}

function pressed(parent, key, value) {
  for (const button of parent.querySelectorAll('button[' + key + ']')) button.setAttribute('aria-pressed', String(button.getAttribute(key) === value));
}

function buttons(id, options, key, onChange, swatch = false) {
  const parent = $(id);
  for (const [value, name, colour] of options) {
    const button = make('button', swatch ? '' : name, {
      type: 'button', 'data-value': value, 'aria-pressed': String(state[key] === value)
    });
    if (swatch) {
      button.className = 'swatch';
      button.title = name;
      button.setAttribute('aria-label', name);
      button.style.setProperty('--swatch', colour
        ? key === 'clip' ? 'linear-gradient(95deg,' + colour + ' 8%,#fff 45%,' + colour + ' 75%,#333 155%)' : colour
        : customSwatch);
    }
    button.addEventListener('click', () => {
      state[key] = value;
      pressed(parent, 'data-value', value);
      state.source = 'live';
      onChange();
      update();
    });
    parent.append(button);
  }
}

function getZone() {
  return proof.zones.find(zone => zone.id === state.zone);
}

function selectOptions(select, values, current) {
  select.replaceChildren(...values.map(([value, name]) => new Option(name, value)));
  select.value = current;
}

function applyZone(id, view) {
  const changedZone = state.zone !== id;
  state.zone = id;
  const zone = getZone();
  const views = Object.keys(zone.views);
  if (view) state.preferredView = view;
  state.view = views.includes(state.preferredView) ? state.preferredView : views[0];
  selectOptions($('view'), views.map(v => [v, titleView[v]]), state.view);
  $('view').disabled = views.length === 1;
  $('zone').value = id;
  if (changedZone) $('vertical').value = $('horizontal').value = '0';
  state.guide = 'zones';
  state.source = 'live';
}

function zoneName(zone) {
  return 'Zone ' + number(zone) + ' · ' + zone.label + ' · ' + zone.size.join(' × ') + ' mm';
}

function colour(part) {
  const options = part === 'body' ? bodyOptions : clipOptions;
  const [id, name, hex] = options.find(entry => entry[0] === state[part]);
  const isOriginal = part === 'clip' && id === 'chrome';
  if (id !== 'custom') return { label: name, hex: isOriginal ? 'original' : hex };
  const parsed = findColour($(part + '-colour').value);
  return parsed || { label: 'Enter a Pantone or hex colour', hex: 'original', pending: true };
}

function colourFields(body, clip) {
  for (const [part, colour] of [['body', body], ['clip', clip]]) {
    $(part + '-custom').hidden = state[part] !== 'custom';
    $(part + '-colour').setAttribute('aria-invalid', String(!!colour.pending));
    if (state[part] !== 'custom') continue;
    const feedback = $(part + '-feedback');
    feedback.replaceChildren();
    if (colour.pending) {
      feedback.textContent = 'Use a supported code or a 6-digit hex colour.';
    } else {
      const chip = make('i');
      chip.style.backgroundColor = colour.hex;
      feedback.append(chip, colour.label + ' · Screen preview');
    }
  }
}

function logoOptions() {
  if (!state.logo || state.method === 'none' || state.busy) return null;
  const zone = getZone();
  const box = zone.views[state.view];
  const inkChoice = $('ink').value;
  const ink = inkChoice === 'custom' ? findColour($('ink-custom').value)?.hex : inkChoice;
  if (!ink && !laser[state.method]) return null;
  const rotation = Number($('orientation').value);
  const layout = logoLayout(state.logo, box, zone, rotation, Number($('size').value),
    Number($('vertical').value), Number($('horizontal').value));
  return { image: state.logo, box, layout, rotation, method: state.method, ink };
}

function stageGuides() {
  const marker = $('markers'), legend = $('legends');
  const signature = [state.guide, state.part, state.zone, state.view].join('|');
  if (guidesKey === signature) return;
  guidesKey = signature;
  const previous = document.activeElement?.dataset.guideChoice;
  marker.replaceChildren();
  legend.replaceChildren();
  const rear = state.view === 'rear';
  const width = rear ? proof.rearWidth : proof.width;
  const x = value => value / width * 100 + '%';
  const y = value => value / proof.height * 100 + '%';
  $('guide-note').hidden = state.guide === 'clean';
  legend.hidden = state.guide === 'clean' || (rear && state.guide === 'parts');

  function pin(left, top, direction, text, label, active, onClick, key) {
    const item = make('div', '', { class: 'pin ' + direction });
    item.style.left = x(left);
    item.style.top = y(top);
    const button = make('button', text, { type: 'button', 'aria-label': label, 'aria-pressed': String(active), 'data-guide-choice': key });
    button.addEventListener('click', onClick);
    item.append(button);
    marker.append(item);
  }
  function legendItem(text, active, onClick, key) {
    const button = make('button', text, { type: 'button', 'aria-pressed': String(active), 'data-guide-choice': key });
    button.addEventListener('click', onClick);
    legend.append(button);
  }
  if (state.guide === 'parts' && !rear) {
    for (const part of proof.colourParts) {
      const activate = () => { state.part = part.id; update(); };
      const label = part.title + ' · ' + part.label;
      pin(part.x, part.y, part.side, part.title, label, state.part === part.id, activate, 'pin-' + part.id);
      legendItem(label, state.part === part.id, activate, 'legend-' + part.id);
    }
  }
  if (state.guide === 'zones') {
    for (const zone of proof.zones) {
      const active = zone.id === state.zone;
      legendItem('Zone ' + number(zone) + ' · ' + zone.size.join(' × ') + ' mm', active,
        () => { applyZone(zone.id); update(); }, 'legend-' + zone.id);
      for (const [view, box] of Object.entries(zone.views)) {
        if ((view === 'rear') !== rear) continue;
        const [left, top, w, h] = box;
        const selected = active && state.view === view;
        const rect = make('div', '', { class: selected ? 'zone-box active' : 'zone-box', 'aria-hidden': 'true' });
        Object.assign(rect.style, { left: x(left), top: y(top), width: x(w), height: y(h) });
        marker.append(rect);
        const onLeft = view === 'front';
        pin(onLeft ? left : left + w, top + h / 2, onLeft ? 'left' : 'right',
          'Zone ' + number(zone), zoneName(zone) + ' · ' + titleView[view], selected,
          () => { applyZone(zone.id, view); update(); }, 'pin-' + zone.id + '-' + view);
      }
    }
  }
  const views = rear ? ['rear'] : ['front', 'side'];
  $('view-captions').replaceChildren(...views.map(view => {
    const span = make('span', titleView[view]);
    span.style.left = x(proof.centres[view]);
    return span;
  }));
  for (const candidate of [...marker.querySelectorAll('button'), ...legend.querySelectorAll('button')]) {
    if (previous && candidate.dataset.guideChoice === previous) candidate.focus({ preventScroll: true });
  }
}

function update() {
  const body = colour('body'), clip = colour('clip'), logo = logoOptions();
  const attached = !!state.logo && state.method !== 'none';
  const showInk = state.method !== 'none' && !laser[state.method];
  const unresolvedInk = attached && showInk && $('ink').value === 'custom' && !findColour($('ink-custom').value);
  const customPending = (state.view !== 'rear' && (body.pending || clip.pending)) || unresolvedInk;
  $('live-view').hidden = state.source !== 'live';
  $('photos-view').hidden = state.source !== 'photos';
  pressed(document, 'data-source', state.source);
  pressed(document, 'data-guide', state.guide);
  pressed($('methods'), 'data-value', state.method);
  colourFields(body, clip);
  $('preview').setAttribute('aria-label', state.view === 'rear'
    ? 'BND66 rear printing outline' : 'BND66 pen shown from the front and side');
  const summary = ['1 · ' + body.label, '2 · ' + clip.label];
  if ($('summary').textContent !== summary.join('')) $('summary').replaceChildren(...summary.map(label => make('span', label)));
  const realSize = logo ? logo.layout.millimetres.map(value => formatter.format(value)).join(' × ') + ' mm' : '';
  $('dimensions').textContent = realSize;
  $('stage-size').textContent = realSize ? 'Logo dimension ' + realSize : '';
  $('stage-size').hidden = !realSize;
  const note = state.view === 'rear' ? 'Screen approximation only. Rear view uses the printing drawing.' : 'Screen approximation only.';
  $('screen-note').textContent = note;
  $('size-label').textContent = $('size').value + '%';
  $('horizontal-label').textContent = $('horizontal').value + '%';
  $('vertical-label').textContent = $('vertical').value + '%';
  $('ink-field').hidden = !showInk;
  $('ink-custom-field').hidden = !showInk || $('ink').value !== 'custom';
  if (unresolvedInk) $('ink-custom').setAttribute('aria-invalid', 'true');
  else $('ink-custom').removeAttribute('aria-invalid');
  $('ink-feedback').textContent = unresolvedInk ? 'Enter a supported code or a 6-digit hex colour.' : '';
  $('clear').disabled = !state.document && !state.busy;
  for (const name of ['size', 'horizontal', 'vertical', 'orientation', 'centre', 'ink']) $(name).disabled = !attached || state.busy;
  $('export').disabled = !renderer || state.busy || !!customPending;
  $('background-actions').hidden = !state.document?.jpeg || !state.originalLogo;
  $('toggle-background').textContent = state.noBackground ? 'Restore JPG background' : 'Remove JPG background';
  stageGuides();
  if (!renderer) return;
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(() => renderer.draw(state.view, {
    bodyColour: body.hex, clipColour: clip.hex, bodyFinish: state.bodyFinish, clipFinish: state.clipFinish
  }, logo));
}

function showArtworkError(message = '') {
  $('artwork-error').textContent = message;
  $('artwork-error').hidden = !message;
}

async function paintArtboard(document, page, request) {
  try {
    const image = await document.render(page);
    if (request !== artworkRequest) return;
    state.logo = state.originalLogo = image;
    state.noBackground = false;
    $('artwork-status').textContent = document.name + (document.pages > 1 ? ' · Artboard ' + page + ' of ' + document.pages : ' · Logo loaded');
  } catch {
    if (request !== artworkRequest) return;
    state.logo = state.originalLogo = null;
    showArtworkError('Could not preview this artboard. Choose another page or export a PNG.');
    $('artwork-status').textContent = '';
  } finally {
    if (request === artworkRequest) { state.busy = false; update(); }
  }
}

function resetArtwork(clearFile = true) {
  state.document?.close().catch(() => {});
  state.document = state.logo = state.originalLogo = null;
  state.noBackground = false;
  $('artboard-field').hidden = true;
  $('artboard').replaceChildren();
  $('artwork-status').textContent = '';
  if (clearFile) $('artwork').value = '';
  showArtworkError();
}

async function importArtwork(file) {
  const request = ++artworkRequest;
  resetArtwork(false);
  state.busy = true;
  $('artwork-status').textContent = 'Loading artwork…';
  update();
  try {
    const art = await loadArtwork(file);
    if (request !== artworkRequest) { await art.close(); return; }
    state.document = art;
    selectOptions($('artboard'), Array.from({ length: art.pages }, (_, index) => [index + 1, 'Artboard ' + (index + 1)]), '1');
    $('artboard-field').hidden = art.pages === 1;
    if (state.method === 'none') state.method = 'uv';
    state.source = 'live';
    state.guide = 'zones';
    await paintArtboard(art, 1, request);
  } catch (error) {
    if (request !== artworkRequest) return;
    state.busy = false;
    $('artwork').value = '';
    $('artwork-status').textContent = '';
    showArtworkError(error.message || 'Could not load that logo.');
    update();
  }
}

buttons('body-options', bodyOptions, 'body', () => { state.part = 'body'; state.guide = 'parts'; }, true);
buttons('clip-options', clipOptions, 'clip', () => { state.part = 'clip'; state.guide = 'parts'; }, true);
buttons('finishes', ['Glossy', 'Matt', 'Rubber'].map(value => [value, value]), 'bodyFinish', () => { state.part = 'body'; state.guide = 'parts'; });
buttons('clip-finishes', ['Glossy', 'Matt'].map(value => [value, value]), 'clipFinish', () => { state.part = 'clip'; state.guide = 'parts'; });
buttons('methods', methods, 'method', () => { if (state.method !== 'none') state.guide = 'zones'; });
selectOptions($('zone'), proof.zones.map(zone => [zone.id, 'Zone ' + number(zone) + ' · ' + zone.size.join(' × ') + ' mm']), state.zone);
applyZone('zone1');
state.guide = 'parts';

for (const button of document.querySelectorAll('[data-source]')) button.addEventListener('click', () => {
  state.source = button.dataset.source;
  if (state.source === 'photos') showPhoto();
  update();
});
for (const button of document.querySelectorAll('[data-guide]')) button.addEventListener('click', () => {
  state.guide = button.dataset.guide;
  update();
});
for (const button of document.querySelectorAll('[data-photo]')) button.addEventListener('click', () => {
  state.photo = button.dataset.photo;
  showPhoto();
});
function showPhoto() {
  const drawing = state.photo === 'printing';
  $('gallery-photo').src = drawing ? 'assets/bnd66-printing-guide.webp' : 'assets/product-photo.webp';
  $('gallery-photo').alt = drawing ? 'BND66 printing guide with three views and zone dimensions' : 'Black BND66 Slim from the front and side';
  pressed($('photos-view'), 'data-photo', state.photo);
}

$('zone').addEventListener('change', event => { applyZone(event.target.value); update(); });
$('view').addEventListener('change', event => { applyZone(state.zone, event.target.value); update(); });
$('artwork').addEventListener('change', event => { if (event.target.files[0]) importArtwork(event.target.files[0]); });
$('artboard').addEventListener('change', event => {
  if (!state.document) return;
  state.busy = true;
  showArtworkError();
  $('artwork-status').textContent = 'Rendering artboard…';
  update();
  paintArtboard(state.document, Number(event.target.value), ++artworkRequest);
});
for (const id of ['body-colour', 'clip-colour', 'ink-custom', 'size', 'vertical', 'horizontal', 'orientation', 'ink']) $(id).addEventListener('input', update);
$('centre').addEventListener('click', () => { $('vertical').value = $('horizontal').value = '0'; update(); });
$('clear').addEventListener('click', () => { artworkRequest++; resetArtwork(); state.busy = false; update(); });
$('toggle-background').addEventListener('click', () => {
  if (!state.originalLogo) return;
  showArtworkError();
  try {
    state.logo = state.noBackground ? state.originalLogo : removeJpegBackground(state.originalLogo);
    state.noBackground = !state.noBackground;
    update();
  } catch (error) {
    showArtworkError(error.message);
  }
});

$('export').addEventListener('click', async () => {
  const body = colour('body'), clip = colour('clip');
  const preview = await renderer.export(state.view, {
    bodyColour: body.hex, clipColour: clip.hex, bodyFinish: state.bodyFinish, clipFinish: state.clipFinish
  }, logoOptions());
  if (!preview) { showArtworkError('Could not generate the PNG. Try again.'); return; }
  if (exportUrl) URL.revokeObjectURL(exportUrl);
  exportUrl = URL.createObjectURL(preview);
  $('download-image').src = exportUrl;
  $('download-link').href = exportUrl;
  $('download-link').download = 'BND66-' + (state.view === 'rear' ? 'rear-' : '') + 'mockup.png';
  if (!$('download-dialog').open) $('download-dialog').showModal();
});
$('close-dialog').addEventListener('click', () => $('download-dialog').close());
$('download-dialog').addEventListener('close', () => {
  $('download-image').removeAttribute('src');
  $('download-link').removeAttribute('href');
  if (exportUrl) URL.revokeObjectURL(exportUrl);
  exportUrl = null;
});

update();
createRenderer($('preview')).then(loaded => { renderer = loaded; update(); }).catch(error => {
  $('stage-error').textContent = error.message || 'The product preview could not load.';
  $('stage-error').hidden = false;
});
