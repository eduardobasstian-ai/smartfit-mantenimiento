-- Identifica el navegador que originó un guardado de mantenimiento para que
-- esa misma pestaña no vuelva a descargar por REST los datos que ya confirmó.
-- Los demás navegadores siguen recibiendo el aviso y refrescando con su límite.
create or replace function public.broadcast_smartfit_refresh()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  changed_row jsonb;
  origin_client_id text;
  linked_event_id uuid;
begin
  changed_row := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;

  if tg_op <> 'DELETE' then
    origin_client_id := changed_row #>> '{metadata,smartfit_origin_client_id}';
  end if;

  -- Los vínculos de tickets se escriben en una tabla aparte. Hereda el origen
  -- del evento asociado, así el mismo guardado no genera una lectura de eco.
  if origin_client_id is null and tg_table_name = 'maintenance_event_tickets' then
    begin
      linked_event_id := nullif(changed_row ->> 'event_id', '')::uuid;
    exception when invalid_text_representation then
      linked_event_id := null;
    end;
    if linked_event_id is not null then
      select event.metadata ->> 'smartfit_origin_client_id'
        into origin_client_id
        from public.maintenance_events as event
        where event.id = linked_event_id;
    end if;
  end if;

  perform realtime.send(
    jsonb_build_object(
      'table', tg_table_name,
      'operation', tg_op,
      'origin_client_id', origin_client_id
    ),
    'smartfit-change',
    'smartfit-live-sync',
    true
  );
  return null;
end;
$$;
