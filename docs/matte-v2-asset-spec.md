# Matte V2 Asset Specification

Matte V2 treats matte as a separate material model, not as a weakened glossy render. Every product using the matte layered renderer should provide aligned technical maps on the same canvas, with the same crop, scale, perspective, and product position.

## Required Canvas Rules

- All files must share the same pixel dimensions.
- All files must use the same crop, product position, silhouette, and perspective.
- Part masks must align exactly with every material map.
- PNG is preferred for masks and maps.
- Do not add labels, guides, callouts, shadows outside the product, or watermarks.

## Required Files

- `matte_base.png`: Neutral clean product base. Keep only minimal diffuse form readability. Avoid baked shadows, strong highlights, visible gray fog, color tint, dirt, scratches, or dramatic contrast.
- `matte_form_shadow.png`: Broad form shadow only. Black means no shadow, white means strongest darkening. Include cylindrical falloff and large surface curvature. Avoid seams, texture grain, and highlights.
- `matte_edge_ao.png`: Tight ambient occlusion only. Black means no edge darkening, white means strongest contact darkening. Include seams, part breaks, handle contact, cap/body separation, and small underside occlusion.
- `matte_soft_light.png`: Broad diffuse light only. Black means no light, white means strongest matte light. Keep it wide and soft. Avoid sharp glossy streaks.
- `matte_micrograin.png`: Low-contrast matte micro texture. Product area should sit around 50% gray. Small deviations create fine grain. Avoid visible scratches, dust, stains, cloudy patches, or large gradients.
- `matte_sheen.png`: Very low-intensity matte sheen. Black means no sheen, white means maximum allowed sheen, but most product pixels should stay dark. Avoid glossy reflections and bright hard highlights.
- `part_1.png`, `part_2.png`, etc.: Technical part masks. Red product pixels on a white or transparent background are supported by the current renderer.

## Template Key Mapping

- `base` should reference `matte_base.png`.
- `shadow` should reference `matte_form_shadow.png`.
- `highlight` should reference `matte_soft_light.png`.
- `texture` should reference `matte_micrograin.png`.
- `specular` should reference `matte_sheen.png`.
- `edgeAo` should reference `matte_edge_ao.png`.

## Brightness Targets

- `matte_base.png`: product average should stay visually neutral, not washed out or smoky.
- `matte_form_shadow.png`: broad shadows should usually stay below 70% brightness except the deepest areas.
- `matte_edge_ao.png`: edge lines can be bright, but broad regions should remain mostly black.
- `matte_soft_light.png`: light should be soft and controlled; avoid large pure-white areas.
- `matte_micrograin.png`: product area should stay near 50% gray with very low contrast.
- `matte_sheen.png`: most product pixels should stay near black; only soft sheen zones should rise.

## AI Generation Prompt Notes

When generating these maps, ask for "technical compositing maps" rather than a beautiful grayscale render. The output should be useful data for a renderer, not a finished product visualization.

Use strict wording for every file:

```text
Keep the canvas size, product position, crop, scale, silhouette, perspective, and all part boundaries exactly identical to the reference image. Do not redraw, recenter, resize, rotate, stylize, or alter the product shape. This is a technical map for a mockup renderer, not a finished render.
```

## Common Failures

- Base map has baked gray fog, making black colors look plastic.
- Soft light or sheen map behaves like glossy specular.
- Micrograin map contains scratches or dirt, making products look damaged.
- Edge AO contains broad shadows, making recolored products muddy.
- Part masks are generated from a different crop or canvas.
- Black matte is rendered as solid black because the material model has no visible low-reflectance light response.

## Rollout Plan

1. Use BND877M as the Matte V2 proof product.
2. Keep the existing `part_*`, `shadow`, and `edge_ao` maps if they align correctly.
3. Regenerate `base`, `soft_light`, `micrograin`, and `sheen` if the proof still looks smoky or glossy.
4. Apply the same asset pack structure to future matte products.
5. Add automated matte map quality checks after two or three products confirm the target look.
