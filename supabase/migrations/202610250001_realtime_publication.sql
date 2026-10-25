-- Envía avisos genéricos de cambio a los paneles sin incluir datos de las filas.
-- Los paneles vuelven a consultar por REST y Supabase aplica las políticas RLS.
drop policy if exists "smartfit authenticated refresh notifications" on realtime.messages;
create policy "smartfit authenticated refresh notifications"
on realtime.messages
for select
to authenticated
using (extension = 'broadcast' and topic = 'smartfit-live-sync');

create or replace function public.broadcast_smartfit_refresh()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform realtime.send(
    jsonb_build_object('table', tg_table_name, 'operation', tg_op),
    'smartfit-change',
    'smartfit-live-sync',
    true
  );
  return null;
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'profiles',
    'sites',
    'site_assignments',
    'brands',
    'equipment',
    'tickets',
    'maintenance_events',
    'maintenance_event_tickets',
    'mileage_records',
    'part_requests',
    'admin_user_access',
    'audit_log'
  ] loop
    if to_regclass(format('public.%I', table_name)) is not null
      and not exists (
        select 1 from pg_trigger
        where tgrelid = to_regclass(format('public.%I', table_name))
          and tgname = 'smartfit_broadcast_refresh'
          and not tgisinternal
      ) then
      execute format(
        'create trigger smartfit_broadcast_refresh after insert or update or delete on public.%I for each row execute function public.broadcast_smartfit_refresh()',
        table_name
      );
    end if;
  end loop;
end
$$;
