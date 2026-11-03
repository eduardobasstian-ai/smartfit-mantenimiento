-- Restringe las escrituras al propietario del registro, al supervisor de la sede
-- o al administrador. También limita la consulta de fallas/tutoriales de técnicos
-- a modelos presentes en sus sedes o en tickets temporales asignados.

drop policy if exists "tickets update by assigned users" on public.tickets;
create policy "tickets update by scoped operators" on public.tickets
  for update to authenticated
  using (
    public.is_admin()
    or (
      public.current_app_role() = 'Supervisor'
      and public.can_access_site(site_id)
    )
    or (
      public.current_app_role() = 'Técnico'
      and technician_id = auth.uid()
    )
  )
  with check (
    public.is_admin()
    or (
      public.current_app_role() = 'Supervisor'
      and public.can_access_site(site_id)
    )
    or (
      public.current_app_role() = 'Técnico'
      and technician_id = auth.uid()
    )
  );

drop policy if exists "events update assigned site" on public.maintenance_events;
create policy "events update by owner supervisor or admin" on public.maintenance_events
  for update to authenticated
  using (
    public.is_admin()
    or (
      public.current_app_role() = 'Supervisor'
      and public.can_access_site(site_id)
    )
    or (
      registered_by = auth.uid()
      and (
        public.can_access_site(site_id)
        or public.can_work_assigned_ticket(ticket_id, site_id, equipment_id)
      )
    )
  )
  with check (
    public.is_admin()
    or (
      public.current_app_role() = 'Supervisor'
      and public.can_access_site(site_id)
    )
    or (
      registered_by = auth.uid()
      and (
        public.can_access_site(site_id)
        or public.can_work_assigned_ticket(ticket_id, site_id, equipment_id)
      )
    )
  );

drop policy if exists "mileage update assigned site or own ticket equipment" on public.mileage_records;
create policy "mileage update by owner supervisor or admin" on public.mileage_records
  for update to authenticated
  using (
    public.is_admin()
    or (
      public.current_app_role() = 'Supervisor'
      and public.can_access_site(site_id)
    )
    or (
      registered_by = auth.uid()
      and (
        public.can_access_site(site_id)
        or public.can_access_ticket_equipment(equipment_id, site_id)
      )
    )
  )
  with check (
    public.is_admin()
    or (
      public.current_app_role() = 'Supervisor'
      and public.can_access_site(site_id)
    )
    or (
      registered_by = auth.uid()
      and (
        public.can_access_site(site_id)
        or public.can_access_ticket_equipment(equipment_id, site_id)
      )
    )
  );

drop policy if exists "parts update assigned site" on public.part_requests;
create policy "parts update by requester supervisor or admin" on public.part_requests
  for update to authenticated
  using (
    public.is_admin()
    or (
      public.current_app_role() = 'Supervisor'
      and public.can_access_site(site_id)
    )
    or (
      requested_by = auth.uid()
      and (
        public.can_access_site(site_id)
        or public.can_access_ticket(ticket_id)
      )
    )
  )
  with check (
    public.is_admin()
    or (
      public.current_app_role() = 'Supervisor'
      and public.can_access_site(site_id)
    )
    or (
      requested_by = auth.uid()
      and (
        public.can_access_site(site_id)
        or public.can_access_ticket(ticket_id)
      )
    )
  );

drop policy if exists "knowledge entries authenticated read" on public.knowledge_entries;
create policy "knowledge entries managers or assigned technicians read"
  on public.knowledge_entries for select to authenticated
  using (
    public.current_app_role() in ('Administrador', 'Supervisor')
    or (
      public.current_app_role() = 'Técnico'
      and exists (
        select 1
        from public.equipment e
        join public.brands b on b.id = e.brand_id
        where b.legacy_id = knowledge_entries.brand_legacy_id
          and lower(btrim(coalesce(e.model, ''))) = lower(btrim(knowledge_entries.model))
          and (
            public.can_access_site(e.site_id)
            or public.can_access_ticket_equipment(e.id, e.site_id)
          )
      )
    )
  );

drop policy if exists "knowledge photos authenticated read" on storage.objects;
create policy "knowledge photos managers or assigned technicians read"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'equipment-knowledge'
    and (
      public.current_app_role() in ('Administrador', 'Supervisor')
      or exists (
        select 1
        from public.knowledge_entries k
        where k.photos @> jsonb_build_array(jsonb_build_object('path', storage.objects.name))
      )
    )
  );
