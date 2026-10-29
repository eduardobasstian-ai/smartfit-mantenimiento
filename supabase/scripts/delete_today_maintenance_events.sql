-- Elimina exclusivamente los eventos de mantenimiento registrados el
-- 28-10-2026 (fecha de Chile) para los activos fijos indicados.
-- Primero ejecuta este SELECT por separado para revisar las filas objetivo.
select id, legacy_id, fixed_asset, occurred_at, details
from public.maintenance_events
where fixed_asset in (
  '40028640', '40028639', '40028638', '40028637', '40028642',
  '40028615', '40028614', '40028621', '40028623', '40028624',
  '40028625', '40028622'
)
and (occurred_at at time zone 'America/Santiago')::date = date '2026-10-28'
order by fixed_asset, occurred_at;

-- Cuando confirmes que el resultado corresponde a los eventos a retirar,
-- ejecuta desde BEGIN hasta COMMIT. Los tombstones impiden que las copias
-- locales del navegador vuelvan a subir esos eventos.
begin;

create table if not exists public.maintenance_event_tombstones (
  legacy_id text primary key,
  deleted_at timestamptz not null default now()
);

alter table public.maintenance_event_tombstones enable row level security;
grant select on public.maintenance_event_tombstones to authenticated;
drop policy if exists "maintenance event tombstones readable by authenticated"
  on public.maintenance_event_tombstones;
create policy "maintenance event tombstones readable by authenticated"
  on public.maintenance_event_tombstones
  for select to authenticated
  using (true);

insert into public.maintenance_event_tombstones (legacy_id)
select legacy_id
from public.maintenance_events
where fixed_asset in (
  '40028640', '40028639', '40028638', '40028637', '40028642',
  '40028615', '40028614', '40028621', '40028623', '40028624',
  '40028625', '40028622'
)
and (occurred_at at time zone 'America/Santiago')::date = date '2026-10-28'
on conflict (legacy_id) do nothing;

delete from public.maintenance_events
where fixed_asset in (
  '40028640', '40028639', '40028638', '40028637', '40028642',
  '40028615', '40028614', '40028621', '40028623', '40028624',
  '40028625', '40028622'
)
and (occurred_at at time zone 'America/Santiago')::date = date '2026-10-28';

commit;

-- Verificación: esta consulta debe devolver cero filas para los criterios.
select id, legacy_id, fixed_asset, occurred_at
from public.maintenance_events
where fixed_asset in (
  '40028640', '40028639', '40028638', '40028637', '40028642',
  '40028615', '40028614', '40028621', '40028623', '40028624',
  '40028625', '40028622'
)
and (occurred_at at time zone 'America/Santiago')::date = date '2026-10-28';
