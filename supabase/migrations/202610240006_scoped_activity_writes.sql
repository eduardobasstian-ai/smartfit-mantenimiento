-- Permite al supervisor administrar registros solo dentro de sus sedes asignadas.
drop policy if exists "events delete admin" on public.maintenance_events;
create policy "events delete by assigned supervisor" on public.maintenance_events for delete to authenticated
using (public.is_admin() or (public.current_app_role() = 'Supervisor' and public.can_access_site(site_id)));

drop policy if exists "mileage delete admin" on public.mileage_records;
create policy "mileage delete by assigned supervisor" on public.mileage_records for delete to authenticated
using (public.is_admin() or (public.current_app_role() = 'Supervisor' and public.can_access_site(site_id)));

drop policy if exists "event ticket links admin manage" on public.maintenance_event_tickets;
create policy "event ticket links manage assigned scope" on public.maintenance_event_tickets for all to authenticated
using (
  public.is_admin() or (
    public.current_app_role() = 'Supervisor' and exists (
      select 1 from public.maintenance_events e where e.id = event_id and public.can_access_site(e.site_id)
    )
  )
)
with check (
  public.is_admin() or (
    public.current_app_role() = 'Supervisor' and exists (
      select 1 from public.maintenance_events e
      join public.tickets t on t.id = ticket_id and t.site_id = e.site_id
      where e.id = event_id and public.can_access_site(e.site_id)
    )
  )
);
