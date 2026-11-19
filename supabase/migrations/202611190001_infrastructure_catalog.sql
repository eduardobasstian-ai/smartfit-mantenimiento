-- Catalogo administrativo de sectores y eventos de infraestructura.
-- Cualquier usuario autenticado puede consultar el catalogo; solo Administrador puede cambiarlo.

create table if not exists public.infrastructure_sectors (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 2 and 120),
  active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists infrastructure_sectors_name_unique
  on public.infrastructure_sectors (lower(btrim(name)));

create table if not exists public.infrastructure_events (
  id uuid primary key default gen_random_uuid(),
  sector_id uuid not null references public.infrastructure_sectors(id) on delete cascade,
  name text not null check (length(btrim(name)) between 2 and 180),
  sort_order integer not null default 0 check (sort_order >= 0),
  active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists infrastructure_events_sector_name_unique
  on public.infrastructure_events (sector_id, lower(btrim(name)));
create index if not exists infrastructure_events_sector_active_idx
  on public.infrastructure_events (sector_id, active, sort_order, name);

alter table public.infrastructure_sectors enable row level security;
alter table public.infrastructure_events enable row level security;

drop policy if exists "infrastructure sectors read authenticated" on public.infrastructure_sectors;
create policy "infrastructure sectors read authenticated"
  on public.infrastructure_sectors for select to authenticated
  using (auth.uid() is not null);

drop policy if exists "infrastructure sectors admin insert" on public.infrastructure_sectors;
create policy "infrastructure sectors admin insert"
  on public.infrastructure_sectors for insert to authenticated
  with check (public.is_admin());

drop policy if exists "infrastructure sectors admin update" on public.infrastructure_sectors;
create policy "infrastructure sectors admin update"
  on public.infrastructure_sectors for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "infrastructure sectors admin delete" on public.infrastructure_sectors;
create policy "infrastructure sectors admin delete"
  on public.infrastructure_sectors for delete to authenticated
  using (public.is_admin());

drop policy if exists "infrastructure events read authenticated" on public.infrastructure_events;
create policy "infrastructure events read authenticated"
  on public.infrastructure_events for select to authenticated
  using (auth.uid() is not null);

drop policy if exists "infrastructure events admin insert" on public.infrastructure_events;
create policy "infrastructure events admin insert"
  on public.infrastructure_events for insert to authenticated
  with check (public.is_admin());

drop policy if exists "infrastructure events admin update" on public.infrastructure_events;
create policy "infrastructure events admin update"
  on public.infrastructure_events for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "infrastructure events admin delete" on public.infrastructure_events;
create policy "infrastructure events admin delete"
  on public.infrastructure_events for delete to authenticated
  using (public.is_admin());

grant select, insert, update, delete on public.infrastructure_sectors to authenticated;
grant select, insert, update, delete on public.infrastructure_events to authenticated;
