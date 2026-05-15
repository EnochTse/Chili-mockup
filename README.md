# Chili Product Mockup Generator

Standalone Next.js app for creating Chili product mockup previews from checked-in product templates, Pantone selections, material finish bases, part reference masks, and an uploaded client logo.

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
http://localhost:3000/
```

## Product Setup

Use `/setup` locally to edit a product template. Setup Studio can upload:

- Base product and instruction images.
- Material base images for each finish.
- Per-part reference or mask images.
- Material finish order for each part.
- Indicator anchor positions for preview callouts.

Setup Studio saves into `src/lib/templates/<productSlug>/template.json` and `public/mockup-templates/<productSlug>/`.

## Netlify Deploys

Netlify deploys this project as a static export:

```toml
[build]
  command = "npm run build:netlify"
  publish = "out"
```

The branch deploy reads checked-in templates and assets. Setup Studio saving is local-only, so commit template and asset changes before deploying.

## Testing

```bash
npm run typecheck
npm test
npm run build
```

## Known Limitations

- Pantone previews are screen approximations.
- Products need material base images and part reference masks before local layered rendering can produce reliable color previews.
- Generated images are visual references only.
- Final artwork, logo scale, print process, and production files require design-team confirmation.
