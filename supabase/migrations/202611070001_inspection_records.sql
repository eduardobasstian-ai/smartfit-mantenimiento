-- Registros compartidos de inspección por equipo y sede.
create table if not exists public.inspection_records (
  id uuid primary key default gen_random_uuid(),
  inspection_id uuid not null,
  legacy_id text not null unique,
  site_id uuid not null references public.sites(id) on delete cascade,
  site_legacy_id text not null,
  equipment_id uuid references public.equipment(id) on delete set null,
  equipment_legacy_id text,
  equipment_name text not null,
  equipment_model text,
  brand_name text,
  fixed_asset text,
  technician_id uuid references public.profiles(id) on delete set null,
  technician_name text,
  supervisor_id uuid references public.profiles(id) on delete set null,
  supervisor_name text,
  registered_by uuid references public.profiles(id) on delete set null,
  registered_by_name text,
  occurred_at date not null default current_date,
  finding text not null,
  observations text,
  correction text,
  corrected_by uuid references public.profiles(id) on delete set null,
  corrected_by_name text,
  corrected_at timestamptz,
  status text not null default 'Pendiente' check (status in ('Pendiente', 'Ejecutado')),
  photos jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.inspection_records add column if not exists correction text;
alter table public.inspection_records add column if not exists corrected_by uuid references public.profiles(id) on delete set null;
alter table public.inspection_records add column if not exists corrected_by_name text;
alter table public.inspection_records add column if not exists corrected_at timestamptz;

create index if not exists inspection_records_site_date_idx on public.inspection_records(site_id, occurred_at desc);
create index if not exists inspection_records_equipment_idx on public.inspection_records(equipment_legacy_id, status);
create index if not exists inspection_records_technician_idx on public.inspection_records(technician_id, status);
alter table public.inspection_records enable row level security;

drop policy if exists "inspection records read assigned sites" on public.inspection_records;
create policy "inspection records read assigned sites" on public.inspection_records for select to authenticated
using (
  public.is_admin()
  or (
    public.current_app_role() = 'Supervisor'
    and public.can_access_site(site_id)
  )
  or (
    public.current_app_role() = 'Técnico'
    and technician_id = auth.uid()
    and public.can_access_site(site_id)
  )
);

drop policy if exists "inspection records insert supervisors" on public.inspection_records;
create policy "inspection records insert supervisors" on public.inspection_records for insert to authenticated
with check (
  registered_by = auth.uid()
  and public.current_app_role() in ('Administrador', 'Supervisor')
  and public.can_access_site(site_id)
  and exists (
    select 1 from public.equipment e
    where e.id = inspection_records.equipment_id and e.site_id = inspection_records.site_id
  )
);

drop policy if exists "inspection records update authorized team" on public.inspection_records;
create policy "inspection records update authorized team" on public.inspection_records for update to authenticated
using (
  public.is_admin()
  or (
    public.current_app_role() = 'Supervisor'
    and public.can_access_site(site_id)
  )
  or (
    public.current_app_role() = 'Técnico'
    and technician_id = auth.uid()
    and public.can_access_site(site_id)
  )
)
with check (
  public.is_admin()
  or (
    public.current_app_role() = 'Supervisor'
    and
    public.can_access_site(site_id)
  )
  or (
    public.current_app_role() = 'Técnico'
    and technician_id = auth.uid()
    and
    public.can_access_site(site_id)
  )
);

drop policy if exists "inspection records delete managers" on public.inspection_records;
create policy "inspection records delete managers" on public.inspection_records for delete to authenticated
using (public.is_admin() or (public.current_app_role() = 'Supervisor' and public.can_access_site(site_id)));

grant select, insert, update, delete on public.inspection_records to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('site-inspections', 'site-inspections', false, 12582912, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "inspection photos read scoped" on storage.objects;
create policy "inspection photos read scoped" on storage.objects for select to authenticated
using (
  bucket_id = 'site-inspections'
  and exists (
    select 1 from public.inspection_records r
    where r.photos @> jsonb_build_array(jsonb_build_object('path', storage.objects.name))
      and (
        public.is_admin()
        or (public.current_app_role() = 'Supervisor' and public.can_access_site(r.site_id))
        or (public.current_app_role() = 'Técnico' and r.technician_id = auth.uid() and public.can_access_site(r.site_id))
      )
  )
);

drop policy if exists "inspection photos insert supervisors" on storage.objects;
create policy "inspection photos insert supervisors" on storage.objects for insert to authenticated
with check (
  bucket_id = 'site-inspections'
  and public.current_app_role() in ('Administrador', 'Supervisor')
  and public.can_access_site(((storage.foldername(name))[1])::uuid)
);

drop policy if exists "inspection photos update managers" on storage.objects;
create policy "inspection photos update managers" on storage.objects for update to authenticated
using (bucket_id = 'site-inspections' and public.is_admin())
with check (bucket_id = 'site-inspections' and public.is_admin());

drop policy if exists "inspection photos delete managers" on storage.objects;
create policy "inspection photos delete managers" on storage.objects for delete to authenticated
using (
  bucket_id = 'site-inspections'
  and (public.is_admin() or (public.current_app_role() = 'Supervisor' and public.can_access_site(((storage.foldername(name))[1])::uuid)))
);

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_publication_tables where pubname = 'supabase_realtime'
        and schemaname = 'public' and tablename = 'inspection_records'
    ) then
    alter publication supabase_realtime add table public.inspection_records;
  end if;
end
$$;

-- Difunde solo el nombre de la tabla/operación; cada perfil vuelve a consultar
-- los registros respetando RLS, sin enviar datos sensibles por Broadcast.
do $$
begin
  if to_regprocedure('public.broadcast_smartfit_refresh()') is not null
    and not exists (
      select 1 from pg_trigger
      where tgrelid = 'public.inspection_records'::regclass
        and tgname = 'smartfit_broadcast_refresh'
        and not tgisinternal
    ) then
    execute 'create trigger smartfit_broadcast_refresh after insert or update or delete on public.inspection_records for each row execute function public.broadcast_smartfit_refresh()';
  end if;
end
$$;
