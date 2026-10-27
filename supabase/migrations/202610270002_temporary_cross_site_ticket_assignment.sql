-- La asignación a un ticket es temporal y no modifica site_assignments.
-- El técnico asignado recibe acceso limitado al sitio/equipo del ticket mientras
-- siga abierto (Pendiente, En ejecución o Ejecutado). Al reasignar/cerrar, caduca.

create or replace function public.has_active_ticket_at_site(target_site uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.tickets t
    join public.profiles p on p.id = t.technician_id and p.active = true
    where t.technician_id = auth.uid()
      and t.site_id = target_site
      and t.status in ('Pendiente', 'En ejecución', 'Ejecutado')
  )
$$;

create or replace function public.can_access_ticket_equipment(target_equipment uuid, target_site uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.tickets t
    join public.profiles p on p.id = t.technician_id and p.active = true
    join public.equipment e on e.id = target_equipment and e.site_id = target_site
    where t.technician_id = auth.uid()
      and t.site_id = target_site
      and t.status in ('Pendiente', 'En ejecución', 'Ejecutado')
      and (
        t.equipment_id = e.id
        or (t.equipment_id is null and t.fixed_asset is not null and t.fixed_asset = e.fixed_asset)
      )
  )
$$;

create or replace function public.can_work_assigned_ticket(
  target_ticket uuid,
  target_site uuid,
  target_equipment uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.tickets t
    join public.profiles p on p.id = t.technician_id and p.active = true
    join public.equipment e on e.id = target_equipment and e.site_id = target_site
    where t.id = target_ticket
      and t.technician_id = auth.uid()
      and t.site_id = target_site
      and t.status in ('Pendiente', 'En ejecución', 'Ejecutado')
      and (
        t.equipment_id = e.id
        or (t.equipment_id is null and t.fixed_asset is not null and t.fixed_asset = e.fixed_asset)
      )
  )
$$;

create or replace function public.can_manage_assigned_ticket_event_link(target_event uuid, target_ticket uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.maintenance_events e
    join public.tickets t on t.id = target_ticket
    join public.profiles p on p.id = t.technician_id and p.active = true
    join public.equipment eq on eq.id = e.equipment_id and eq.site_id = e.site_id
    where e.id = target_event
      and e.registered_by = auth.uid()
      and t.technician_id = auth.uid()
      and t.status in ('Pendiente', 'En ejecución', 'Ejecutado')
      and t.site_id = e.site_id
      and (
        t.equipment_id = eq.id
        or (t.equipment_id is null and t.fixed_asset is not null and t.fixed_asset = eq.fixed_asset)
      )
  )
$$;

create or replace function public.can_access_event_via_ticket(target_event uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.maintenance_event_tickets link
    where link.event_id = target_event
      and public.can_access_ticket(link.ticket_id)
  )
$$;

revoke all on function public.has_active_ticket_at_site(uuid) from public, anon;
revoke all on function public.can_access_ticket_equipment(uuid, uuid) from public, anon;
revoke all on function public.can_work_assigned_ticket(uuid, uuid, uuid) from public, anon;
revoke all on function public.can_manage_assigned_ticket_event_link(uuid, uuid) from public, anon;
revoke all on function public.can_access_event_via_ticket(uuid) from public, anon;
grant execute on function public.has_active_ticket_at_site(uuid) to authenticated;
grant execute on function public.can_access_ticket_equipment(uuid, uuid) to authenticated;
grant execute on function public.can_work_assigned_ticket(uuid, uuid, uuid) to authenticated;
grant execute on function public.can_manage_assigned_ticket_event_link(uuid, uuid) to authenticated;
grant execute on function public.can_access_event_via_ticket(uuid) to authenticated;

create index if not exists tickets_assignee_site_status_idx
  on public.tickets(technician_id, site_id, status);

