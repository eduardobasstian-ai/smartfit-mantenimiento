-- Claves de correspondencia para importar los IDs locales sin duplicar filas.
alter table public.sites add column if not exists legacy_id text;
alter table public.sites add column if not exists internal_code integer;
alter table public.brands add column if not exists legacy_id text;
alter table public.equipment add column if not exists legacy_id text;
alter table public.equipment alter column fixed_asset drop not null;

create unique index if not exists sites_legacy_id_uidx
  on public.sites(legacy_id);
create unique index if not exists brands_legacy_id_uidx
  on public.brands(legacy_id);
create unique index if not exists equipment_legacy_id_uidx
  on public.equipment(legacy_id);
