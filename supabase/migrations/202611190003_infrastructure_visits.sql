-- Visitas de infraestructura: una fila por sector/visita y eventos embebidos para lectura ligera.
create table if not exists public.infrastructure_visits (
  id uuid primary key,
  site_id uuid not null references public.sites(id) on delete restrict,
  sector_id uuid references public.infrastructure_sectors(id) on delete set null,
  sector_number bigint not null,
  sector_name text not null,
  technician_id uuid not null references public.profiles(id) on delete restrict,
  technician_name text not null,
  visit_date date not null default current_date,
  status text not null default 'uploading' check (status in ('uploading','complete')),
  events jsonb not null default '[]'::jsonb check (jsonb_typeof(events) = 'array'),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists infrastructure_visits_site_date_idx
  on public.infrastructure_visits (site_id, visit_date desc, created_at desc)
  where status = 'complete';
create index if not exists infrastructure_visits_technician_date_idx
  on public.infrastructure_visits (technician_id, visit_date desc, created_at desc)
  where status = 'complete';

alter table public.infrastructure_visits enable row level security;
drop policy if exists "infrastructure visits read assigned" on public.infrastructure_visits;
create policy "infrastructure visits read assigned"
  on public.infrastructure_visits for select to authenticated
  using (
    (
      status = 'complete'
      and public.current_app_role() in ('Administrador','Coordinador','Técnico')
      and public.can_access_site(site_id)
      and (public.current_app_role() <> 'Técnico' or technician_id = auth.uid())
    )
    or (
      status = 'uploading'
      and public.current_app_role() = 'Técnico'
      and technician_id = auth.uid()
      and public.can_access_site(site_id)
    )
  );

drop policy if exists "infrastructure visits technician insert" on public.infrastructure_visits;
create policy "infrastructure visits technician insert"
  on public.infrastructure_visits for insert to authenticated
  with check (
    status = 'uploading'
    and technician_id = auth.uid()
    and public.current_app_role() = 'Técnico'
    and public.can_access_site(site_id)
    and exists (
      select 1 from public.infrastructure_sectors s
      where s.id = infrastructure_visits.sector_id and s.sector_number = infrastructure_visits.sector_number and s.active
    )
  );

drop policy if exists "infrastructure visits technician complete" on public.infrastructure_visits;
create policy "infrastructure visits technician complete"
  on public.infrastructure_visits for update to authenticated
  using (status = 'uploading' and technician_id = auth.uid() and public.current_app_role() = 'Técnico' and public.can_access_site(site_id))
  with check (status = 'complete' and technician_id = auth.uid() and public.current_app_role() = 'Técnico' and public.can_access_site(site_id));

drop policy if exists "infrastructure visits technician cancel upload" on public.infrastructure_visits;
create policy "infrastructure visits technician cancel upload"
  on public.infrastructure_visits for delete to authenticated
  using (status = 'uploading' and technician_id = auth.uid() and public.current_app_role() = 'Técnico' and public.can_access_site(site_id));

grant select, insert, update, delete on public.infrastructure_visits to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('infrastructure-photos','infrastructure-photos',false,12582912,array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "infrastructure photos insert active visit" on storage.objects;
create policy "infrastructure photos insert active visit"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'infrastructure-photos'
    and public.current_app_role() = 'Técnico'
    and exists (
      select 1 from public.infrastructure_visits v
      where v.id::text = (storage.foldername(name))[2]
        and v.site_id::text = (storage.foldername(name))[1]
        and v.technician_id = auth.uid() and v.status = 'uploading'
    )
  );

drop policy if exists "infrastructure photos read assigned visit" on storage.objects;
create policy "infrastructure photos read assigned visit"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'infrastructure-photos'
    and public.current_app_role() in ('Administrador','Coordinador','Técnico')
    and exists (
      select 1 from public.infrastructure_visits v
      where v.id::text = (storage.foldername(name))[2]
        and v.site_id::text = (storage.foldername(name))[1]
        and v.status = 'complete'
        and public.can_access_site(v.site_id)
        and (public.current_app_role() <> 'Técnico' or v.technician_id = auth.uid())
    )
  );

drop policy if exists "infrastructure photos delete active visit" on storage.objects;
create policy "infrastructure photos delete active visit"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'infrastructure-photos'
    and public.current_app_role() = 'Técnico'
    and exists (
      select 1 from public.infrastructure_visits v
      where v.id::text = (storage.foldername(name))[2]
        and v.site_id::text = (storage.foldername(name))[1]
        and v.technician_id = auth.uid() and v.status = 'uploading'
    )
  );
