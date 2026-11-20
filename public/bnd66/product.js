export const proof = {
  width: 430,
  height: 1642,
  rearWidth: 156,
  centres: { front: 74.55, side: 359.05, rear: 77.45 },
  zones: [
    { id: 'zone1', label: 'Lower barrel', size: [40, 7],
      views: { front: [33.2, 758.7, 82.7, 472.5], side: [317.7, 751.4, 82.7, 472.5], rear: [36.1, 762.3, 82.7, 472.5] } },
    { id: 'zone2', label: 'Upper barrel', size: [20, 7],
      views: { side: [315.7, 443.6, 82.7, 236.3] } },
    { id: 'zone3', label: 'Side cap', size: [6, 6],
      views: { side: [319.6, 18.8, 70.9, 70.9] } }
  ],
  colourParts: [
    { id: 'body', title: 'Part 1', label: 'Body', x: 356, y: 1030, side: 'right' },
    { id: 'clip', title: 'Part 2', label: 'Clip', x: 75, y: 335, side: 'left' }
  ]
};

export const bodyOptions = [
  ['reference', 'Teal · PSD sample', '#0089ad'],
  ['black', 'Black', '#131419'],
  ['navy', 'Navy PMS 289C', '#0c2340'],
  ['red', 'Red PMS 485C', '#da291c'],
  ['white', 'White', '#f5f5f3'],
  ['custom', 'Your Own Pantone Color']
];

export const clipOptions = [
  ['chrome', 'Chrome', '#d2d4d6'],
  ['gold', 'Gold', '#c7a247'],
  ['rose', 'Rose Gold', '#bd7866'],
  ['silver', 'Silver', '#a9a9ac'],
  ['titanium', 'Titanium', '#66625c'],
  ['custom', 'Your Own Pantone Color']
];

const colourReferences = new Map([
  ['VIOLET C', '#440099'], ['485 C', '#da291c'], ['289 C', '#0c2340'],
  ['BLACK C', '#2d2926'], ['BLACK 7 C', '#3d3935'], ['PROCESS BLUE C', '#0085ca'],
  ['299 C', '#00a3e0'], ['313 C', '#0092bc'], ['320 C', '#009ca6'],
  ['232 C', '#e93cac'], ['186 C', '#c8102e'], ['185 C', '#e4002b'],
  ['123 C', '#ffc72c'], ['021 C', '#fe5000'], ['354 C', '#00b140'],
  ['286 C', '#0033a0'], ['293 C', '#003da5'], ['300 C', '#005eb8'],
  ['COOL GRAY 7 C', '#97999b'], ['WHITE', '#ffffff'], ['BLACK', '#000000']
]);

export function findColour(input) {
  const text = input.trim().toUpperCase().replace(/^(?:PANTONE|PMS)\s*/, '').replace(/\s+/g, ' ');
  if (/^#[A-F\d]{6}$/.test(text)) return { hex: text, label: text };
  const ref = text.replace(/^(.*\S)C$/, '$1 C').replace(/\s+/g, ' ');
  const hex = colourReferences.get(ref);
  return hex ? { hex, label: ref } : null;
}

export const methods = [
  ['none', 'None'],
  ['chrome', 'Chrome mirror laser'],
  ['gold', 'Gold mirror laser'],
  ['rose', 'Rose gold mirror laser'],
  ['pad', 'Pad printing'],
  ['uv', 'UV printing']
];

export const laser = {
  chrome: ['#666b74', '#f8fbff', '#a0a6b0'],
  gold: ['#825615', '#fff1a8', '#be831e'],
  rose: ['#8a4a43', '#ffe0d5', '#c28072']
};
