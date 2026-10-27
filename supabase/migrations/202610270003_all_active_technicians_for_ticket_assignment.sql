-- Permite a administradores y supervisores buscar técnicos activos de toda la
-- plataforma para una asignación temporal de ticket. No altera sedes permanentes.

create or replace function public.list_assignable_ticket_technicians(p_ticket_legacy_id text)
returns table (
  technician_id text,
  technician_name text,
  site_names text[]
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor public.profiles%rowtype;
  v_ticket public.tickets%rowtype;
begin
  select * into v_actor
  from public.profiles
  where id = auth.uid() and active = true;

  if not found or v_actor.role not in ('Administrador', 'Supervisor') then
    raise exception 'Solo un administrador o supervisor activo puede consultar técnicos para asignación.' using errcode = '42501';
  end if;

  select * into v_ticket
  from public.tickets
  where legacy_id = p_ticket_legacy_id;

  if not found or v_ticket.site_id is null then
    raise exception 'No se encontró el ticket o no tiene una sede asociada.' using errcode = 'P0002';
  end if;

  if v_ticket.status in ('Cerrado', 'Rechazado') then
    raise exception 'No se puede reasignar un ticket cerrado o rechazado.' using errcode = '23514';
  end if;

  if v_actor.role = 'Supervisor' and not exists (
    select 1 from public.site_assignments sa
    where sa.site_id = v_ticket.site_id
      and sa.user_id = v_actor.id
      and sa.assignment_role = 'Supervisor'
  ) then
    raise exception 'El ticket está fuera de las sedes asignadas a este supervisor.' using errcode = '42501';
  end if;

  return query
  select p.legacy_id, p.full_name,
         coalesce(array_agg(distinct s.name order by s.name) filter (where s.name is not null), '{}'::text[])
  from public.profiles p
  left join public.site_assignments sa
    on sa.user_id = p.id and sa.assignment_role = 'Técnico'
  left join public.sites s on s.id = sa.site_id
  where p.role = 'Técnico' and p.active = true and p.legacy_id is not null
  group by p.id, p.legacy_id, p.full_name
  order by lower(p.full_name);
end;
$$;

revoke all on function public.list_assignable_ticket_technicians(text) from public, anon;
grant execute on function public.list_assignable_ticket_technicians(text) to authenticated;

-- La asignación temporal no requiere que el técnico comparta sede con el supervisor.
-- El supervisor sigue limitado a tickets de sus sedes; el administrador puede gestionar todos.
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
