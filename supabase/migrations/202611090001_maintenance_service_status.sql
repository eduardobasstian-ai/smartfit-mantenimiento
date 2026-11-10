begin;

alter table public.maintenance_events
  drop constraint if exists maintenance_events_event_type_check;

alter table public.maintenance_events
  add constraint maintenance_events_event_type_check
  check (event_type in (
    'Preventivo',
    'Correctivo',
    'Inspección',
    'Lubricación',
    'Otro',
    'Fuera de servicio',
    'En servicio'
  ));

commit;
