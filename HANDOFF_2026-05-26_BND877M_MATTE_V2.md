# Handoff: 2026-05-26 BND62 / BND877M Layered Renderer Work

This handoff is for continuing the Chili mockup tool work on another device with Codex.

## Non-Negotiable Workflow Rules

- Always answer the user in Traditional Chinese.
- Do not use a local dev server.
- Do not use `localhost`, `npm run dev`, or browser validation against a local server.
- For every update, create a new Git branch.
- Push every update to GitHub as a new branch.
- Use the pushed GitHub branch to trigger/check Netlify branch deploy.
- Validate with build commands only, then confirm GitHub/Netlify remote status.
- Keep local noise out of commits: `next-env.d.ts`, `.codex-dev.log`, `.codex-dev.err.log`.

## Current Project

- Repo: `https://github.com/EnochTse/Chili-mockup`
- Local repo path used today: `C:\Users\enoch\Documents\Codex\2026-05-26\files-mentioned-by-the-user-handoff\Chili-mockup`
- Latest branch to continue from: `codex/matte-shadow-polarity-20260526-160300`
- Latest commit: `1bdd0b13ad5dac7944ac5ec18239f70289c0e04c`
- Latest commit link: `https://github.com/EnochTse/Chili-mockup/commit/1bdd0b13ad5dac7944ac5ec18239f70289c0e04c`

## Latest State

The best current BND877M matte state is on:

```text
codex/matte-shadow-polarity-20260526-160300
```

This branch includes all prior BND877M matte map work, part masks, Matte V2 renderer changes, dark matte visibility improvements, texture/depth tuning, and the latest shadow polarity fix.

Current known local noise after work:

```text
M next-env.d.ts
?? .codex-dev.err.log
?? .codex-dev.log
```

Do not commit these.

## Branch And Commit Timeline

1. `codex/bnd62-glossy-cache-20260526-105214`
   Commit: `d865c2b`
   Change: Cached decoded layered finish sources and manual material maps for BND62 glossy performance. Added deferred part selections so preview interaction is less sticky.

2. `codex/bnd877m-matte-maps-20260526-120640`
   Commit: `32505b0`
   Change: Added six BND877M matte layered maps under `public/mockup-templates/bnd877m/layered/` and enabled `layeredRender` for BND877M matte.

3. `codex/bnd877m-layered-partmasks-20260526-131622`
   Commit: `9dac158`
   Change: Added `BND877M_part_1.png`, `BND877M_part_2.png`, and `BND877M_part_3.png`. Wired them into `layeredRender.partMasks` so BND877M uses BND62-style map + part mask stacking instead of instruction-image fallback.

4. `codex/bnd877m-matte-tuning-20260526-143817`
   Commit: `e7e11c3`
   Change: First matte realism tuning. Reduced glossy-style specular and highlight lift for matte.

5. `codex/matte-v2-proof-20260526-151301`
   Commit: `31fdaff`
   Change: Added the shared Matte V2 material model and `docs/matte-v2-asset-spec.md`. Updated Setup Studio matte defaults and BND877M matte rule.

6. `codex/matte-v21-dark-lighting-20260526-152728`
   Commit: `f264e1d`
   Change: Fixed dark matte becoming solid black by adding low-reflectance light response, visible sheen, and soft-light response for black/dark matte colors.

7. `codex/matte-v22-depth-texture-20260526-154119`
   Commit: `6798403`
   Change: Increased matte depth and microtexture. Reduced soft-light flattening while increasing form contrast, edge/shadow impact, and micrograin visibility.

8. `codex/matte-shadow-polarity-20260526-160300`
   Commit: `1bdd0b1`
   Change: Fixed matte shadow map polarity. Matte now treats dark pixels in `shadow` maps as shadowed surface and bright pixels as lit surface, eliminating the x-ray / inverted-curves look.

## Main Files Changed

- `src/components/mockup-generator.tsx`
  Core layered renderer changes. Contains BND62 performance caching and the Matte V2 material logic.

- `src/lib/templates/bnd877m/template.json`
  BND877M layeredRender configuration. It references the BND877M matte maps and part masks.

- `src/lib/services/template-editor.service.ts`
  Setup Studio defaults for new layered matte products.

- `docs/matte-v2-asset-spec.md`
  New spec for future matte product asset packs.

- `public/mockup-templates/bnd877m/layered/`
  Contains BND877M matte maps and part masks.

## Current BND877M Matte Asset Setup

