-- Conserva el instante en que el técnico o supervisor inicia una inspección.
alter table public.inspection_records
  add column if not exists execution_started_at timestamptz;
