begin;

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
      and tablename in ('admin_emails', 'product_templates', 'product_template_versions')
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

create policy "public read product catalog"
on public.product_templates
for select
to anon, authenticated
using (true);

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

revoke insert, update, delete, truncate on public.admin_emails from anon;
revoke insert, update, delete, truncate on public.product_templates from anon;
revoke insert, update, delete, truncate on public.product_template_versions from anon;

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
with check (bucket_id = 'mockup-assets' and public.is_mockup_admin());

create policy "admins update mockup assets"
on storage.objects
for update
to authenticated
using (bucket_id = 'mockup-assets' and public.is_mockup_admin())
with check (bucket_id = 'mockup-assets' and public.is_mockup_admin());

create policy "admins delete mockup assets"
on storage.objects
for delete
to authenticated
using (bucket_id = 'mockup-assets' and public.is_mockup_admin());

commit;
