-- Permite validar objetos de infraestructura en Storage sin que RLS de la tabla
-- de visitas oculte la visita de carga al propio chequeo de la política.
create or replace function public.can_upload_infrastructure_visit_photo(object_name text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, storage
set row_security = off
as $$
  select auth.uid() is not null
    and public.current_app_role() = 'Técnico'
    and exists (
      select 1
      from public.infrastructure_visits v
      where v.id::text = (storage.foldername(object_name))[2]
        and v.site_id::text = (storage.foldername(object_name))[1]
        and v.technician_id = auth.uid()
        and v.status = 'uploading'
        and public.can_access_site(v.site_id)
    );
$$;

revoke all on function public.can_upload_infrastructure_visit_photo(text) from public, anon;
grant execute on function public.can_upload_infrastructure_visit_photo(text) to authenticated;

drop policy if exists "infrastructure photos insert active visit" on storage.objects;
create policy "infrastructure photos insert active visit"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'infrastructure-photos'
    and public.can_upload_infrastructure_visit_photo(name)
  );

-- El cliente utiliza upsert; Storage puede requerir SELECT y UPDATE además de INSERT.
drop policy if exists "infrastructure photos read assigned visit" on storage.objects;
create policy "infrastructure photos read assigned visit"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'infrastructure-photos'
    and (
      public.can_upload_infrastructure_visit_photo(name)
      or (
        public.current_app_role() in ('Administrador','Coordinador','Técnico')
        and exists (
          select 1 from public.infrastructure_visits v
          where v.id::text = (storage.foldername(name))[2]
            and v.site_id::text = (storage.foldername(name))[1]
            and v.status = 'complete'
            and public.can_access_site(v.site_id)
            and (public.current_app_role() <> 'Técnico' or v.technician_id = auth.uid())
        )
      )
    )
  );

drop policy if exists "infrastructure photos update active visit" on storage.objects;
create policy "infrastructure photos update active visit"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'infrastructure-photos'
    and public.can_upload_infrastructure_visit_photo(name)
  )
  with check (
    bucket_id = 'infrastructure-photos'
    and public.can_upload_infrastructure_visit_photo(name)
  );

drop policy if exists "infrastructure photos delete active visit" on storage.objects;
create policy "infrastructure photos delete active visit"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'infrastructure-photos'
    and public.can_upload_infrastructure_visit_photo(name)
  );
