-- Solo Catálogo. No altera perfiles, asignaciones ni tablas de Mantenimiento.
create table repuestos.accesos_pedidos (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  role text not null check (role = 'bodega'),
  active boolean not null default true
);
alter table repuestos.accesos_pedidos enable row level security;
revoke all on repuestos.accesos_pedidos from public, anon, authenticated;

-- Definer necesario para leer el directorio completo en Bodega sin ampliar
-- las políticas de Mantenimiento. No recibe IDs ni roles del cliente.
create function public.catalogo_pedidos_contexto() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  actor_role text;
  all_sites boolean;
  allowed_sites jsonb;
  allowed_technicians jsonb;
begin
  select lower(p.role) into actor_role from public.profiles p
  where p.id = actor and p.active;
  if actor_role is null then
    raise exception 'Sesión no autorizada.' using errcode = '42501';
  end if;
  if actor_role not in ('administrador','supervisor') then
    select a.role into actor_role from repuestos.accesos_pedidos a
    where a.user_id = actor and a.active;
  end if;
  if actor_role is null or actor_role not in ('administrador','supervisor','bodega') then
    raise exception 'Perfil no autorizado para Pedidos.' using errcode = '42501';
  end if;
  all_sites := actor_role in ('administrador','bodega');
  with permitted as (
    select s.id,s.name from public.sites s where s.active and
    (all_sites or exists (select 1 from public.site_assignments a
      where a.user_id=actor and a.site_id=s.id and a.assignment_role='Supervisor'))
  ) select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name) order by name,id),'[]'::jsonb)
    into allowed_sites from permitted;
  with permitted as (
    select p.id,p.full_name,
      coalesce((select jsonb_agg(distinct a.site_id) from public.site_assignments a
        where a.user_id=p.id and a.assignment_role='Técnico'
        and exists (select 1 from jsonb_array_elements(allowed_sites) s where s->>'id'=a.site_id::text)), '[]'::jsonb) site_ids
    from public.profiles p where p.active and p.role='Técnico'
    and (all_sites or exists (select 1 from public.site_assignments a
      where a.user_id=p.id and a.assignment_role='Técnico'
      and exists (select 1 from jsonb_array_elements(allowed_sites) s where s->>'id'=a.site_id::text)))
  ) select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',full_name,'siteIds',site_ids) order by full_name,id),'[]'::jsonb)
    into allowed_technicians from permitted;
  return jsonb_build_object('role',actor_role,'allSites',all_sites,'sites',allowed_sites,
    'technicians',allowed_technicians,'canExport',actor_role in ('administrador','supervisor'),
    'canEdit',false);
end;
$$;
revoke all on function public.catalogo_pedidos_contexto() from public, anon;
grant execute on function public.catalogo_pedidos_contexto() to authenticated;
