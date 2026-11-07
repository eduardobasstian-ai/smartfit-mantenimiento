-- Folio por sede/fecha/lote y baja lógica auditable para inspecciones.
alter table public.inspection_records
  add column if not exists inspection_number text,
  add column if not exists inspection_counter integer,
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.profiles(id) on delete set null,
  add column if not exists deleted_by_name text;

alter table public.inspection_records drop constraint if exists inspection_records_status_check;
alter table public.inspection_records
  add constraint inspection_records_status_check
  check (status in ('Pendiente', 'Ejecutado', 'Eliminado'));

create table if not exists public.inspection_number_counters (
  site_id uuid not null references public.sites(id) on delete cascade,
  occurred_on date not null,
  last_number integer not null default 0 check (last_number >= 0),
  primary key (site_id, occurred_on)
);
alter table public.inspection_number_counters enable row level security;
revoke all on public.inspection_number_counters from anon, authenticated;

-- Backfill prior batches so historical reports also receive a stable folio.
with batches as (
  select site_id, occurred_at::date as occurred_on, inspection_id, min(created_at) as first_created
  from public.inspection_records
  where inspection_number is null
  group by site_id, occurred_at::date, inspection_id
), numbered as (
  select site_id, occurred_on, inspection_id,
         row_number() over (partition by site_id, occurred_on order by first_created, inspection_id)::integer as seq
  from batches
), site_codes as (
  select n.*, coalesce(s.internal_code::text, nullif(regexp_replace(r.site_legacy_id, '\D', '', 'g'), ''), '0') as site_code
  from numbered n
  join lateral (
    select site_legacy_id from public.inspection_records r
    where r.site_id = n.site_id and r.inspection_id = n.inspection_id and r.occurred_at::date = n.occurred_on
    limit 1
  ) r on true
  left join public.sites s on s.id = n.site_id
)
update public.inspection_records r
set inspection_counter = sc.seq,
    inspection_number = sc.site_code || '-' || to_char(sc.occurred_on, 'DDMMYYYY') || '-' || lpad(sc.seq::text, 3, '0')
from site_codes sc
where r.site_id = sc.site_id and r.occurred_at::date = sc.occurred_on and r.inspection_id = sc.inspection_id
  and r.inspection_number is null;

insert into public.inspection_number_counters(site_id, occurred_on, last_number)
select site_id, occurred_at::date, max(inspection_counter)
from public.inspection_records
where inspection_counter is not null
group by site_id, occurred_at::date
on conflict (site_id, occurred_on) do update
set last_number = greatest(public.inspection_number_counters.last_number, excluded.last_number);

create or replace function public.assign_inspection_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_number text;
  existing_counter integer;
  site_code text;
  next_counter integer;
begin
  if new.inspection_number is not null then
    return new;
  end if;

  select r.inspection_number, r.inspection_counter
    into existing_number, existing_counter
  from public.inspection_records r
  where r.site_id = new.site_id
    and r.inspection_id = new.inspection_id
    and r.occurred_at = new.occurred_at
    and r.inspection_number is not null
  order by r.created_at
  limit 1;

  if existing_number is not null then
    new.inspection_number := existing_number;
    new.inspection_counter := existing_counter;
    return new;
  end if;

  select coalesce(s.internal_code::text, nullif(regexp_replace(new.site_legacy_id, '\D', '', 'g'), ''), '0')
    into site_code
  from public.sites s where s.id = new.site_id;
  site_code := coalesce(site_code, nullif(regexp_replace(new.site_legacy_id, '\D', '', 'g'), ''), '0');

  insert into public.inspection_number_counters(site_id, occurred_on, last_number)
  values (new.site_id, new.occurred_at::date, 1)
  on conflict (site_id, occurred_on) do update
    set last_number = public.inspection_number_counters.last_number + 1
  returning last_number into next_counter;

  new.inspection_counter := next_counter;
  new.inspection_number := site_code || '-' || to_char(new.occurred_at::date, 'DDMMYYYY') || '-' || lpad(next_counter::text, 3, '0');
  return new;
end;
$$;

drop trigger if exists inspection_records_assign_number on public.inspection_records;
create trigger inspection_records_assign_number
before insert on public.inspection_records
for each row execute function public.assign_inspection_number();

-- Solo administración y supervisión pueden dar de baja una inspección.
-- La operación conserva la fila y la corrección del registro en el historial.
create or replace function public.guard_inspection_soft_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status
     and (new.status = 'Eliminado' or old.status = 'Eliminado')
     and not (public.is_admin() or public.current_app_role() = 'Supervisor') then
    raise exception 'Solo administración o supervisión puede cambiar el estado de eliminación de una inspección.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists inspection_records_guard_soft_delete on public.inspection_records;
create trigger inspection_records_guard_soft_delete
before update on public.inspection_records
for each row execute function public.guard_inspection_soft_delete();

create index if not exists inspection_records_number_idx
  on public.inspection_records(inspection_number, occurred_at desc);
