# Chili AI Product Mockup Generator

Standalone Next.js app for generating Chili product mockups from a product template, selected Pantone color, printing method, logo print color, and uploaded client logo.

Generated mockups are visual references only. They are not final production artwork. Final artwork, Pantone accuracy, logo size, print method, and production details must be confirmed by the Chili design team.

## Tech Stack

- Next.js App Router
- React + TypeScript
- Tailwind CSS
- Zod validation
- `@google/genai` for Gemini / Nano Banana 2 image generation
- Local MVP storage under `tmp/uploads` and `public/generated`

## Project Structure

```text
public/
  mockup-templates/
    umbrella-classic-black/
      base-product.png
      instruction-image.jpg
  generated/
src/
  app/
    api/
      mockup/generate/route.ts
      templates/[productSlug]/route.ts
    page.tsx
    mockup/[productSlug]/page.tsx
  components/
    mockup-generator.tsx
  lib/
    pantone/
    services/
      ai.service.ts
      logo.service.ts
      prompt.service.ts
      storage.service.ts
      template.service.ts
      validation.service.ts
    templates/
      umbrella-classic-black/template.json
tests/
```

## Local Setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open:

```text
http://localhost:3000/
```

## Environment Variables

`.env.example` includes the required variables:

```bash
AI_STUB_MODE=false
GEMINI_API_KEY=
# Alternative accepted aliases: GOOGLE_API_KEY or GOOGLE_GENAI_API_KEY
GEMINI_IMAGE_MODEL=gemini-3.1-flash-image-preview
GEMINI_IMAGE_ASPECT_RATIO=1:1
GEMINI_IMAGE_SIZE=1K
GEMINI_REQUEST_TIMEOUT_MS=300000
GEMINI_CONTROL_REQUEST_TIMEOUT_MS=20000
GEMINI_BATCH_POLL_INTERVAL_MS=5000
GEMINI_BATCH_MAX_WAIT_MS=180000
APP_BASE_URL=http://localhost:3000
TEMP_UPLOAD_DIR=./tmp/uploads
PUBLIC_GENERATED_DIR=./public/generated
GENERATED_OUTPUT_DIR=./public/generated
OUTPUT_STORAGE_MODE=filesystem
MAX_UPLOAD_SIZE_MB=4
```

Hard rule: real generation uses a real Gemini image model, defaulting to Nano Banana 2 (`gemini-3.1-flash-image-preview`). `GEMINI_API_KEY` must be set, and copied base-image results are blocked. The app returns `MISSING_GEMINI_API_KEY` or `REAL_AI_REQUIRED` instead of falling back to a placeholder.

## Stub Mode

Stub mode no longer returns a copied product photo as a generated result. If `AI_STUB_MODE=true`, the API returns `REAL_AI_REQUIRED` so a fake mockup cannot be mistaken for real Gemini output.

## Real Gemini Mode

Use real mode for production-like testing:

```bash
AI_STUB_MODE=false
GEMINI_API_KEY=your_key_here
GEMINI_IMAGE_MODEL=gemini-3.1-flash-image-preview
```

The Gemini provider submits the prompt and the product reference images to Nano Banana 2 by default through Gemini batch generation, then polls the batch job until the image is ready:

- Image A: base product photo from the product template
- Image B: instruction image from the product template
- Image C and later: optional isolated per-part mask images, one for each configured product part that supplies a mask asset
- The deterministic prompt built by `src/lib/services/prompt.service.ts`

The returned inline image is a clean product mockup without the uploaded logo. It is saved to `public/generated/`, and the API returns an `imageUrl` beginning with `/generated/`. The browser then applies the original uploaded logo locally as a locked canvas overlay, preserving the source logo shape while adding the selected print-effect preview. Template assets are validated before generation so starter, placeholder, demo, or sample files cannot enter the real mockup flow.

Instruction overlays in the template image are guide marks only. Colored masks, red part masks, green logo boxes, outlines, and similar annotations must never appear in the final generated mockup.

## Netlify Test Deploys

This project deploys to Netlify as a static Next.js export plus one small Netlify Function at `/.netlify/functions/generate-mockup`. This avoids a large monolithic Next SSR handler.

Use the checked-in `netlify.toml` settings:

```toml
[build]
  command = "npm run build:netlify"
  publish = "out"
```

For a Netlify test deploy, set these environment variables in the Netlify UI and make sure the scope includes Functions:

