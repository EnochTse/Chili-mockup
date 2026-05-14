# BND62 Layered Render Plan Book

Last updated: 2026-05-13  
Prepared for: handoff to another Codex session / another computer

## 1. Goal

Replace the current BND62 Gemini-based image generation path with a deterministic layered renderer:

- no Gemini
- no Cloud Run dependency for BND62 rendering
- instant or near-instant local render in the browser
- use finish base images + part mask images + Pantone tint overlays

This plan is for a **BND62 proof of concept first**, not a full repo-wide replacement yet.

## 2. Critical Baseline Rule

Do **not** start the implementation from `main`.

Use this Netlify deploy snapshot as the implementation baseline:

- [Netlify deploy 6a02fb56848c7d00089db31d](https://app.netlify.com/projects/chilimockup/deploys/6a02fb56848c7d00089db31d)

Important note:

- From this environment, the Netlify dashboard page is JS-only, so the exact Git commit SHA behind that deploy could not be resolved automatically.
- On the other computer, the Codex session should open the Netlify deploy page in a normal browser, read the deploy's **Git commit SHA / branch**, and create the real implementation branch from that exact commit.

Suggested implementation branch name on the other computer:

- `feat/bnd62-layered-render-poc`

This current local branch is only for the plan handoff:

- `feat/bnd62-layered-render`

## 3. Source Assets To Use

Use exactly these user-provided files:

### Finish base images

- `C:/Users/enoch/Downloads/BND62_Matt.png`
- `C:/Users/enoch/Downloads/BND62_Glossy.png`
- `C:/Users/enoch/Downloads/BND62_Rubber.png`

### Part mask images

- `C:/Users/enoch/Downloads/BND62_part_1.png`
- `C:/Users/enoch/Downloads/BND62_part_2.png`
- `C:/Users/enoch/Downloads/BND62_part_3.png`

## 4. Asset Inspection Notes

These files were inspected before writing this plan.

### Measured dimensions

- `BND62_Matt.png`: `4096x4096`
- `BND62_Glossy.png`: `4096x4096`
- `BND62_Rubber.png`: `4096x4096`
- `BND62_part_1.png`: `1200x1200`
- `BND62_part_2.png`: `1200x1200`
- `BND62_part_3.png`: `1200x1200`

### Important visual finding

The current part PNGs do **not** look like final pen-shaped masks yet:

- `BND62_part_1.png` currently appears as a large red block on the left side
- `BND62_part_2.png` currently appears as a large red square block in the upper-left region
- `BND62_part_3.png` currently appears as a small red block near the top

That means one of these must be true:

1. these are placeholder masks only, or
2. these files were exported incorrectly, or
3. the attached preview order does not match the real intended mask content

Because of that, the first implementation task must be:

> Verify whether the current `BND62_part_*.png` files are the final intended masks.

If they are not the final masks, stop and request corrected mask exports before coding the renderer deeply.

## 5. What The Renderer Should Do

For BND62, the renderer should compose the final product image by:

1. loading the finish base images
2. loading the part masks
3. selecting the proper finish source for each part
4. extracting the chosen finish look for that part
5. tinting that part with the selected Pantone color
6. compositing all parts into one product render
7. reusing the current logo overlay workflow afterward

Example:

- Part 1 = Pantone 289 C + Rubber
- Part 2 = Pantone 186 C + Glossy
- Part 3 = Pantone Black C + Matte

Then:

- Part 1 pixels come from `BND62_Rubber.png`
- Part 2 pixels come from `BND62_Glossy.png`
- Part 3 pixels come from `BND62_Matt.png`

and each selected region receives its Pantone tint before final composition.

## 6. Scope For The First POC

Implement this only for:

- product slug: `bnd62`

Leave other products on the current existing rendering path for now.

The POC should prove:

- masks align correctly
- mixed finishes on different parts are possible
- Pantone tinting looks believable
- logo overlay still works
- generated preview can still be saved

## 7. Proposed Repo Changes

### 7.1 Add new layered asset files under BND62

Suggested target folder:

- `public/mockup-templates/bnd62/layered/`

Suggested copied file names:

- `public/mockup-templates/bnd62/layered/BND62_Matt.png`
- `public/mockup-templates/bnd62/layered/BND62_Glossy.png`
- `public/mockup-templates/bnd62/layered/BND62_Rubber.png`
- `public/mockup-templates/bnd62/layered/BND62_part_1.png`
- `public/mockup-templates/bnd62/layered/BND62_part_2.png`
- `public/mockup-templates/bnd62/layered/BND62_part_3.png`

### 7.2 Extend template types

Add an optional `layeredRender` block to the product template shape.

Suggested structure:

```ts
type LayeredRenderConfig = {
  enabled: boolean;
  mode: "local-layered";
  outputSize?: {
    width: number;
    height: number;
  };
  fallbackFinish: ProductFinishOption;
  finishBaseImages: Record<string, string>;
  partMasks: Record<string, string>;
  finishRules?: Record<
    ProductFinishOption,
    {
      colorOpacity: number;
      blendMode: GlobalCompositeOperation;
    }
  >;
};
```

Then add:

```ts
layeredRender?: LayeredRenderConfig;
```

to:

- `ProductTemplate`
- `TemplatePublicDto`
- `ResolvedProductTemplate` if needed

### 7.3 Configure BND62 template

In:

- `src/lib/templates/bnd62/template.json`

add a `layeredRender` section that points to the new six assets.

Also align finishing options for the proof of concept:

- Part 1: `matte`, `glossy`, `rubber`
- Part 2: `matte`, `glossy`, `rubber`
- Part 3: `matte`, `glossy`, `rubber`

Do not introduce `none` in the first POC unless the business rule requires it immediately.

Reason:

- the current asset pack only clearly supports finish-based selection
- `none` creates an extra branch in rendering logic
- better to get the core layered path working first

## 8. Rendering Strategy

## 8.1 Initial implementation approach

Implement a new browser-side function, for example:

```ts
renderLayeredProductMockup(...)
```

This should:

1. load all needed images
2. normalize masks to output canvas size
3. derive alpha mask from the red regions
4. choose per-part finish source image
5. clip the chosen finish image by that mask
6. tint with selected Pantone color
7. composite into final product image

## 8.2 Recommended compositing approach

First POC recommendation:

1. start from a fallback base finish image, preferably `matte`
2. for each part:
   - use the selected finish base image as source
   - apply the mask
   - apply Pantone tint with configurable opacity
   - paint onto the output canvas
3. after all parts are done, run the existing logo overlay composition

This is simpler than trying to rebuild the entire pen from transparency on day one.

## 8.3 Mask extraction rule

The part PNGs appear to encode the active region with red.

Suggested extraction logic:

- treat pixels close to pure red as mask-on
- treat white as mask-off
- generate an alpha mask from red coverage

Suggested first threshold:

- red channel high
- green/blue low

Example idea:

```ts
isMaskPixel = r > 200 && g < 80 && b < 80
```

This should be configurable if the source exports change later.

## 8.4 Tinting rule

Use the Pantone `previewHex` as the RGB tint source for the first POC.

Suggested per-finish defaults:

```ts
matte:   { colorOpacity: 0.85, blendMode: "multiply" }
glossy:  { colorOpacity: 0.72, blendMode: "multiply" }
rubber:  { colorOpacity: 0.90, blendMode: "multiply" }
```

These numbers should be tuned visually after the first render works.

## 9. UI / Workflow Changes

In:

- `src/components/mockup-generator.tsx`

add a conditional path:

- if `template.layeredRender?.enabled`
  - do **not** call Gemini / Cloud Run / Netlify function
  - do a local layered render instead
  - set the final data URL directly into the existing result flow

That means the current `Generate mockup` button still stays the same for the user,
but its implementation path changes for `bnd62`.

Expected result:

- render is immediate
- no polling
- no AI timeout
- no wrong-part hallucination

## 10. Files Likely To Change

Primary:

- `src/lib/types.ts`
- `src/lib/services/template.service.ts`
- `src/components/mockup-generator.tsx`
- `src/lib/templates/bnd62/template.json`

Possibly:

- `src/app/globals.css`
- `src/lib/services/finish-option.service.ts`

Asset additions:

- `public/mockup-templates/bnd62/layered/*`

## 11. Validation Checklist

Before saying the POC works, the other Codex should verify:

1. BND62 opens normally
2. selecting part colors still works
3. selecting finish per part changes visible surface character
4. mixed finishes work in one render
5. logo upload and logo overlay still work
6. save image still works
7. no Gemini call happens for BND62
8. build still passes
9. Netlify branch deploy still works

## 12. Build / Test Checklist

Minimum:

```bash
npm run typecheck
npm test
$env:NETLIFY='true'
$env:NEXT_OUTPUT_EXPORT='true'
npm run build:netlify
```

If local dev testing is needed:

```bash
npm run dev -- --port 3001
```

## 13. Risk Notes

### Risk 1: current masks may be wrong

This is the biggest risk.

If the current `BND62_part_*.png` files are placeholders instead of true masks,
the renderer work should pause until correct masks are supplied.

### Risk 2: 1200 mask vs 4096 base mismatch

If these masks are final, the implementation must rescale them carefully.

That only works safely if the 1200x1200 mask exports are perfectly aligned to the same framing ratio as the 4096x4096 base images.

### Risk 3: uncovered seams

If the three masks do not fully cover the pen body, fallback matte pixels may leak through.

That is acceptable for the first POC only if the leakage is visually negligible.

## 14. Suggested First Execution Order For The Other Codex

1. Open the Netlify deploy page and identify the exact Git commit behind deploy `6a02fb56848c7d00089db31d`
2. Create a new branch from that exact commit
3. Copy the six BND62 files into `public/mockup-templates/bnd62/layered/`
4. Verify whether `BND62_part_*.png` are real masks or placeholders
5. If masks are valid, add `layeredRender` config to `bnd62` template
6. Implement `renderLayeredProductMockup()` in `mockup-generator.tsx`
7. Route BND62 `Generate mockup` through the local layered path
8. Reuse current logo overlay after the local layered render completes
9. Tune tint opacity values by visual QA
10. Run typecheck, tests, and Netlify build

## 15. Handoff Summary

This plan is intentionally designed so the other computer's Codex can start cleanly without guessing:

- baseline is **Netlify deploy 6a02fb56848c7d00089db31d**, not `main`
- use the six exact attached files listed above
- first confirm the current three part PNGs are actually valid masks
- implement the layered path only for `bnd62` first
- keep all other products on the current path until the proof of concept is proven
