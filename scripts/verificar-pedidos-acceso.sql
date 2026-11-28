-- Ejecutar dentro de la misma transacción que el borrador de acceso; terminar con ROLLBACK.
do $$
declare actor record; context jsonb; expected integer; tested integer := 0;
begin
  for actor in select id,lower(role) role from public.profiles
    where active and role in ('Administrador','Supervisor') loop
    perform set_config('request.jwt.claim.sub', actor.id::text, true);
    context := public.catalogo_pedidos_contexto();
    if context->>'role' <> actor.role then raise exception 'Rol incorrecto'; end if;
    select count(*) into expected from public.sites s where s.active and
      (actor.role='administrador' or exists (select 1 from public.site_assignments a
        where a.user_id=actor.id and a.site_id=s.id and a.assignment_role='Supervisor'));
    if jsonb_array_length(context->'sites') <> expected then raise exception 'Sedes fuera de alcance'; end if;
    if actor.role='supervisor' and exists (
      select 1 from jsonb_array_elements(context->'technicians') t
      where not exists (select 1 from public.site_assignments theirs
        join public.site_assignments mine on mine.site_id=theirs.site_id
        where theirs.user_id=(t->>'id')::uuid and theirs.assignment_role='Técnico'
        and mine.user_id=actor.id and mine.assignment_role='Supervisor')
    ) then raise exception 'Técnico fuera de alcance'; end if;
    tested := tested+1;
  end loop;
  if tested=0 then raise exception 'No se probaron usuarios'; end if;
  select id into actor from public.profiles where active and role='Técnico' limit 1;
  if actor.id is null then raise exception 'No hay actor de prueba Bodega'; end if;
  insert into repuestos.accesos_pedidos(user_id,role) values(actor.id,'bodega');
  perform set_config('request.jwt.claim.sub', actor.id::text, true);
  context := public.catalogo_pedidos_contexto();
  select count(*) into expected from public.sites where active;
  if context->>'role'<>'bodega' or jsonb_array_length(context->'sites')<>expected
    or (context->>'canEdit')::boolean or (context->>'canExport')::boolean then
    raise exception 'Bodega tiene alcance o permisos incorrectos'; end if;
  update repuestos.accesos_pedidos set active=false where user_id=actor.id;
  begin
    perform public.catalogo_pedidos_contexto();
    raise exception 'Se permitió una concesión revocada';
  exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000000',true);
  begin
    perform public.catalogo_pedidos_contexto();
    raise exception 'Se permitió una sesión desconocida';
  exception when insufficient_privilege then null; end;
  if has_function_privilege('anon','public.catalogo_pedidos_contexto()','execute')
    or has_table_privilege('authenticated','repuestos.accesos_pedidos','insert') then
    raise exception 'Concesión pública de permisos'; end if;
end $$;
select 'OK: alcance de administrador/supervisor, Bodega de consulta, concesión revocada y sesión desconocida' as resultado;
