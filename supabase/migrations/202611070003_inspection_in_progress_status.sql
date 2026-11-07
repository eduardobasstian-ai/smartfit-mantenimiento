-- Permite registrar cuándo una inspección pasa de Pendiente a En ejecución.
alter table public.inspection_records
  drop constraint if exists inspection_records_status_check;

alter table public.inspection_records
  add constraint inspection_records_status_check
  check (status in ('Pendiente', 'En ejecución', 'Ejecutado', 'Eliminado'));
