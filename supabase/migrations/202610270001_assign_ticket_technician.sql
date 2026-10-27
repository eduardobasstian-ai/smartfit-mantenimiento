-- Reasignación restringida de tickets a técnicos vinculados a la sede.
-- El supervisor solo puede gestionar tickets de una sede que tiene asignada;
-- el administrador puede gestionar tickets de todas las sedes.
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

  if not found or not exists (
    select 1 from public.site_assignments sa
    where sa.site_id = v_ticket.site_id
      and sa.user_id = v_technician.id
      and sa.assignment_role = 'Técnico'
  ) then
    raise exception 'El técnico debe estar activo y asignado a la sede del ticket.' using errcode = '23514';
  end if;

  update public.tickets
  set technician_id = v_technician.id,
      technician_name = v_technician.full_name,
      updated_by = v_actor.id,
      updated_at = v_assigned_at,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'technicianAssignment', jsonb_build_object(
          'technicianId', v_technician.legacy_id,
          'technicianName', v_technician.full_name,
          'assignedById', v_actor.legacy_id,
          'assignedByName', v_actor.full_name,
          'assignedAt', v_assigned_at
        )
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
