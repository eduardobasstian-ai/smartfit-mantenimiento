-- SmartFit Mantenimiento: esquema inicial para Supabase/PostgreSQL.
-- Ejecutar en Supabase SQL Editor. No incluye cuentas ni datos ficticios.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  username text unique,
  role text not null check (role in ('Administrador', 'Supervisor', 'Técnico', 'Líder')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sites (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  region text,
  address text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.site_assignments (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete restrict,
  user_id uuid not null references public.profiles(id) on delete restrict,
  assignment_role text not null check (assignment_role in ('Supervisor', 'Técnico', 'Líder')),
  created_at timestamptz not null default now(),
  unique (site_id, user_id, assignment_role)
);

create table if not exists public.brands (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.equipment (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete restrict,
  brand_id uuid references public.brands(id) on delete restrict,
  fixed_asset text not null unique,
  name text not null,
  model text,
  serial_number text,
  category text,
  image_url text,
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tickets (
  id uuid primary key default gen_random_uuid(),
  ticket_number text not null unique,
  ticket_type text not null check (ticket_type in ('Mantenimiento', 'Infraestructura')),
  site_id uuid references public.sites(id) on delete restrict,
  equipment_id uuid references public.equipment(id) on delete restrict,
  fixed_asset text,
  title text not null,
  description text not null,
  status text not null default 'Pendiente'
    check (status in ('Pendiente', 'En ejecución', 'Ejecutado', 'Cerrado', 'Rechazado')),
  supervisor_id uuid references public.profiles(id) on delete set null,
  technician_id uuid references public.profiles(id) on delete set null,
  created_by uuid not null references public.profiles(id) on delete restrict,
  updated_by uuid references public.profiles(id) on delete set null,
  photos jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.maintenance_events (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete restrict,
  equipment_id uuid not null references public.equipment(id) on delete restrict,
  event_type text not null check (event_type in ('Preventivo', 'Correctivo', 'Inspección', 'Lubricación', 'Otro')),
  status text not null default 'Registrado',
  details text not null default '',
  mileage_km numeric(12,1) check (mileage_km is null or mileage_km >= 0),
  ticket_id uuid references public.tickets(id) on delete set null,
  technician_id uuid references public.profiles(id) on delete set null,
  supervisor_id uuid references public.profiles(id) on delete set null,
  registered_by uuid not null references public.profiles(id) on delete restrict,
  photos jsonb not null default '[]'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.mileage_records (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete restrict,
  equipment_id uuid not null references public.equipment(id) on delete restrict,
  mileage_km numeric(12,1) not null check (mileage_km >= 0),
  technician_id uuid references public.profiles(id) on delete set null,
  supervisor_id uuid references public.profiles(id) on delete set null,
  registered_by uuid not null references public.profiles(id) on delete restrict,
  maintenance_event_id uuid references public.maintenance_events(id) on delete set null,
  notes text not null default '',
  photos jsonb not null default '[]'::jsonb,
  recorded_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.part_requests (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid references public.tickets(id) on delete restrict,
  maintenance_event_id uuid references public.maintenance_events(id) on delete restrict,
  site_id uuid not null references public.sites(id) on delete restrict,
  equipment_id uuid references public.equipment(id) on delete restrict,
  requested_by uuid not null references public.profiles(id) on delete restrict,
  description text not null,
  quantity numeric(10,2) not null default 1 check (quantity > 0),
  status text not null default 'Pendiente',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ticket_id is not null or maintenance_event_id is not null)
);

create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists site_assignments_user_idx on public.site_assignments(user_id, assignment_role);
create index if not exists site_assignments_site_idx on public.site_assignments(site_id);
create index if not exists equipment_site_brand_idx on public.equipment(site_id, brand_id);
create index if not exists equipment_fixed_asset_idx on public.equipment(fixed_asset);
create index if not exists tickets_site_status_date_idx on public.tickets(site_id, status, created_at desc);
create index if not exists tickets_technician_date_idx on public.tickets(technician_id, created_at desc);
create index if not exists tickets_supervisor_date_idx on public.tickets(supervisor_id, created_at desc);
create index if not exists events_site_date_idx on public.maintenance_events(site_id, occurred_at desc);
create index if not exists events_equipment_date_idx on public.maintenance_events(equipment_id, occurred_at desc);
create index if not exists mileage_equipment_date_idx on public.mileage_records(equipment_id, recorded_at desc);
create index if not exists part_requests_site_status_idx on public.part_requests(site_id, status, created_at desc);

create or replace function public.current_app_role()
returns text language sql stable security definer set search_path = public
as $$ select role from public.profiles where id = auth.uid() and active = true limit 1 $$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public
as $$ select coalesce(public.current_app_role() = 'Administrador', false) $$;

create or replace function public.can_access_site(target_site uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select public.is_admin() or exists (
    select 1 from public.site_assignments sa
    where sa.site_id = target_site and sa.user_id = auth.uid()
  )
$$;

create or replace function public.can_access_ticket(target_ticket uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select public.is_admin() or exists (
    select 1 from public.tickets t
    where t.id = target_ticket and (
      t.created_by = auth.uid() or t.technician_id = auth.uid() or t.supervisor_id = auth.uid()
      or public.can_access_site(t.site_id)
    )
  )
$$;

alter table public.profiles enable row level security;
alter table public.sites enable row level security;
alter table public.site_assignments enable row level security;
alter table public.brands enable row level security;
alter table public.equipment enable row level security;
alter table public.tickets enable row level security;
alter table public.maintenance_events enable row level security;
alter table public.mileage_records enable row level security;
alter table public.part_requests enable row level security;
alter table public.audit_log enable row level security;

create policy "profiles read self or assigned team" on public.profiles for select to authenticated
using (
  public.is_admin() or id = auth.uid() or exists (
    select 1 from public.site_assignments mine
    join public.site_assignments theirs on theirs.site_id = mine.site_id
    where mine.user_id = auth.uid() and theirs.user_id = profiles.id
  )
);
create policy "profiles admin manage" on public.profiles for all to authenticated
using (public.is_admin()) with check (public.is_admin());

create policy "sites read assigned" on public.sites for select to authenticated
using (public.can_access_site(id));
create policy "sites admin manage" on public.sites for all to authenticated
using (public.is_admin()) with check (public.is_admin());

create policy "assignments read relevant" on public.site_assignments for select to authenticated
using (public.is_admin() or user_id = auth.uid() or public.can_access_site(site_id));
create policy "assignments admin manage" on public.site_assignments for all to authenticated
using (public.is_admin()) with check (public.is_admin());

create policy "brands read authenticated" on public.brands for select to authenticated using (true);
create policy "brands admin manage" on public.brands for all to authenticated
using (public.is_admin()) with check (public.is_admin());

create policy "equipment read assigned sites" on public.equipment for select to authenticated
using (public.can_access_site(site_id));
create policy "equipment admin manage" on public.equipment for all to authenticated
using (public.is_admin()) with check (public.is_admin());

create policy "tickets read by role scope" on public.tickets for select to authenticated
using (
  public.is_admin() or created_by = auth.uid() or technician_id = auth.uid()
  or supervisor_id = auth.uid() or public.can_access_site(site_id)
);
create policy "tickets create by assigned users" on public.tickets for insert to authenticated
with check (
  created_by = auth.uid() and (public.is_admin() or public.can_access_site(site_id))
);
create policy "tickets update by assigned users" on public.tickets for update to authenticated
using (
  public.is_admin() or technician_id = auth.uid() or supervisor_id = auth.uid()
  or public.can_access_site(site_id)
) with check (
  public.is_admin() or technician_id = auth.uid() or supervisor_id = auth.uid()
  or public.can_access_site(site_id)
);
create policy "tickets delete admin" on public.tickets for delete to authenticated using (public.is_admin());

create policy "events read by role scope" on public.maintenance_events for select to authenticated
using (
  public.is_admin() or registered_by = auth.uid() or technician_id = auth.uid()
  or supervisor_id = auth.uid() or public.can_access_site(site_id)
);
create policy "events create at assigned site" on public.maintenance_events for insert to authenticated
with check (
  registered_by = auth.uid() and public.can_access_site(site_id)
  and exists (
    select 1 from public.equipment e
    where e.id = maintenance_events.equipment_id and e.site_id = maintenance_events.site_id
  )
);
create policy "events update assigned site" on public.maintenance_events for update to authenticated
using (public.is_admin() or registered_by = auth.uid() or public.can_access_site(site_id))
with check (public.is_admin() or registered_by = auth.uid() or public.can_access_site(site_id));
create policy "events delete admin" on public.maintenance_events for delete to authenticated using (public.is_admin());

create policy "mileage read by role scope" on public.mileage_records for select to authenticated
using (public.is_admin() or registered_by = auth.uid() or public.can_access_site(site_id));
create policy "mileage create assigned site" on public.mileage_records for insert to authenticated
with check (
  registered_by = auth.uid() and public.can_access_site(site_id)
  and exists (
    select 1 from public.equipment e
    where e.id = mileage_records.equipment_id and e.site_id = mileage_records.site_id
  )
);
create policy "mileage update assigned site" on public.mileage_records for update to authenticated
using (public.is_admin() or public.can_access_site(site_id))
with check (public.is_admin() or public.can_access_site(site_id));
create policy "mileage delete admin" on public.mileage_records for delete to authenticated using (public.is_admin());

create policy "parts read relevant" on public.part_requests for select to authenticated
using (public.is_admin() or requested_by = auth.uid() or public.can_access_site(site_id));
create policy "parts create assigned site" on public.part_requests for insert to authenticated
with check (requested_by = auth.uid() and public.can_access_site(site_id));
create policy "parts update assigned site" on public.part_requests for update to authenticated
using (public.is_admin() or public.can_access_site(site_id))
with check (public.is_admin() or public.can_access_site(site_id));
create policy "parts delete admin" on public.part_requests for delete to authenticated using (public.is_admin());

create policy "audit read admin" on public.audit_log for select to authenticated using (public.is_admin());
create policy "audit insert actor" on public.audit_log for insert to authenticated
with check (actor_id = auth.uid());

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.profiles, public.sites, public.site_assignments,
  public.brands, public.equipment, public.tickets, public.maintenance_events,
  public.mileage_records, public.part_requests, public.audit_log to authenticated;
grant usage, select on sequence public.audit_log_id_seq to authenticated;

