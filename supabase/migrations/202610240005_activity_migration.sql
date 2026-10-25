-- Conserva las referencias locales y los nombres históricos al importar la actividad.
alter table public.tickets add column if not exists legacy_id text;
alter table public.tickets add column if not exists ticket_date date;
alter table public.tickets add column if not exists created_by_name text;
alter table public.tickets add column if not exists leader_id uuid references public.profiles(id) on delete set null;
alter table public.tickets add column if not exists leader_name text;
alter table public.tickets add column if not exists supervisor_name text;
alter table public.tickets add column if not exists technician_name text;
alter table public.tickets add column if not exists machine_record_key text;
alter table public.tickets add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table public.tickets alter column created_by drop not null;

alter table public.maintenance_events add column if not exists legacy_id text;
alter table public.maintenance_events add column if not exists source_record_key text;
alter table public.maintenance_events add column if not exists technician_name text;
alter table public.maintenance_events add column if not exists supervisor_name text;
alter table public.maintenance_events add column if not exists registered_by_name text;
alter table public.maintenance_events add column if not exists equipment_name text;
alter table public.maintenance_events add column if not exists equipment_model text;
alter table public.maintenance_events add column if not exists fixed_asset text;
alter table public.maintenance_events add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table public.maintenance_events alter column registered_by drop not null;
alter table public.maintenance_events alter column equipment_id drop not null;

alter table public.mileage_records add column if not exists legacy_id text;
alter table public.mileage_records add column if not exists source_record_key text;
alter table public.mileage_records add column if not exists entry_date date;
alter table public.mileage_records add column if not exists technician_name text;
alter table public.mileage_records add column if not exists supervisor_name text;
alter table public.mileage_records add column if not exists registered_by_name text;
alter table public.mileage_records add column if not exists equipment_name text;
alter table public.mileage_records add column if not exists equipment_model text;
alter table public.mileage_records add column if not exists fixed_asset text;
alter table public.mileage_records add column if not exists lubrication text;
alter table public.mileage_records add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table public.mileage_records alter column registered_by drop not null;
alter table public.mileage_records alter column equipment_id drop not null;

create unique index if not exists tickets_legacy_id_uidx on public.tickets(legacy_id);
create unique index if not exists maintenance_events_legacy_id_uidx on public.maintenance_events(legacy_id);
create unique index if not exists mileage_records_legacy_id_uidx on public.mileage_records(legacy_id);

create table if not exists public.maintenance_event_tickets (
  event_id uuid not null references public.maintenance_events(id) on delete cascade,
  ticket_id uuid not null references public.tickets(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (event_id, ticket_id)
);
alter table public.maintenance_event_tickets enable row level security;
drop policy if exists "event ticket links read by scope" on public.maintenance_event_tickets;
create policy "event ticket links read by scope" on public.maintenance_event_tickets for select to authenticated
using (public.is_admin() or public.can_access_ticket(ticket_id));
drop policy if exists "event ticket links admin manage" on public.maintenance_event_tickets;
create policy "event ticket links admin manage" on public.maintenance_event_tickets for all to authenticated
using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on public.maintenance_event_tickets to authenticated;

drop policy if exists "tickets create by assigned users" on public.tickets;
create policy "tickets create by assigned users" on public.tickets for insert to authenticated
with check (
  public.is_admin() or (created_by = auth.uid() and public.can_access_site(site_id))
);

drop policy if exists "events create at assigned site" on public.maintenance_events;
create policy "events create at assigned site" on public.maintenance_events for insert to authenticated
with check (
  public.is_admin() or (
    registered_by = auth.uid() and public.can_access_site(site_id)
    and exists (
      select 1 from public.equipment e
      where e.id = maintenance_events.equipment_id and e.site_id = maintenance_events.site_id
    )
  )
);

drop policy if exists "mileage create assigned site" on public.mileage_records;
create policy "mileage create assigned site" on public.mileage_records for insert to authenticated
with check (
  public.is_admin() or (
    registered_by = auth.uid() and public.can_access_site(site_id)
    and exists (
      select 1 from public.equipment e
      where e.id = mileage_records.equipment_id and e.site_id = mileage_records.site_id
    )
  )
);