create or replace function public.prevent_assignee_ticket_scope_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if public.current_app_role() = 'Técnico'
     and old.technician_id = auth.uid()
     and (
       new.technician_id is distinct from old.technician_id
       or new.site_id is distinct from old.site_id
       or new.equipment_id is distinct from old.equipment_id
       or new.fixed_asset is distinct from old.fixed_asset
     ) then
    raise exception 'El técnico asignado no puede cambiar la asignación, sede o equipo del ticket.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_assignee_ticket_scope on public.tickets;
create trigger protect_assignee_ticket_scope
before update on public.tickets
for each row execute function public.prevent_assignee_ticket_scope_change();

drop policy if exists "sites read assigned" on public.sites;
create policy "sites read assigned or temporary ticket" on public.sites for select to authenticated
using (public.can_access_site(id) or public.has_active_ticket_at_site(id));

drop policy if exists "equipment read assigned sites" on public.equipment;
create policy "equipment read assigned or temporary ticket" on public.equipment for select to authenticated
using (public.can_access_site(site_id) or public.can_access_ticket_equipment(id, site_id));

drop policy if exists "events read by role scope" on public.maintenance_events;
create policy "events read by role scope" on public.maintenance_events for select to authenticated
using (
  public.is_admin() or registered_by = auth.uid() or technician_id = auth.uid()
  or supervisor_id = auth.uid() or public.can_access_site(site_id)
  or public.can_access_ticket(ticket_id)
  or public.can_access_event_via_ticket(id)
);

drop policy if exists "events create at assigned site" on public.maintenance_events;
create policy "events create at assigned site or assigned ticket" on public.maintenance_events for insert to authenticated
with check (
  public.is_admin() or (
    registered_by = auth.uid()
    and exists (
      select 1 from public.equipment e
      where e.id = maintenance_events.equipment_id and e.site_id = maintenance_events.site_id
    )
    and (
      public.can_access_site(site_id)
      or public.can_work_assigned_ticket(ticket_id, site_id, equipment_id)
    )
  )
);

drop policy if exists "mileage read by role scope" on public.mileage_records;
create policy "mileage read by role scope" on public.mileage_records for select to authenticated
using (
  public.is_admin() or registered_by = auth.uid() or public.can_access_site(site_id)
  or public.can_access_ticket_equipment(equipment_id, site_id)
);

drop policy if exists "mileage create assigned site" on public.mileage_records;
create policy "mileage create assigned site or ticket equipment" on public.mileage_records for insert to authenticated
with check (
  registered_by = auth.uid()
  and exists (
    select 1 from public.equipment e
    where e.id = mileage_records.equipment_id and e.site_id = mileage_records.site_id
  )
  and (public.is_admin() or public.can_access_site(site_id) or public.can_access_ticket_equipment(equipment_id, site_id))
);

drop policy if exists "mileage update assigned site" on public.mileage_records;
create policy "mileage update assigned site or own ticket equipment" on public.mileage_records for update to authenticated
using (
  public.is_admin() or public.can_access_site(site_id)
  or (registered_by = auth.uid() and public.can_access_ticket_equipment(equipment_id, site_id))
)
with check (
  public.is_admin() or public.can_access_site(site_id)
  or (registered_by = auth.uid() and public.can_access_ticket_equipment(equipment_id, site_id))
);

drop policy if exists "event ticket links manage assigned scope" on public.maintenance_event_tickets;
create policy "event ticket links manage assigned scope" on public.maintenance_event_tickets for all to authenticated
using (
  public.is_admin()
  or (
    public.current_app_role() = 'Supervisor'
    and exists (
      select 1 from public.maintenance_events e
      where e.id = event_id and public.can_access_site(e.site_id)
    )
  )
  or public.can_manage_assigned_ticket_event_link(event_id, ticket_id)
)
with check (
  public.is_admin()
  or (
    public.current_app_role() = 'Supervisor'
    and exists (
      select 1
      from public.maintenance_events e
      join public.tickets t on t.id = ticket_id and t.site_id = e.site_id
      where e.id = event_id and public.can_access_site(e.site_id)
    )
  )
  or public.can_manage_assigned_ticket_event_link(event_id, ticket_id)
);

