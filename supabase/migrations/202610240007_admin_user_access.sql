-- Requiere el estado de cambio de contraseña y mantiene correos de Auth en un directorio visible solo para administradores.
alter table public.profiles add column if not exists password_change_required boolean not null default false;

create table if not exists public.admin_user_access (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  email text not null,
  updated_at timestamptz not null default now()
);
alter table public.admin_user_access enable row level security;
drop policy if exists "admin user access only" on public.admin_user_access;
create policy "admin user access only" on public.admin_user_access for all to authenticated
using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on public.admin_user_access to authenticated;

insert into public.admin_user_access (profile_id, email)
select p.id, u.email from public.profiles p join auth.users u on u.id = p.id
where u.email is not null
on conflict (profile_id) do update set email = excluded.email, updated_at = now();
