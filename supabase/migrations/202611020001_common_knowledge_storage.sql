-- Base común de fallas y tutoriales con fotos en Storage.
-- Ejecutar una vez en Supabase SQL Editor antes de publicar los archivos web.

create table if not exists public.knowledge_entries (
  id uuid primary key default gen_random_uuid(),
  legacy_id text not null unique,
  kind text not null check (kind in ('failure', 'tutorial')),
  brand_legacy_id text not null,
  brand_name text not null default '',
  equipment_name text not null default '',
  model text not null,
  title text not null,
  description text not null default '',
  symptoms text not null default '',
  resolution text not null default '',
  url text not null default '',
  thumbnail_url text not null default '',
  duration text not null default '',
  photos jsonb not null default '[]'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint knowledge_entries_photos_limit check (
    case when jsonb_typeof(photos) = 'array'
      then jsonb_array_length(photos) <= 4
      else false
    end
  )
);

create index if not exists knowledge_entries_equipment_idx
  on public.knowledge_entries (brand_legacy_id, lower(model), kind);
create index if not exists knowledge_entries_updated_idx
  on public.knowledge_entries (updated_at desc);

alter table public.knowledge_entries enable row level security;
grant select, insert, update, delete on public.knowledge_entries to authenticated;

drop policy if exists "knowledge entries authenticated read" on public.knowledge_entries;
create policy "knowledge entries authenticated read"
  on public.knowledge_entries for select to authenticated using (true);

drop policy if exists "knowledge entries managers insert" on public.knowledge_entries;
create policy "knowledge entries managers insert"
  on public.knowledge_entries for insert to authenticated
  with check (public.current_app_role() in ('Administrador', 'Supervisor'));

drop policy if exists "knowledge entries managers update" on public.knowledge_entries;
create policy "knowledge entries managers update"
  on public.knowledge_entries for update to authenticated
  using (public.current_app_role() in ('Administrador', 'Supervisor'))
  with check (public.current_app_role() in ('Administrador', 'Supervisor'));

drop policy if exists "knowledge entries managers delete" on public.knowledge_entries;
create policy "knowledge entries managers delete"
  on public.knowledge_entries for delete to authenticated
  using (public.current_app_role() in ('Administrador', 'Supervisor'));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('equipment-knowledge', 'equipment-knowledge', false, 8388608,
        array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "knowledge photos authenticated read" on storage.objects;
create policy "knowledge photos authenticated read"
  on storage.objects for select to authenticated
  using (bucket_id = 'equipment-knowledge');

drop policy if exists "knowledge photos managers insert" on storage.objects;
create policy "knowledge photos managers insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'equipment-knowledge'
    and public.current_app_role() in ('Administrador', 'Supervisor')
  );

drop policy if exists "knowledge photos managers update" on storage.objects;
create policy "knowledge photos managers update"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'equipment-knowledge'
    and public.current_app_role() in ('Administrador', 'Supervisor')
  )
  with check (
    bucket_id = 'equipment-knowledge'
    and public.current_app_role() in ('Administrador', 'Supervisor')
  );

drop policy if exists "knowledge photos managers delete" on storage.objects;
create policy "knowledge photos managers delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'equipment-knowledge'
    and public.current_app_role() in ('Administrador', 'Supervisor')
  );

drop trigger if exists smartfit_broadcast_refresh on public.knowledge_entries;
create trigger smartfit_broadcast_refresh
  after insert or update or delete on public.knowledge_entries
  for each row execute function public.broadcast_smartfit_refresh();
