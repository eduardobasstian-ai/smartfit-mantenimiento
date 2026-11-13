begin;

create schema if not exists repuestos;
revoke all on schema repuestos from public, anon;
grant usage on schema repuestos to authenticated;

create table repuestos.marcas (
  id text primary key check (id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  nombre text not null check (btrim(nombre) <> ''),
  logo_ruta text
);

create table repuestos.modelos (
  id uuid primary key default gen_random_uuid(),
  marca_id text not null references repuestos.marcas(id),
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  nombre text not null check (btrim(nombre) <> ''),
  modelo text not null check (btrim(modelo) <> ''),
  imagen_url text,
  -- Conserva el formato de vistas, piezas y marcadores del catálogo actual.
  despiece jsonb not null check (
    jsonb_typeof(despiece) = 'object'
    and despiece ?& array['drawing', 'views', 'parts']
    and jsonb_typeof(despiece -> 'drawing') = 'string'
    and jsonb_typeof(despiece -> 'views') = 'array'
    and jsonb_typeof(despiece -> 'parts') = 'object'
  ),
  publicado boolean not null default false,
  unique (marca_id, slug)
);

-- Una máquina instalada se vincula a un modelo. El vínculo se guarda aquí.
-- El UUID externo se verificará en Mantención cuando la API cree el vínculo.
create table repuestos.equipos_mantencion (
  equipo_mantencion_id uuid primary key,
  modelo_id uuid not null references repuestos.modelos(id)
);

create index on repuestos.equipos_mantencion (modelo_id);

create table repuestos.piezas (
  id uuid primary key default gen_random_uuid(),
  modelo_id uuid not null references repuestos.modelos(id),
  item text,
  nombre_tecnico text,
  numero_referencia text,
  numero_parte_sap text,
  descripcion text,
  etiqueta_pedido text generated always as (
    coalesce(
      nullif(btrim(nombre_tecnico), ''),
      nullif(btrim(item), ''),
      nullif(btrim(numero_referencia), ''),
      nullif(btrim(numero_parte_sap), '')
    )
  ) stored not null,
  -- Ruta relativa en un bucket privado, con un prefijo por UUID de pieza.
  foto_ruta text check (
    split_part(foto_ruta, '/', 1) = id::text
    and foto_ruta ~ '^[^/]+/[a-zA-Z0-9_-]+\.(webp|jpe?g|png|avif)$'
  )
);

create index on repuestos.piezas (modelo_id);
create index on repuestos.piezas (lower(etiqueta_pedido));

revoke all on all tables in schema repuestos from public, anon, authenticated;
grant select, insert, update, delete on all tables in schema repuestos to authenticated;

alter table repuestos.marcas enable row level security;
alter table repuestos.modelos enable row level security;
alter table repuestos.equipos_mantencion enable row level security;
alter table repuestos.piezas enable row level security;

create policy "Administradores gestionan marcas"
on repuestos.marcas for all to authenticated
using ((select exists (
  select 1 from public.profiles
  where id = auth.uid() and active and lower(role::text) = 'administrador'
)));

create policy "Administradores gestionan modelos"
on repuestos.modelos for all to authenticated
using ((select exists (
  select 1 from public.profiles
  where id = auth.uid() and active and lower(role::text) = 'administrador'
)));

create policy "Administradores gestionan vínculos"
on repuestos.equipos_mantencion for all to authenticated
using ((select exists (
  select 1 from public.profiles
  where id = auth.uid() and active and lower(role::text) = 'administrador'
)));

create policy "Supervisores consultan marcas"
on repuestos.marcas for select to authenticated
using ((select exists (
  select 1 from public.profiles
  where id = auth.uid() and active and lower(role::text) = 'supervisor'
)));

create policy "Supervisores consultan modelos publicados"
on repuestos.modelos for select to authenticated
using (publicado and (select exists (
  select 1 from public.profiles
  where id = auth.uid() and active and lower(role::text) = 'supervisor'
)));

create policy "Administradores gestionan piezas"
on repuestos.piezas for all to authenticated
using ((select exists (
  select 1 from public.profiles
  where id = auth.uid() and active and lower(role::text) = 'administrador'
)));

create policy "Supervisores consultan piezas de modelos publicados"
on repuestos.piezas for select to authenticated
using (
  exists (select 1 from repuestos.modelos where id = modelo_id and publicado)
  and (select exists (
    select 1 from public.profiles
    where id = auth.uid() and active and lower(role::text) = 'supervisor'
  ))
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'catalogo-fotos-piezas', 'catalogo-fotos-piezas', false, 10485760,
  array['image/webp', 'image/jpeg', 'image/png', 'image/avif']
);

create policy "Administradores gestionan fotos del catálogo"
on storage.objects for all to authenticated
using (
  bucket_id = 'catalogo-fotos-piezas'
  and (select exists (
    select 1 from public.profiles
    where id = auth.uid() and active and lower(role::text) = 'administrador'
  ))
)
with check (
  bucket_id = 'catalogo-fotos-piezas'
  and (select exists (
    select 1 from public.profiles
    where id = auth.uid() and active and lower(role::text) = 'administrador'
  ))
  and exists (
    select 1 from repuestos.piezas
    where id::text = split_part(storage.objects.name, '/', 1)
  )
);

create policy "Lectores del catálogo consultan fotos vinculadas"
on storage.objects for select to authenticated
using (
  bucket_id = 'catalogo-fotos-piezas'
  and exists (
    select 1 from repuestos.piezas where foto_ruta = storage.objects.name
  )
);

commit;