```bash
AI_STUB_MODE=false
GEMINI_API_KEY=your_key_here
GEMINI_IMAGE_MODEL=gemini-3.1-flash-image-preview
GEMINI_IMAGE_ASPECT_RATIO=1:1
GEMINI_IMAGE_SIZE=1K
GEMINI_CONTROL_REQUEST_TIMEOUT_MS=20000
GEMINI_BATCH_POLL_INTERVAL_MS=5000
GEMINI_BATCH_MAX_WAIT_MS=180000
OUTPUT_STORAGE_MODE=data_url
MAX_UPLOAD_SIZE_MB=4
NEXT_PUBLIC_SHOW_DEBUG=true
```

`.env.local` is only for local development and is not deployed to Netlify. If you need larger generated images on Netlify, replace `OUTPUT_STORAGE_MODE=data_url` with a persistent storage service such as Netlify Blobs, S3, or another object store.

For `MISSING_GEMINI_API_KEY` on Netlify, set the key in **Site configuration → Environment variables** and make sure the variable scope includes **Functions** for the deploy context you are testing. A key set only in `.env.local`, only on your machine, or only for the wrong deploy context will not be visible to `/.netlify/functions/generate-mockup`.

If Netlify still reports old `/api/templates/[productSlug]` route errors, clear the Netlify build cache and deploy again. The Netlify build script removes stale `.next`, `out`, and `src/app/api` artifacts before export, then verifies that no Next API artifacts remain.

## Product Templates

Each product is auto-discovered from:

```text
public/mockup-templates/<productSlug>/base-product image
public/mockup-templates/<productSlug>/instruction-image
src/lib/templates/<productSlug>/template.json
```

Each `colorParts[]` entry in `template.json` can also optionally define `partMaskImageFileName`. When present, the app resolves that file from the same `public/mockup-templates/<productSlug>/` asset folder and sends it to Gemini as an isolated part reference. This is designed to reduce common failures such as coloring the wrong region, bleeding into neighboring parts, or skipping a small part entirely.

The backend resolves absolute filesystem paths from `productSlug` and `template.json`. The frontend receives only public URLs. The homepage and `/mockup/[productSlug]` routes are generated from every discovered template folder.

Fastest way to add a product:

```bash
npm run add:product -- "<product-slug>" "Display Name" "category" "C:\path\to\base-product.png" "C:\path\to\instruction-image.jpg"
```

Example:

```bash
npm run add:product -- "mug-classic-white" "Classic White Mug" "mug" "C:\assets\mug-base.png" "C:\assets\mug-instruction.png"
```

The script will copy both images, create `src/lib/templates/<productSlug>/template.json`, and make the new product available at `/mockup/<productSlug>`.

Manual option:

1. Create `public/mockup-templates/<productSlug>/`.
2. Add a real `base-product` image and a real `instruction-image`.
3. Optionally add one isolated mask image per recolorable part, for example `body-mask.png`, `lid-mask.png`, `clip-mask.png`.
4. Create `src/lib/templates/<productSlug>/template.json`.
5. Point `assetFolderPublicPath`, `baseImageFileName`, and `instructionImageFileName` to those assets. For any part that has its own mask, add `partMaskImageFileName` inside that `colorParts[]` item.
6. Open `/mockup/<productSlug>`.

## Testing

```bash
npm run typecheck
npm test
npm run build
```

Manual smoke test:

1. Set `AI_STUB_MODE=true`.
2. Run `npm run dev`.
3. Open `/mockup/umbrella-classic-black`.
4. Select Pantone, logo print color, printing method, and upload a PNG/JPG/WebP/SVG logo.
5. Generate and confirm stub mode is rejected with `REAL_AI_REQUIRED`.
6. Set `AI_STUB_MODE=false`, add `GEMINI_API_KEY`, restart dev server, and generate again.
7. Confirm `provider=gemini`, `model=gemini-3.1-flash-image-preview`, `stubMode=false`, the output file exists under `public/generated/`, and the result uses the correct product image, instruction image, and uploaded logo.

## Odoo Iframe Embed

Deploy this standalone app to a staging/test domain first. Do not embed it into a live Odoo product page until real mode returns `provider=gemini` and `stubMode=false`.

```html
<iframe
  src="https://your-domain.com/mockup/umbrella-classic-black"
  width="100%"
  height="1000"
  style="border:0; max-width:100%;"
></iframe>
```

## Known Limitations

- Pantone previews are screen approximations.
- AI logo rendering can vary and must be checked by Chili.
- Generated images are visual references only.
- Final artwork, logo scale, print process, and production files require design-team confirmation.
- Odoo quotation, CRM, payment, login, admin dashboard, and PDF proof export are intentionally out of scope for this sprint.
