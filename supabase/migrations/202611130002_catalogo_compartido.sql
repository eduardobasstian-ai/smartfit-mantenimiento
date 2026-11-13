begin;

create schema if not exists repuestos;
grant usage on schema repuestos to authenticated;

create table repuestos.cambios_catalogo (
  tipo text not null check (tipo in ('nombre', 'marcador', 'foto')),
  clave text not null check (length(clave) between 1 and 200),
  valor jsonb not null check (
    (tipo in ('nombre', 'foto') and jsonb_typeof(valor) = 'string')
    or (tipo = 'marcador' and jsonb_typeof(valor) = 'object'
      and valor ?& array['viewId', 'callout', 'part'])
  ),
  primary key (tipo, clave)
);

alter table repuestos.cambios_catalogo enable row level security;
grant select, insert, update, delete on repuestos.cambios_catalogo to authenticated;

create function repuestos.rol_catalogo() returns text
language sql stable security invoker set search_path = ''
as $$
  select lower(role) from public.profiles where id = auth.uid() and active
$$;
revoke all on function repuestos.rol_catalogo() from public;
grant execute on function repuestos.rol_catalogo() to authenticated;

create policy "Lectura de cambios del catálogo"
on repuestos.cambios_catalogo for select to authenticated
using ((select repuestos.rol_catalogo()) in ('administrador', 'supervisor'));

create policy "Edición de cambios del catálogo"
on repuestos.cambios_catalogo for all to authenticated
using ((select repuestos.rol_catalogo()) = 'administrador')
with check ((select repuestos.rol_catalogo()) = 'administrador');

create function public.catalogo_cambios() returns setof repuestos.cambios_catalogo
language sql stable security invoker set search_path = ''
as $$ select * from repuestos.cambios_catalogo $$;

create function public.catalogo_guardar_cambios(cambios jsonb) returns void
language sql security invoker set search_path = ''
as $$
  insert into repuestos.cambios_catalogo (tipo, clave, valor)
  select tipo, clave, valor
  from jsonb_to_recordset(cambios) as entrada(tipo text, clave text, valor jsonb)
  on conflict (tipo, clave) do update set valor = excluded.valor
$$;

revoke all on function public.catalogo_cambios() from public, anon;
revoke all on function public.catalogo_guardar_cambios(jsonb) from public, anon;
grant execute on function public.catalogo_cambios() to authenticated;
grant execute on function public.catalogo_guardar_cambios(jsonb) to authenticated;

insert into storage.buckets (id, name, public, allowed_mime_types)
values ('catalogo-fotos-compartidas', 'catalogo-fotos-compartidas', false,
  array['image/webp','image/jpeg','image/png','image/avif','image/gif','image/bmp','image/tiff']);

create policy "Lectura de fotos compartidas del catálogo"
on storage.objects for select to authenticated
using (bucket_id = 'catalogo-fotos-compartidas'
  and (select repuestos.rol_catalogo()) in ('administrador', 'supervisor'));

create policy "Edición de fotos compartidas del catálogo"
on storage.objects for all to authenticated
using (bucket_id = 'catalogo-fotos-compartidas'
  and (select repuestos.rol_catalogo()) = 'administrador')
with check (bucket_id = 'catalogo-fotos-compartidas'
  and (select repuestos.rol_catalogo()) = 'administrador'
  and split_part(name, '/', 1) = 'mtm3839');

commit;
