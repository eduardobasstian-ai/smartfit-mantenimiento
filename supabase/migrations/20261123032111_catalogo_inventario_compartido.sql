create table repuestos.inventario (
  id uuid primary key,
  quantity bigint check (quantity is null or quantity >= 0),
  shared boolean not null default false,
  links jsonb not null check (jsonb_typeof(links) = 'array' and jsonb_array_length(links) > 0),
  version integer not null default 1 check (version > 0),
  deleted boolean not null default false,
  updated_at timestamptz not null default now()
);

create table repuestos.inventario_vinculos (
  piece_key text primary key check (length(piece_key) between 1 and 2000),
  inventory_id uuid not null references repuestos.inventario(id) on delete cascade
);
create index on repuestos.inventario_vinculos (inventory_id);

alter table repuestos.inventario enable row level security;
alter table repuestos.inventario_vinculos enable row level security;
grant select, insert, update, delete on repuestos.inventario, repuestos.inventario_vinculos to authenticated;

create policy inventario_read on repuestos.inventario
for select to authenticated
using ((select repuestos.rol_catalogo()) in ('administrador', 'supervisor'));
create policy inventario_write on repuestos.inventario
for all to authenticated
using ((select repuestos.rol_catalogo()) = 'administrador')
with check ((select repuestos.rol_catalogo()) = 'administrador');
create policy inventario_vinculos_read on repuestos.inventario_vinculos
for select to authenticated
using ((select repuestos.rol_catalogo()) in ('administrador', 'supervisor'));
create policy inventario_vinculos_write on repuestos.inventario_vinculos
for all to authenticated
using ((select repuestos.rol_catalogo()) = 'administrador')
with check ((select repuestos.rol_catalogo()) = 'administrador');

create function public.catalogo_inventario()
returns setof repuestos.inventario
language sql stable security invoker set search_path = ''
as $$ select * from repuestos.inventario where not deleted $$;

create function public.catalogo_inventario_guardar(
  registro jsonb, version_esperada integer, solo_crear boolean default false
) returns repuestos.inventario
language plpgsql security invoker set search_path = ''
as $$
declare
  record_id uuid := (registro ->> 'id')::uuid;
  existing repuestos.inventario;
  result repuestos.inventario;
  amount numeric;
begin
  if (select repuestos.rol_catalogo()) is distinct from 'administrador' then
    raise exception 'Solo un administrador puede modificar inventario.' using errcode = '42501';
  end if;
  -- Serializa cambios del inventario para validar vínculos y versiones en una sola transacción.
  perform pg_advisory_xact_lock(230113, 1);
  select * into existing from repuestos.inventario where id = record_id for update;
  if found and solo_crear then return existing; end if;
  if record_id is null or version_esperada is null or
    (existing.id is not null and (existing.version <> version_esperada or existing.deleted)) or
    (existing.id is null and version_esperada <> 0) then
    raise exception 'El registro cambió en otro dispositivo. Actualiza el inventario y vuelve a editarlo.'
      using errcode = '40001';
  end if;
  if jsonb_typeof(registro -> 'links') is distinct from 'array' then
    raise exception 'Agrega al menos una pieza del catálogo.' using errcode = '22023';
  end if;
  if jsonb_array_length(registro -> 'links') = 0 or
    exists (select 1 from jsonb_array_elements(registro -> 'links') as p
      where jsonb_typeof(p) <> 'object' or nullif(p ->> 'id', '') is null
        or nullif(p ->> 'modelId', '') is null) then
    raise exception 'Los vínculos del repuesto son inválidos.' using errcode = '22023';
  end if;
  if not (registro ? 'quantity') or
    jsonb_typeof(registro -> 'quantity') not in ('null','number') then
    raise exception 'Cantidad inválida.' using errcode = '22023';
  end if;
  amount := (registro ->> 'quantity')::numeric;
  if amount < 0 or amount <> trunc(amount) or amount > 9007199254740991 then
    raise exception 'Cantidad inválida.' using errcode = '22023';
  end if;
  if exists (
    select 1 from repuestos.inventario_vinculos
    where inventory_id <> record_id and piece_key in (
      select p ->> 'id' from jsonb_array_elements(registro -> 'links') as p
    )
  ) then
    raise exception 'Una de las piezas ya está en inventario. Edita su registro para agregar compatibilidades.'
      using errcode = '23505';
  end if;
  insert into repuestos.inventario (id, quantity, shared, links, version)
  values (record_id, amount::bigint, coalesce((registro ->> 'shared')::boolean, false), registro -> 'links', 1)
  on conflict (id) do update set quantity = excluded.quantity, shared = excluded.shared,
    links = excluded.links, version = inventario.version + 1, updated_at = now()
  returning * into result;
  delete from repuestos.inventario_vinculos where inventory_id = record_id;
  insert into repuestos.inventario_vinculos (piece_key, inventory_id)
  select distinct p ->> 'id', record_id from jsonb_array_elements(registro -> 'links') as p;
  return result;
end
$$;

create function public.catalogo_inventario_eliminar(registro_id uuid, version_esperada integer)
returns void
language plpgsql security invoker set search_path = ''
as $$
begin
  if (select repuestos.rol_catalogo()) is distinct from 'administrador' then
    raise exception 'Solo un administrador puede modificar inventario.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(230113, 1);
  update repuestos.inventario set deleted = true, version = version + 1, updated_at = now()
  where id = registro_id and version = version_esperada and not deleted;
  if not found then
    raise exception 'El registro cambió en otro dispositivo. Actualiza el inventario y vuelve a editarlo.'
      using errcode = '40001';
  end if;
  delete from repuestos.inventario_vinculos where inventory_id = registro_id;
end
$$;

revoke all on function public.catalogo_inventario() from public, anon;
revoke all on function public.catalogo_inventario_guardar(jsonb, integer, boolean) from public, anon;
revoke all on function public.catalogo_inventario_eliminar(uuid, integer) from public, anon;
grant execute on function public.catalogo_inventario() to authenticated;
grant execute on function public.catalogo_inventario_guardar(jsonb, integer, boolean) to authenticated;
grant execute on function public.catalogo_inventario_eliminar(uuid, integer) to authenticated;
