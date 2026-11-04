-- Permite asignar el rol Coordinador desde el panel de administración.
-- Ejecutar en Supabase después de aplicar las migraciones anteriores.

alter table public.profiles
  drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check
  check (role in ('Administrador', 'Supervisor', 'Técnico', 'Líder', 'Coordinador'));

alter table public.site_assignments
  drop constraint if exists site_assignments_assignment_role_check;
alter table public.site_assignments
  add constraint site_assignments_assignment_role_check
  check (assignment_role in ('Supervisor', 'Técnico', 'Líder', 'Coordinador'));
