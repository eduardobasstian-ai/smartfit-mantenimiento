-- Confirmación ligera para conservar las fotos locales hasta verificar la fila.
-- No lee ni devuelve el contenido binario/base64 de las fotografías.
alter table public.maintenance_events
  add column if not exists photos_count integer
  generated always as (
    case
      when jsonb_typeof(coalesce(photos, '[]'::jsonb)) = 'array'
        then jsonb_array_length(coalesce(photos, '[]'::jsonb))
      else 0
    end
  ) stored;

comment on column public.maintenance_events.photos_count is
  'Número de fotografías en photos; permite confirmar su persistencia sin descargarlas.';
