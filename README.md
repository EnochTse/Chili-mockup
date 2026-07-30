# Chili Product Mockup Generator

Standalone Next.js app for creating Chili product mockup previews from versioned product asset packs, Pantone selections, product-specific material references, part masks, and an uploaded client logo.

Generated mockups are visual references only. Final artwork, Pantone accuracy, logo size, print method, and production details must be confirmed by the Chili design team.

## Current Rendering Model

The app uses a local browser renderer only:

- Product color is applied with Pantone albedo plus luminance shading.
- Product texture and highlights come from material base images.
- Part boundaries come from per-part reference or mask images.
- Logo placement and print effects are composited locally on canvas.
- No external image-generation model or server-side image-generation function is used.

## Local Setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open:

```text
http://127.0.0.1:3000/
http://127.0.0.1:3000/setup
```

No separate backend, database, Docker service, or Supabase configuration is required for Local Studio. The first local save creates `.chili-local-library/` automatically. Set `CHILI_LOCAL_LIBRARY_PATH` only when the library should live somewhere else.

## Local Asset Library

Use `/setup` on localhost to create and version product asset packs. Setup Studio accepts:

- Base product and instruction images.
- A product-specific reference image for each supported material finish.
- Per-part reference or mask images.
- Lossless printing-area masks.
- Product-specific material response calibration.
- Optional product-and-finish-specific shadow, highlight, texture, sheen, and edge-AO maps.
- Indicator anchor positions for preview callouts.

Local Studio provides:

- Immutable draft and local-preview releases.
- Content-addressed assets, so unchanged images are not duplicated between releases.
- A lightweight catalog that loads only the selected full product, suitable for 300+ products.
- Alignment, file-signature, size, and lossless-mask validation before save.
- Published-version rollback without deleting release history.
- Portable `.chili-product.zip` export and import.
- Local draft preview at `/mockup?slug=<slug>&preview=latest`.
- Optional one-click publishing of the current local-preview release to Supabase.

Pantone colors remain runtime overlays. Do not create one image per Pantone color.

See [Local Studio Asset Library](docs/local-studio-asset-library.md) for the required pictures, file rules, folder format, and future server migration.

## Netlify Deploys

Netlify deploys this project as a static export:

```toml
[build]
  command = "npm run build:netlify"
  publish = "out"
```

The branch deploy reads checked-in templates and Supabase-published assets. The Local Asset Library is intentionally excluded from Git and Netlify builds. Netlify exposes a locked Setup page and no admin write API.

Code updates are deployed through a Git branch. Product updates use `Publish online` from
localhost: content-addressed assets are uploaded to Supabase Storage, an immutable published
version is written to Postgres, and the static Netlify site reads it without a rebuild.

Online publishing requires `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and the server-only `SUPABASE_SECRET_KEY` in
`.env.local`. Never add the secret key to Netlify or any `NEXT_PUBLIC_` variable. Apply
`supabase/migrations/20260730_create_cloud_publish_schema.sql` before the first publish.

## Testing

```bash
npm run typecheck
npm test
npm run build
```

## Known Limitations

- Pantone previews are screen approximations.
- Every supported material needs a reference image made for that product and view.
- Finish, part-mask, material-map, and print-area layers for one view must share an aspect ratio and camera alignment; differing resolutions are scaled with a quality note.
- Local drafts remain on the current machine; only an explicit `Publish online` action uploads a release.
- Generated images are visual references only.
- Final artwork, logo scale, print process, and production files require design-team confirmation.
