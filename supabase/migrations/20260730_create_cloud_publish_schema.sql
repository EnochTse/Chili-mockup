begin;

create extension if not exists pgcrypto;

create table if not exists public.admin_emails (
  email text primary key,
  created_at timestamptz not null default now()
);

create table if not exists public.product_templates (
  slug text primary key,
  name text not null,
  category text,
  published_version_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_templates_slug_format
    check (slug ~ '^[a-z0-9][a-z0-9-]*$')
);

create table if not exists public.product_template_versions (
  id uuid primary key default gen_random_uuid(),
  slug text not null references public.product_templates(slug) on delete cascade,
  version integer not null check (version > 0),
  status text not null check (status in ('draft', 'published', 'archived')),
  template jsonb not null check (jsonb_typeof(template) = 'object'),
  source_local_version integer check (source_local_version > 0),
  asset_count integer not null default 0 check (asset_count >= 0),
  total_asset_bytes bigint not null default 0 check (total_asset_bytes >= 0),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (slug, version),
  unique (slug, id)
);

alter table public.product_template_versions
  add column if not exists source_local_version integer,
  add column if not exists asset_count integer not null default 0,
  add column if not exists total_asset_bytes bigint not null default 0,
  add column if not exists published_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'product_templates_published_version_fk'
      and conrelid = 'public.product_templates'::regclass
  ) then
    alter table public.product_templates
      add constraint product_templates_published_version_fk
      foreign key (slug, published_version_id)
      references public.product_template_versions(slug, id)
      on delete set null (published_version_id);
  end if;
end
$$;

create index if not exists product_template_versions_slug_version_idx
  on public.product_template_versions (slug, version desc);

create unique index if not exists product_template_versions_one_published_idx
  on public.product_template_versions (slug)
  where status = 'published';

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'mockup-assets',
  'mockup-assets',
  true,
  52428800,
  array['image/png', 'image/jpeg', 'image/webp']::text[]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

alter table public.admin_emails enable row level security;
alter table public.product_templates enable row level security;
alter table public.product_template_versions enable row level security;

create or replace function public.is_mockup_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_emails
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

revoke all on function public.is_mockup_admin() from public;
grant execute on function public.is_mockup_admin() to authenticated;

do $$
declare
  policy_row record;
begin
  for policy_row in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'admin_emails',
        'product_templates',
        'product_template_versions'
      )
  loop
    execute format(
      'drop policy if exists %I on %I.%I',
      policy_row.policyname,
      policy_row.schemaname,
      policy_row.tablename
    );
  end loop;
end
$$;

create policy "public read published product catalog"
on public.product_templates
for select
to anon, authenticated
using (published_version_id is not null);

create policy "public read published template versions"
on public.product_template_versions
for select
to anon, authenticated
using (status = 'published');

create policy "admins read all template versions"
on public.product_template_versions
for select
to authenticated
using (public.is_mockup_admin());

create policy "admins manage product catalog"
on public.product_templates
for all
to authenticated
using (public.is_mockup_admin())
with check (public.is_mockup_admin());

create policy "admins manage template versions"
on public.product_template_versions
for all
to authenticated
using (public.is_mockup_admin())
with check (public.is_mockup_admin());

create policy "admins read admin email list"
on public.admin_emails
for select
to authenticated
using (public.is_mockup_admin());

revoke all on public.admin_emails from anon, authenticated;
revoke all on public.product_templates from anon, authenticated;
revoke all on public.product_template_versions from anon, authenticated;

grant select on public.admin_emails to authenticated;
grant select on public.product_templates to anon, authenticated;
grant select on public.product_template_versions to anon, authenticated;
grant insert, update, delete on public.product_templates to authenticated;
grant insert, update, delete on public.product_template_versions to authenticated;
grant all on public.admin_emails to service_role;
grant all on public.product_templates to service_role;
grant all on public.product_template_versions to service_role;

do $$
declare
  policy_row record;
begin
  for policy_row in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and (
        coalesce(qual, '') ilike '%mockup-assets%'
        or coalesce(with_check, '') ilike '%mockup-assets%'
      )
  loop
    execute format(
      'drop policy if exists %I on %I.%I',
      policy_row.policyname,
      policy_row.schemaname,
      policy_row.tablename
    );
  end loop;
end
$$;

create policy "public read mockup assets"
on storage.objects
for select
to anon, authenticated
using (bucket_id = 'mockup-assets');

create policy "admins insert mockup assets"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'mockup-assets'
  and public.is_mockup_admin()
);

create policy "admins update mockup assets"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'mockup-assets'
  and public.is_mockup_admin()
)
with check (
  bucket_id = 'mockup-assets'
  and public.is_mockup_admin()
);

create policy "admins delete mockup assets"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'mockup-assets'
  and public.is_mockup_admin()
);

create or replace function public.publish_product_template(
  p_slug text,
  p_name text,
  p_category text,
  p_template jsonb,
  p_source_local_version integer,
  p_asset_count integer,
  p_total_bytes bigint
)
returns table (
  id uuid,
  version integer,
  status text,
  published_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  next_version integer;
  new_version_id uuid;
  published_timestamp timestamptz := now();
begin
  if p_slug is null or p_slug !~ '^[a-z0-9][a-z0-9-]*$' then
    raise exception 'Invalid product slug';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'Product name is required';
  end if;
  if jsonb_typeof(p_template) <> 'object'
    or coalesce(p_template ->> 'slug', '') <> p_slug then
    raise exception 'Template payload does not match its product slug';
  end if;
  if p_source_local_version is null or p_source_local_version <= 0 then
    raise exception 'A valid local source version is required';
  end if;
  if coalesce(p_asset_count, -1) < 0 or coalesce(p_total_bytes, -1) < 0 then
    raise exception 'Asset totals cannot be negative';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_slug, 0));

  insert into public.product_templates (
    slug,
    name,
    category,
    created_at,
    updated_at
  )
  values (
    p_slug,
    p_name,
    nullif(trim(p_category), ''),
    published_timestamp,
    published_timestamp
  )
  on conflict (slug) do update
  set
    name = excluded.name,
    category = excluded.category,
    updated_at = excluded.updated_at;

  select coalesce(max(existing.version), 0) + 1
  into next_version
  from public.product_template_versions as existing
  where existing.slug = p_slug;

  update public.product_template_versions as existing_version
  set
    status = 'archived',
    updated_at = published_timestamp
  where existing_version.slug = p_slug
    and existing_version.status = 'published';

  insert into public.product_template_versions (
    slug,
    version,
    status,
    template,
    source_local_version,
    asset_count,
    total_asset_bytes,
    published_at,
    created_at,
    updated_at
  )
  values (
    p_slug,
    next_version,
    'published',
    p_template,
    p_source_local_version,
    p_asset_count,
    p_total_bytes,
    published_timestamp,
    published_timestamp,
    published_timestamp
  )
  returning product_template_versions.id
  into new_version_id;

  update public.product_templates
  set
    published_version_id = new_version_id,
    updated_at = published_timestamp
  where slug = p_slug;

  return query
  select
    new_version_id,
    next_version,
    'published'::text,
    published_timestamp;
end;
$$;

revoke all on function public.publish_product_template(
  text,
  text,
  text,
  jsonb,
  integer,
  integer,
  bigint
) from public, anon, authenticated;

grant execute on function public.publish_product_template(
  text,
  text,
  text,
  jsonb,
  integer,
  integer,
  bigint
) to service_role;

commit;
