# Local Studio Asset Library

Local Studio applies the scalable asset model without adding a separate backend server. It runs through the existing `npm run dev` Next.js process and stores product data outside Git in `.chili-local-library/`.

The development server is bound to `127.0.0.1`, so Local Studio write routes are not exposed to other devices on the LAN.

## What To Provide For Each Product View

Prepare only the materials the real product supports:

1. `product-base`: A clean product image without a customer logo.
2. `instruction`: A clear reference used to identify color-controlled parts and placement.
3. `part-mask`: One lossless PNG or WebP for every independently recolorable part.
4. `finish-reference`: One aligned image for each supported finish, such as matte, glossy, rubber, metallic, or chrome.
5. `printing-area`: One lossless PNG or WebP for each genuinely supported print method.

Do not provide one image per Pantone color. Pantone remains a runtime overlay.

For most products, those five asset groups are enough. Each finish card also contains an optional **Advanced calibrated maps** section. Leave it closed while the automatic result is accurate. If a specific product and finish needs correction, add only the maps that are necessary:

- `Form shadow`: Broad form and curvature.
- `Soft highlight`: Broad light without baked product color.
- `Surface texture`: Fine, low-contrast material detail.
- `Specular / sheen`: Controlled reflective response.
- `Edge AO`: Tight seam and contact darkening.

These maps belong to that product and finish only. They are never shared as a universal material across products.

## Alignment Rules

- Use one camera, crop, canvas size, product position, scale, silhouette, and perspective for the whole view.
- Recommended master size is 4096x4096.
- All compositing layers in one view must use the same aspect ratio, camera, crop, and product position: finish references, part masks, technical material maps, and print-area masks.
- Exact matching pixel dimensions are preferred. Higher-resolution masks are accepted and scaled with a quality note.
- The catalog product image and instruction reference may use a different resolution because they are not directly composited into the material layer stack.
- Use PNG or lossless WebP for part masks and technical material maps.
- Existing JPEG print-area masks remain usable with a warning; use PNG or lossless WebP for new print-area masks to keep edges accurate.
- Product and finish references may use PNG, WebP, or high-quality JPEG, but lossless sources are preferred.
- Do not add logos, watermarks, labels, guides, or props to finish references.
- Keep a neutral or controllable source color so the Pantone overlay does not inherit a strong baked tint.

Local Studio rejects files with a false extension, invalid image signature, excessive size, or mismatched aspect ratio. It records non-blocking quality notes for scaled layers, low resolution, shared finish references, externally linked files, and automatically derived material maps.

## Local Workflow

```text
1. Run npm run dev
2. Open http://127.0.0.1:3000/setup
3. Create or select a product
4. Upload the product, masks, finish references, and print areas
5. Adjust each finish's product-specific response
6. If needed, open Advanced calibrated maps and add only the map that needs correction
7. Save draft
8. Open Preview latest and test representative colors
9. Publish locally
10. Export a portable product ZIP when a backup or handoff is needed
```

Representative QC colors should include white, black, neutral gray, bright red, yellow, and dark blue.

## Storage Layout

```text
.chili-local-library/
|-- catalog.json
|-- blobs/
|   `-- <sha256>.<extension>
`-- products/
    `-- <slug>/
        `-- releases/
            |-- v1.json
            `-- v2.json
```

Blobs are content-addressed. If a 4096px image is unchanged in ten releases, it is stored once. Release manifests are immutable; publishing and rollback only update catalog pointers.

The Setup product list reads a lightweight catalog containing only each product's latest release summary and release count. It loads the selected product's full manifest and complete rollback history on demand. Adding 300 or more products therefore does not send every template, asset map, or release history to the browser at startup.

The library location can be changed in `.env.local`:

```text
CHILI_LOCAL_STUDIO_ENABLED=true
CHILI_LOCAL_LIBRARY_PATH=C:\Chili Mockup Library
MAX_UPLOAD_SIZE_MB=64
MAX_PRODUCT_PACKAGE_SIZE_MB=512
```

## Security Boundary

- Local write APIs accept requests from `localhost`, `127.0.0.1`, or `::1` only.
- Production mode requires `CHILI_LOCAL_STUDIO_ENABLED=true` explicitly.
- Netlify static export removes all Next.js API routes.
- The remote `/setup` page is locked and does not expose Supabase anonymous writes.
- Local blobs are served with immutable private caching and `nosniff`.

The repository includes `supabase/migrations/20260730_lock_public_template_writes.sql`. Apply it in Supabase before treating the current cloud project as secure. The migration removes temporary anonymous write policies, allows public reads only for published versions, and reserves cloud writes for authenticated emails listed in `admin_emails`.

## Future Server Migration

The product manifest and asset references are already separated from the React editor and renderer. A future server should implement the same operations:

```text
CatalogRepository
AssetStore
ReleasePublisher
```

Migration steps:

1. Upload content-addressed blobs to object storage.
2. Import product and release manifests into the metadata database.
3. Replace the localhost API adapter with an authenticated server adapter.
4. Point published blob references at the CDN.
5. Keep the renderer, material calculations, Setup form, and product packages unchanged.

Server-side image derivatives and background QC workers can be added later without changing the source asset-pack contract.