Current BND877M uses:

```text
public/mockup-templates/bnd877m/layered/BND877M_matte_base.png
public/mockup-templates/bnd877m/layered/BND877M_matte_shadow.png
public/mockup-templates/bnd877m/layered/BND877M_matte_highlight.png
public/mockup-templates/bnd877m/layered/BND877M_matte_texture.png
public/mockup-templates/bnd877m/layered/BND877M_matte_specular.png
public/mockup-templates/bnd877m/layered/BND877M_matte_edge_ao.png
public/mockup-templates/bnd877m/layered/BND877M_part_1.png
public/mockup-templates/bnd877m/layered/BND877M_part_2.png
public/mockup-templates/bnd877m/layered/BND877M_part_3.png
```

Renderer key mapping:

```text
base      -> matte_base
shadow    -> matte_form_shadow / current BND877M_matte_shadow
highlight -> matte_soft_light / current BND877M_matte_highlight
texture   -> matte_micrograin / current BND877M_matte_texture
specular  -> matte_sheen / current BND877M_matte_specular
edgeAo    -> matte_edge_ao
```

Important latest decision:

```text
For matte shadow maps, dark pixels mean shadowed surface and bright pixels mean lit surface.
```

This was changed because the previous interpretation created an x-ray / inverted-curves look.

## Visual Feedback Progress

User feedback sequence:

- Initial BND877M matte maps were misaligned because maps and part masks were not wired like BND62.
- After part masks were added, geometry alignment was fixed.
- Matte first looked unrealistic, gray, and plastic.
- Matte V2 was introduced as a shared renderer model for all future matte products.
- First Matte V2 pass made black too solid and lost texture.
- Dark matte lighting response fixed the solid-black issue.
- Depth/texture tuning made it better but still slightly flat.
- Latest fix addressed the shadow polarity inversion that made shadows look x-ray-like.

## Validation Already Run

For latest branch `codex/matte-shadow-polarity-20260526-160300`:

```text
npm run build
npm run build:netlify
```

Both passed.

Do not run local dev server. Build commands are allowed for validation.

## Netlify / GitHub Remote Notes

All work was pushed to GitHub branches.

GitHub check-runs repeatedly returned `total_count: 0` for the newer Codex branches, so no Netlify branch deploy URL was available from GitHub checks during this session.

Important: still push every update to GitHub as a new branch and check whether Netlify branch deploy appears. If Netlify checks still do not appear, state that clearly instead of claiming deployment completed.

Latest branch page:

```text
https://github.com/EnochTse/Chili-mockup/tree/codex/matte-shadow-polarity-20260526-160300
```

Latest commit page:

```text
https://github.com/EnochTse/Chili-mockup/commit/1bdd0b13ad5dac7944ac5ec18239f70289c0e04c
```

## Build Issue Encountered

During one `npm run build:netlify`, Next build hit a Windows local Node OOM. A leftover `node.exe` process was using about 6 GB RAM. It was killed, then `npm run build:netlify` passed.

If this happens again:

```text
cmd /c tasklist /FI "IMAGENAME eq node.exe"
cmd /c taskkill /PID <pid> /F
npm run build:netlify
```

The OOM was environmental, not caused by the matte polarity fix.

## Next Recommended Work

Continue from latest branch:

```text
git fetch origin
git checkout codex/matte-shadow-polarity-20260526-160300
```

Then create a new branch for the next update:

```text
git checkout -b codex/<short-task-name>-<timestamp>
```

Likely next task:

- Review the latest BND877M matte output from the pushed branch.
- If shadow direction now looks correct, only make small tuning changes.
- If the product still feels slightly flat, adjust `matte` texture/depth gently in `src/components/mockup-generator.tsx`.
- If texture still cannot become realistic, regenerate only the four weak assets: `base`, `soft_light`, `micrograin`, and `sheen` according to `docs/matte-v2-asset-spec.md`.

Do not replace the full system unless the user asks. The latest renderer direction is now acceptable; the main remaining risk is asset quality.

## Commit Discipline

Before committing:

```text
git status --short --branch
git diff -- <changed-files>
npm run build
npm run build:netlify
```

Stage only intended files. Do not commit:

```text
next-env.d.ts
.codex-dev.log
.codex-dev.err.log
```

After commit:

```text
git push -u origin <new-branch>
```

Then check GitHub commit checks / Netlify status. If Netlify does not show a deploy/check, say so explicitly.
