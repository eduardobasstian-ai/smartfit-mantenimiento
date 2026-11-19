-- Codigo correlativo y estable para identificar los sectores en los informes/eventos.
-- Los sectores existentes se numeran por fecha de creacion; los nuevos reciben el siguiente numero.

create sequence if not exists public.infrastructure_sector_number_seq;

alter table public.infrastructure_sectors
  add column if not exists sector_number bigint;

with numbered_sectors as (
  select id, row_number() over (order by created_at asc nulls first, id asc) as assigned_number
  from public.infrastructure_sectors
  where sector_number is null
)
update public.infrastructure_sectors as sectors
set sector_number = numbered_sectors.assigned_number
from numbered_sectors
where sectors.id = numbered_sectors.id;

select setval(
  'public.infrastructure_sector_number_seq',
  coalesce(max(sector_number), 1),
  coalesce(max(sector_number) is not null, false)
)
from public.infrastructure_sectors;

alter table public.infrastructure_sectors
  alter column sector_number set default nextval('public.infrastructure_sector_number_seq'),
  alter column sector_number set not null;

create unique index if not exists infrastructure_sectors_sector_number_unique
  on public.infrastructure_sectors (sector_number);

grant usage, select on sequence public.infrastructure_sector_number_seq to authenticated;
