-- Permite el perfil Líder presente en cplider.html y sus asignaciones a sedes.
-- Ejecutar después de 202610240001_initial_schema.sql.

alter table public.profiles
  drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check
  check (role in ('Administrador', 'Supervisor', 'Técnico', 'Líder'));

alter table public.site_assignments
  drop constraint if exists site_assignments_assignment_role_check;
alter table public.site_assignments
  add constraint site_assignments_assignment_role_check
  check (assignment_role in ('Supervisor', 'Técnico', 'Líder'));