-- Reemplaza el vínculo de sede exacta por el equipo completo del supervisor.
-- Administración puede asignar cualquier técnico activo de la plataforma.
create or replace function public.assign_ticket_technician(
  p_ticket_legacy_id text,
  p_technician_legacy_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor public.profiles%rowtype;
  v_ticket public.tickets%rowtype;
  v_technician public.profiles%rowtype;
  v_assigned_at timestamptz := clock_timestamp();
  v_previous_assignment jsonb;
begin
  select * into v_actor
  from public.profiles
  where id = auth.uid() and active = true;

  if not found or v_actor.role not in ('Administrador', 'Supervisor') then
    raise exception 'Solo un administrador o supervisor activo puede asignar tickets.' using errcode = '42501';
  end if;

  select * into v_ticket
  from public.tickets
  where legacy_id = p_ticket_legacy_id
  for update;

  if not found or v_ticket.site_id is null then
    raise exception 'No se encontró el ticket o no tiene una sede asociada.' using errcode = 'P0002';
  end if;

  if v_ticket.status in ('Cerrado', 'Rechazado') then
    raise exception 'No se puede asignar un ticket cerrado o rechazado.' using errcode = '23514';
  end if;

  if v_actor.role = 'Supervisor' and not exists (
    select 1 from public.site_assignments sa
    where sa.site_id = v_ticket.site_id
      and sa.user_id = v_actor.id
      and sa.assignment_role = 'Supervisor'
  ) then
    raise exception 'El ticket está fuera de las sedes asignadas a este supervisor.' using errcode = '42501';
  end if;

  select * into v_technician
  from public.profiles
  where legacy_id = p_technician_legacy_id
    and role = 'Técnico'
    and active = true;

  if not found then
    raise exception 'El técnico seleccionado no está activo.' using errcode = '23514';
  end if;

  if v_actor.role = 'Supervisor' and not exists (
    select 1
    from public.site_assignments supervisor_site
    join public.site_assignments technician_site
      on technician_site.site_id = supervisor_site.site_id
     and technician_site.assignment_role = 'Técnico'
    where supervisor_site.user_id = v_actor.id
      and supervisor_site.assignment_role = 'Supervisor'
      and technician_site.user_id = v_technician.id
  ) then
    raise exception 'El técnico no pertenece al equipo de sedes de este supervisor.' using errcode = '42501';
  end if;

  v_previous_assignment := v_ticket.metadata->'technicianAssignment';

  update public.tickets
  set technician_id = v_technician.id,
      technician_name = v_technician.full_name,
      updated_by = v_actor.id,
      updated_at = v_assigned_at,
      metadata = coalesce(metadata, '{}'::jsonb)
        || jsonb_build_object(
          'technicianAssignment', jsonb_build_object(
            'technicianId', v_technician.legacy_id,
            'technicianName', v_technician.full_name,
            'assignedById', v_actor.legacy_id,
            'assignedByName', v_actor.full_name,
            'assignedAt', v_assigned_at
          ),
          'technicianAssignmentHistory',
          (case
            when jsonb_typeof(metadata->'technicianAssignmentHistory') = 'array'
              then metadata->'technicianAssignmentHistory'
            else '[]'::jsonb
          end) || jsonb_build_array(jsonb_build_object(
            'previous', v_previous_assignment,
            'technicianId', v_technician.legacy_id,
            'technicianName', v_technician.full_name,
            'assignedById', v_actor.legacy_id,
            'assignedByName', v_actor.full_name,
            'assignedAt', v_assigned_at
          ))
        )
  where id = v_ticket.id;

  return jsonb_build_object(
    'ticketId', v_ticket.legacy_id,
    'technicianId', v_technician.legacy_id,
    'technician', v_technician.full_name,
    'assignedById', v_actor.legacy_id,
    'assignedByName', v_actor.full_name,
    'assignedAt', v_assigned_at
  );
end;
$$;

revoke all on function public.assign_ticket_technician(text, text) from public, anon;
grant execute on function public.assign_ticket_technician(text, text) to authenticated;
