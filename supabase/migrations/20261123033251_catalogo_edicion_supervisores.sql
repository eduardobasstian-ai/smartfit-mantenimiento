create function repuestos.puede_editar_catalogo() returns boolean
language sql stable security invoker set search_path = ''
as $$ select coalesce(repuestos.rol_catalogo() in ('administrador', 'supervisor'), false) $$;
revoke all on function repuestos.puede_editar_catalogo() from public, anon;
grant execute on function repuestos.puede_editar_catalogo() to authenticated;

alter policy "Edición de cambios del catálogo" on repuestos.cambios_catalogo
using ((select repuestos.puede_editar_catalogo()))
with check ((select repuestos.puede_editar_catalogo()));
alter policy inventario_write on repuestos.inventario
using ((select repuestos.puede_editar_catalogo()))
with check ((select repuestos.puede_editar_catalogo()));
alter policy inventario_vinculos_write on repuestos.inventario_vinculos
using ((select repuestos.puede_editar_catalogo()))
with check ((select repuestos.puede_editar_catalogo()));
alter policy "Edición de fotos compartidas del catálogo" on storage.objects
using (bucket_id = 'catalogo-fotos-compartidas' and (select repuestos.puede_editar_catalogo()))
with check (bucket_id = 'catalogo-fotos-compartidas'
  and (select repuestos.puede_editar_catalogo()) and split_part(name, '/', 1) = 'mtm3839');

do $$
declare function_name text; definition text;
begin
  foreach function_name in array array[
    'public.catalogo_inventario_guardar(jsonb,integer,boolean)',
    'public.catalogo_inventario_eliminar(uuid,integer)'
  ] loop
    definition := pg_get_functiondef(function_name::regprocedure);
    definition := replace(definition,
      '(select repuestos.rol_catalogo()) is distinct from ''administrador''',
      'not (select repuestos.puede_editar_catalogo())');
    definition := replace(definition, 'Solo un administrador puede modificar inventario.',
      'Solo administradores y supervisores pueden modificar inventario.');
    execute definition;
  end loop;
end
$$;

alter table repuestos.cambios_catalogo drop constraint cambios_catalogo_tipo_check;
alter table repuestos.cambios_catalogo drop constraint cambios_catalogo_check;
alter table repuestos.cambios_catalogo add constraint cambios_catalogo_tipo_check
check (tipo in ('nombre', 'foto', 'marcador', 'referencia'));
alter table repuestos.cambios_catalogo add constraint cambios_catalogo_check check (
  (tipo in ('nombre','foto') and jsonb_typeof(valor) = 'string')
  or (tipo = 'marcador' and jsonb_typeof(valor) = 'object' and valor ?& array['viewId','callout','part'])
  or (tipo = 'referencia' and jsonb_typeof(valor) = 'object' and valor ?& array['viewId','original','part'])
);

create function public.catalogo_editar(cambios jsonb) returns void
language plpgsql security invoker set search_path = ''
as $$
declare change jsonb; current_value jsonb; expected_value jsonb;
begin
  if not (select repuestos.puede_editar_catalogo()) then
    raise exception 'Solo administradores y supervisores pueden editar el catálogo.' using errcode='42501';
  end if;
  if jsonb_typeof(cambios) is distinct from 'array' or jsonb_array_length(cambios) > 1000 then
    raise exception 'El lote de cambios es inválido.' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(230113, 2);
  for change in select value from jsonb_array_elements(cambios) loop
    select valor into current_value from repuestos.cambios_catalogo
    where tipo = change ->> 'tipo' and clave = change ->> 'clave' for update;
    expected_value := nullif(change -> 'expected', 'null'::jsonb);
    if current_value is distinct from expected_value then
      raise exception 'Otro usuario modificó esta referencia o marcador. Actualiza la vista y revisa tus cambios.'
        using errcode='40001';
    end if;
    insert into repuestos.cambios_catalogo (tipo,clave,valor)
    values (change ->> 'tipo', change ->> 'clave', change -> 'valor')
    on conflict (tipo,clave) do update set valor=excluded.valor;
  end loop;
end
$$;
revoke all on function public.catalogo_editar(jsonb) from public, anon;
grant execute on function public.catalogo_editar(jsonb) to authenticated;
