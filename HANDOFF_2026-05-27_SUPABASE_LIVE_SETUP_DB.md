# Handoff - Supabase Live Setup Database

Date: 2026-05-27
Workspace: current repo root is the `Chili Mockup tool - Copy` folder.
Latest branch: `codex/supabase-live-setup-db-20260527-175655`
Latest pushed commit: `8ad1577` - `Add Supabase live setup database`

## Communication

- User requires Traditional Chinese replies.
- User does not know coding/frontend/backend, so explain steps plainly.
- Avoid asking the user to understand implementation details unless necessary.

## Current State

- The branch `codex/supabase-live-setup-db-20260527-175655` is pushed to GitHub.
- GitHub check-runs API returned `total_count: 0` for commit `8ad1577`.
- Local uncommitted noise that should not be committed unless intentionally needed:
  - `next-env.d.ts`
  - `.codex-dev.err.log`
  - `.codex-dev.log`
  - `HANDOFF_BND62_GLOSSY.md`

## What Was Implemented

First phase of **Supabase Live Setup Database** is implemented.

Main files:

- `src/lib/services/live-template-database.service.ts`
  - Browser-side Supabase client.
  - Reads latest draft/published template rows.
  - Saves template versions as `draft` or `published`.
  - Compactly stores template JSON without the full Pantone library.

- `src/components/template-setup-studio.tsx`
  - Detects Supabase env variables.
  - Shows live database mode.
  - Adds `Save draft` and `Publish live`.
  - Blocks image uploads in Supabase phase 1 because Storage is not connected yet.
  - Allows editing existing product settings only.

- `src/components/mockup-generator.tsx`
  - Loads build-time local template first.
  - If Supabase is configured, loads the latest `published` live template in the browser and overrides the page state.
  - This keeps Netlify static export working while allowing live published settings.

- `.env.example`, `netlify.env.example`, `scripts/create-netlify-env-from-local.mjs`
  - Add Supabase public env variables.

- `package.json`, `package-lock.json`
  - Adds `@supabase/supabase-js`.
  - Upgrades `next` from `16.2.4` to `16.2.6` to clear npm audit vulnerability.

## Supabase Project

Project ID from screenshot: `skekjibplyyeovefhcwx`
Project URL:

```text
https://skekjibplyyeovefhcwx.supabase.co
```

Netlify env variables should be set:

```text
NEXT_PUBLIC_SUPABASE_URL=https://skekjibplyyeovefhcwx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon public key from Supabase API settings>
```

Do not store or commit the full anon key in repo docs. Never expose `service_role`.

## Database Tables

If recreating Supabase from scratch, run this first in Supabase SQL Editor:

```sql
create extension if not exists pgcrypto;

create table if not exists public.admin_emails (
  email text primary key,
  created_at timestamptz default now()
);

create table if not exists public.product_templates (
  slug text primary key,
  name text not null,
  category text,
  published_version_id uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.product_template_versions (
  id uuid primary key default gen_random_uuid(),
  slug text not null references public.product_templates(slug) on delete cascade,
  version int not null,
  status text not null check (status in ('draft', 'published', 'archived')),
  template jsonb not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(slug, version),
  unique(slug, id)
);

alter table public.product_templates
add constraint product_templates_published_version_fk
foreign key (slug, published_version_id)
references public.product_template_versions(slug, id)
on delete set null;
```

## Current Blocker

User got this error when saving in Setup Studio:

```text
Failed to save product template row: new row violates row-level security policy for table "product_templates"
```

This means Supabase RLS is blocking anon writes. For temporary development testing, tell the user to run this in Supabase SQL Editor:

```sql
alter table public.product_templates enable row level security;
alter table public.product_template_versions enable row level security;

drop policy if exists "dev allow anon read product_templates" on public.product_templates;
drop policy if exists "dev allow anon write product_templates" on public.product_templates;
drop policy if exists "dev allow anon read product_template_versions" on public.product_template_versions;
drop policy if exists "dev allow anon write product_template_versions" on public.product_template_versions;

create policy "dev allow anon read product_templates"
on public.product_templates
for select
to anon
using (true);

create policy "dev allow anon write product_templates"
on public.product_templates
for all
to anon
using (true)
with check (true);

create policy "dev allow anon read product_template_versions"
on public.product_template_versions
for select
to anon
using (true);

create policy "dev allow anon write product_template_versions"
on public.product_template_versions
for all
to anon
using (true)
with check (true);
```

Important: this is insecure for production because anyone with the site can write. Use only to confirm live database works. Next production step is Supabase Auth + RLS using `admin_emails`.

## How To Test On Other Device

1. Pull branch:

```powershell
git fetch origin
git switch codex/supabase-live-setup-db-20260527-175655
git pull
```

2. Install dependencies:

```powershell
npm install
```

3. Verify:

```powershell
npm run typecheck
npm test
npm run build
npm run build:netlify
```

Expected current validation:

- `npm run typecheck`: pass
- `npm test`: 4 files, 10 tests pass
- `npm run build`: pass
- `npm run build:netlify`: pass
- `npm audit --omit=dev`: 0 vulnerabilities

4. On deployed Netlify `/setup`:

- Select existing product, e.g. `bnd877m`.
- Change a simple setting, e.g. indicator position or label offset.
- Click `Save draft`.
- If OK, click `Publish live`.
- Open `/mockup/bnd877m`; it should load local template first, then live published template from Supabase.

## Known Limitations

- Phase 1 is database only.
- Image upload is intentionally blocked in live database mode until Supabase Storage is implemented.
- New products are not supported in live database mode yet because product images and maps still live in repo/public assets.
- Existing product asset paths still point to checked-in files under `/mockup-templates/...`.
- No Auth yet. Do not publicly share `/setup` until Supabase Auth/RLS is implemented.

## Next Recommended Work

1. Confirm temporary RLS policy lets Setup Studio save and publish.
2. Add Supabase Auth login for `/setup`.
3. Replace temporary anon write policy with secure RLS:
   - Public can read published versions.
   - Only authenticated emails in `admin_emails` can insert/update draft/published versions.
4. Add Supabase Storage phase:
   - Upload mapping/base/part/printing images to Storage.
   - Store storage paths or public URLs in template JSON.
   - Add thumbnail/preview handling for Setup Studio.
5. Add a small migration/seed tool to publish current local templates into Supabase.

## Recent Visual Work Context

- Matte black BND877M had issues with dark texture/detail loss.
- Shared matte rule was adjusted over several branches to improve dark matte visibility without product-specific exceptions.
- BND877M metallic maps were added:
  - `BND877M_metallic_base.png`
  - `BND877M_metallic_shadow.png`
  - `BND877M_metallic_highlight.png`
  - `BND877M_metallic_texture.png`
  - `BND877M_metallic_specular.png`
  - `BND877M_metallic_edge_ao.png`
  - `BND877M_printing_area.png`
- Metallic rendering was adjusted so red metallic keeps more saturation and shine instead of looking washed out.

Relevant recent branches:

- `codex/supabase-live-setup-db-20260527-175655` - Supabase live DB phase 1
- `codex/metallic-saturation-shine-20260527-154402` - Metallic saturation/shine
- `codex/bnd877m-metallic-maps-20260527-153059` - BND877M metallic maps
- `codex/dark-matte-highlight-shape-20260527-151210` - Stabilized dark matte highlight shape

## Working Rules From This Project

- Do not commit local noise files.
- Do not commit `.env.local`, real keys, or service role keys.
- Prefer build verification over local dev server unless the user explicitly asks.
- After code changes, run at least:

```powershell
npm run typecheck
npm test
npm run build
npm run build:netlify
```
