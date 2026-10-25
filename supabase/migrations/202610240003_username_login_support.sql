-- Campos e índice para resolver de forma segura el usuario/RUT en la Edge Function.
alter table public.profiles add column if not exists legacy_id text;
alter table public.profiles add column if not exists username_normalized text
  generated always as (lower(btrim(username))) stored;

create unique index if not exists profiles_username_normalized_uidx
  on public.profiles(username_normalized)
  where username_normalized is not null and username_normalized <> '';

create unique index if not exists profiles_legacy_id_uidx
  on public.profiles(legacy_id)
  where legacy_id is not null and legacy_id <> '';
