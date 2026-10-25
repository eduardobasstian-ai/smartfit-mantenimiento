(function (global) {
  "use strict";
  const URL = "https://acmcksmiqrfrxopceies.supabase.co";
  const KEY = "sb_publishable_uWaLgff_Xc03iC68QpUUuQ_QkmCLLGy";
  const TICKETS_KEY = "smartfit.leader-tickets.v1";
  const RECORDS_KEY = "smartfit.machine-records.v1";
  const PENDING_KEY = "smartfit.supabase.pending.v1";
  const ACCESS_HISTORY_KEY = "smartfit.admin.access-history.v1";
  let realtimeClient = null;
  let realtimeChannel = null;
  let realtimeRefreshTimer = null;

  function auth() {
    try { return JSON.parse(sessionStorage.getItem("smartfit.supabase.auth") || "null"); }
    catch (error) { return null; }
  }
  let refreshInFlight = null;
  async function refreshAuth(force = false) {
    const current = auth();
    if (!current?.refresh_token) throw new Error("La sesión de Supabase venció. Vuelve a iniciar sesión.");
    const expiresAt = Number(current.expires_at) || 0;
    if (!force && expiresAt > Math.floor(Date.now() / 1000) + 60) return current;
    if (refreshInFlight) return refreshInFlight;

    refreshInFlight = (async () => {
      const response = await fetch(`${URL}/auth/v1/token?grant_type=refresh_token`, {
        method: "POST",
        headers: { apikey: KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: current.refresh_token })
      });
      const text = await response.text();
      let result = {};
      try { result = text ? JSON.parse(text) : {}; } catch (error) {}
      if (!response.ok || !result.access_token || !result.refresh_token) {
        throw new Error(result.error_description || result.msg || result.message || "La sesión venció y no se pudo renovar.");
      }
      const next = Object.assign({}, current, result, {
        expires_at: Number(result.expires_at) || Math.floor(Date.now() / 1000) + Number(result.expires_in || 3600)
      });
      sessionStorage.setItem("smartfit.supabase.auth", JSON.stringify(next));
      return next;
    })();
    try { return await refreshInFlight; }
    finally { refreshInFlight = null; }
  }
  async function authorizedFetch(url, options = {}) {
    let session = await refreshAuth();
    const headers = new Headers(options.headers || {});
    headers.set("apikey", KEY);
    headers.set("Authorization", `Bearer ${session.access_token}`);
    let response = await fetch(url, Object.assign({}, options, { headers }));
    if (response.status === 401 && session.refresh_token) {
      session = await refreshAuth(true);
      headers.set("Authorization", `Bearer ${session.access_token}`);
      response = await fetch(url, Object.assign({}, options, { headers }));
    }
    return response;
  }
  function appSession() {
    const sessions = ["smartfit.site.session", "smartfit.leader.session", "smartfit.admin.session"]
      .map(key => { try { return JSON.parse(sessionStorage.getItem(key) || "null"); } catch (error) { return null; } })
      .filter(Boolean);
    try {
      const token = auth()?.access_token || "";
      const payload = token.split(".")[1];
      const claims = payload ? JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))) : null;
      const matching = sessions.find(value => value.authId === claims?.sub);
      if (matching) return matching;
    } catch (error) { /* se usa la sesión disponible abajo */ }
    return sessions[0] || null;
  }
  function parseLocal(key, fallback) {
    try { const value = JSON.parse(localStorage.getItem(key) || ""); return value ?? fallback; }
    catch (error) { return fallback; }
  }
  // Mantiene el tamaño por debajo del límite máximo de filas que puede fijar
  // Supabase REST; así la paginación no confunde una página truncada con el final.
  async function queryRows(path, pageSize = 25) {
    const token = auth()?.access_token;
    if (!token) return [];
    const rows = [];
    const limit = Math.max(1, Math.min(1000, Number(pageSize) || 25));
    for (let offset = 0; ; offset += limit) {
      const separator = path.includes("?") ? "&" : "?";
      const response = await authorizedFetch(`${URL}/rest/v1/${path}${separator}limit=${limit}&offset=${offset}`);
      const text = await response.text();
      if (!response.ok) throw new Error(`No se pudo consultar Supabase (${response.status}): ${text}`);
      const page = text ? JSON.parse(text) : [];
      rows.push(...page);
      if (page.length < limit) break;
    }
    return rows;
  }
  async function getRows(table, select = "*") { return queryRows(`${table}?select=${encodeURIComponent(select)}`); }
  async function postRow(table, row, conflict = "legacy_id") {
    const token = auth()?.access_token;
    if (!token) throw new Error("No hay una sesión autenticada de Supabase.");
    const response = await authorizedFetch(`${URL}/rest/v1/${table}?on_conflict=${conflict}&select=id,legacy_id`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify(row)
    });
    const text = await response.text();
    if (!response.ok) {
      let message = text;
      try { const data = JSON.parse(text); message = data.message || data.details || text; } catch (error) {}
      throw new Error(`No se pudo guardar en ${table} (${response.status}): ${message}`);
    }
    return text ? JSON.parse(text)[0] : null;
  }
  async function postRows(table, rows, conflict = "legacy_id", returning = "id,legacy_id") {
    if (!Array.isArray(rows) || !rows.length) return [];
    const token = auth()?.access_token;
    if (!token) throw new Error("No hay una sesión autenticada de Supabase.");
    const response = await authorizedFetch(`${URL}/rest/v1/${table}?on_conflict=${encodeURIComponent(conflict)}&select=${encodeURIComponent(returning)}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=representation"
      },
      body: JSON.stringify(rows)
    });
    const text = await response.text();
    if (!response.ok) {
      let message = text;
      try { const data = JSON.parse(text); message = data.message || data.details || text; } catch (error) {}
      throw new Error(`No se pudo guardar en ${table} (${response.status}): ${message}`);
    }
    return text ? JSON.parse(text) : [];
  }
  async function deleteRow(table, filter) {
    const token = auth()?.access_token;
    if (!token) throw new Error("No hay una sesión autenticada de Supabase.");
    const response = await authorizedFetch(`${URL}/rest/v1/${table}?${filter}`, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" }
    });
    if (!response.ok) throw new Error(`No se pudo eliminar en ${table} (${response.status}): ${await response.text()}`);
  }
  async function updateRow(table, id, row, returning = "id,legacy_id") {
    const response = await authorizedFetch(`${URL}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}&select=${encodeURIComponent(returning)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Prefer: "return=representation" },
      body: JSON.stringify(row)
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`No se pudo actualizar en ${table} (${response.status}): ${text}`);
    const rows = text ? JSON.parse(text) : [];
    if (!rows.length) throw new Error(`No se pudo actualizar en ${table}: el registro no está disponible para esta cuenta.`);
    return rows[0];
  }
  async function persistSite(site) {
    if (!site || !site.id) throw new Error("No se encontró la sede que se debe guardar.");
    const session = appSession();
    if (session?.role !== "Administrador") throw new Error("Solo un administrador puede guardar sedes e inventario.");

    let preflightEquipment = [];
    let preflightSites = [];
    if (Array.isArray(site.equipment)) {
      const requestedAssets = new Map();
      for (const group of site.equipment) {
        for (const unit of Array.isArray(group.units) ? group.units : []) {
          const fixedAsset = String(unit.activeFixed ?? "").trim();
          if (!fixedAsset) continue;
          const normalized = fixedAsset.toLocaleLowerCase("es");
          if (requestedAssets.has(normalized)) {
            throw new Error(`El activo fijo ${fixedAsset} está repetido en los equipos de esta sede. Cada activo fijo debe pertenecer a un solo equipo.`);
          }
          requestedAssets.set(normalized, fixedAsset);
        }
      }
      const existingSite = await lookupOne("sites", "id", "legacy_id", String(site.id));
      [preflightEquipment, preflightSites] = await Promise.all([
        getRows("equipment", "id,legacy_id,site_id,fixed_asset"),
        getRows("sites", "id,name")
      ]);
      const siteNameById = new Map(preflightSites.map(row => [String(row.id), row.name]));
      const existingByFixedAsset = new Map(preflightEquipment
        .filter(row => row.fixed_asset !== null && row.fixed_asset !== "")
        .map(row => [String(row.fixed_asset).trim().toLocaleLowerCase("es"), row]));
      for (const [normalized, fixedAsset] of requestedAssets) {
        const existing = existingByFixedAsset.get(normalized);
        if (existing && String(existing.site_id) !== String(existingSite?.id || "")) {
          const assignedSite = siteNameById.get(String(existing.site_id)) || "otra sede";
          throw new Error(`El activo fijo ${fixedAsset} ya está registrado en “${assignedSite}”. No se guardó ningún cambio para evitar duplicar o mover un equipo con historial.`);
        }
      }
    }

    const remoteSite = await postRow("sites", {
      legacy_id: String(site.id),
      internal_code: Number(site.internalCode) || null,
      name: String(site.name || "").trim(),
      region: String(site.region || "").trim() || null,
      active: site.active !== false
    });
    if (!remoteSite?.id) throw new Error("Supabase no devolvió el identificador de la sede guardada.");

    const [brands, assignments] = await Promise.all([
      Array.isArray(site.equipment) ? getRows("brands", "id,legacy_id,name") : Promise.resolve([]),
      queryRows(`site_assignments?select=user_id,assignment_role&site_id=eq.${encodeURIComponent(remoteSite.id)}`)
    ]);
    const remoteEquipment = preflightEquipment;
    const remoteSites = preflightSites;
    const users = AdminStore.listUsers();
    const desiredAssignments = [];
    for (const [role, localUserId] of [["Técnico", site.technicianUserId], ["Supervisor", site.supervisorUserId]]) {
      if (!localUserId) continue;
      const localUser = users.find(user => String(user.id) === String(localUserId) && user.role === role && user.active);
      if (!localUser) throw new Error(`No se encontró el perfil activo de ${role.toLocaleLowerCase("es")} seleccionado para la sede.`);
      const userId = await profileIdForLegacy(localUser.id, session);
      if (!userId) throw new Error(`La cuenta de ${role.toLocaleLowerCase("es")} seleccionada aún no está vinculada a Supabase.`);
      desiredAssignments.push({ site_id: remoteSite.id, user_id: userId, assignment_role: role });
    }
    if (desiredAssignments.length) {
      await postRows("site_assignments", desiredAssignments, "site_id,user_id,assignment_role", "id");
    }
    const desiredAssignmentKeys = new Set(desiredAssignments.map(row => `${row.assignment_role}::${row.user_id}`));
    for (const row of assignments) {
      const key = `${row.assignment_role}::${row.user_id}`;
      if (["Técnico", "Supervisor"].includes(row.assignment_role) && !desiredAssignmentKeys.has(key)) {
        await deleteRow("site_assignments", `site_id=eq.${encodeURIComponent(remoteSite.id)}&user_id=eq.${encodeURIComponent(row.user_id)}&assignment_role=eq.${encodeURIComponent(row.assignment_role)}`);
      }
    }
    // Si el inventario no se modificó en el formulario, se conserva el remoto.
    if (!Array.isArray(site.equipment)) return remoteSite;

    const brandIdByLegacy = new Map(brands.map(row => [String(row.legacy_id || ""), row.id]));
    const brandIdByName = new Map(brands.map(row => [cleanName(row.name), row.id]));
    const equipmentRows = [];
    for (const [groupIndex, group] of site.equipment.entries()) {
      for (const [unitIndex, unit] of (Array.isArray(group.units) ? group.units : []).entries()) {
        const brandLegacyId = String(group.brandId || group.catalogId || "");
        const brandId = brandIdByLegacy.get(brandLegacyId) || brandIdByName.get(cleanName(group.brandName)) || null;
        equipmentRows.push({
          legacy_id: `${site.id}::${group.brandId || group.catalogId || groupIndex}::${unit.unitId || unitIndex}`,
          site_id: remoteSite.id,
          brand_id: brandId,
          fixed_asset: unit.activeFixed === "" || unit.activeFixed === null || unit.activeFixed === undefined ? null : String(unit.activeFixed),
          name: String(group.name || "Equipo sin nombre"),
          model: String(group.model || "") || null,
          category: String(group.category || "") || null,
          image_url: String(group.image || "") || null,
          active: true,
          metadata: { legacyBrandId: group.brandId || null, catalogId: group.catalogId || null }
        });
      }
    }

    const assetOccurrences = new Map();
    for (const row of equipmentRows) {
      const fixedAsset = String(row.fixed_asset ?? "").trim();
      if (!fixedAsset) continue;
      const normalized = fixedAsset.toLocaleLowerCase("es");
      if (assetOccurrences.has(normalized)) {
        throw new Error(`El activo fijo ${fixedAsset} está repetido en los equipos de esta sede. Cada activo fijo debe pertenecer a un solo equipo.`);
      }
      assetOccurrences.set(normalized, fixedAsset);
    }

    const siteNameById = new Map(remoteSites.map(row => [String(row.id), row.name]));
    const equipmentByFixedAsset = new Map(remoteEquipment
      .filter(row => row.fixed_asset !== null && row.fixed_asset !== "")
      .map(row => [String(row.fixed_asset).trim().toLocaleLowerCase("es"), row]));
    const equipmentByLegacyId = new Map(remoteEquipment.map(row => [String(row.legacy_id || ""), row]));
    const savedEquipment = [];
    const newEquipment = [];
    for (const row of equipmentRows) {
      const fixedAsset = String(row.fixed_asset ?? "").trim();
      const existingByFixedAsset = fixedAsset ? equipmentByFixedAsset.get(fixedAsset.toLocaleLowerCase("es")) : null;
      if (existingByFixedAsset) {
        if (String(existingByFixedAsset.site_id) !== String(remoteSite.id)) {
          const assignedSite = siteNameById.get(String(existingByFixedAsset.site_id)) || "otra sede";
          throw new Error(`El activo fijo ${fixedAsset} ya está registrado en “${assignedSite}”. No se guardó el inventario para evitar duplicar o mover un equipo con historial.`);
        }
        const existingByLegacyId = equipmentByLegacyId.get(String(row.legacy_id));
        if (existingByLegacyId && String(existingByLegacyId.id) !== String(existingByFixedAsset.id)) {
          throw new Error(`El activo fijo ${fixedAsset} y su identificador de catálogo apuntan a equipos distintos. Revisa la asignación antes de guardar.`);
        }
        savedEquipment.push(await updateRow("equipment", existingByFixedAsset.id, row));
      } else {
        const existingByLegacyId = equipmentByLegacyId.get(String(row.legacy_id));
        if (existingByLegacyId && String(existingByLegacyId.site_id) !== String(remoteSite.id)) {
          throw new Error(`El equipo ${row.name} ya está vinculado a otra sede. No se guardaron cambios para evitar alterar su historial.`);
        }
        newEquipment.push(row);
      }
    }
    savedEquipment.push(...await postRows("equipment", newEquipment));
    const retainedEquipmentIds = new Set(savedEquipment.map(row => String(row.id)));
    const staleRows = remoteEquipment.filter(row => row.legacy_id && String(row.site_id) === String(remoteSite.id) && !retainedEquipmentIds.has(String(row.id)));
    for (const row of staleRows) {
      await deleteRow("equipment", `id=eq.${encodeURIComponent(row.id)}`);
    }
    return { ...remoteSite, equipment: savedEquipment.length };
  }
  async function persistBrand(brand) {
    if (!brand?.id || !String(brand.name || "").trim()) throw new Error("Completa el nombre de la marca antes de guardar.");
    return postRow("brands", { legacy_id: String(brand.id), name: String(brand.name).trim(), active: brand.active !== false });
  }
  async function deleteBrand(legacyId) {
    const brand = await lookupOne("brands", "id,legacy_id", "legacy_id", legacyId);
    if (brand?.id) await deleteRow("brands", `id=eq.${encodeURIComponent(brand.id)}`);
  }
  async function deleteSite(legacyId) {
    const site = await lookupOne("sites", "id,legacy_id", "legacy_id", legacyId);
    if (site?.id) await deleteRow("sites", `id=eq.${encodeURIComponent(site.id)}`);
  }
  async function recordAccess(user) {
    const token = auth()?.access_token;
    if (!token) throw new Error("No hay una sesión autenticada para registrar el acceso.");
    if (!user?.authId) throw new Error("El perfil no está vinculado a una cuenta de Supabase Auth.");
    const response = await authorizedFetch(`${URL}/rest/v1/audit_log`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Prefer: "return=minimal"
      },
      body: JSON.stringify({
        actor_id: user.authId,
        action: "login_success",
        entity_type: "profile",
        entity_id: user.authId,
        details: {
          full_name: String(user.name || "Usuario"),
          username: String(user.username || "—"),
          role: String(user.role || "Usuario")
        }
      })
    });
    if (!response.ok) throw new Error(`No se pudo registrar el acceso (${response.status}): ${await response.text()}`);
  }
  function startRealtimeSync() {
    if (realtimeChannel) return true;
    if (!auth()?.access_token) return false;
    if (!global.supabase?.createClient) {
      console.warn("No se pudo iniciar sincronización: falta cargar el cliente oficial de Supabase.");
      return false;
    }
    realtimeClient = global.supabase.createClient(URL, KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      accessToken: async () => {
        try { return (await refreshAuth()).access_token; }
        catch (error) {
          console.warn("No se pudo renovar la sesión de tiempo real.", error);
          return null;
        }
      }
    });
    realtimeChannel = realtimeClient.channel("smartfit-live-sync", { config: { private: true } });
    const scheduleRefresh = () => {
      clearTimeout(realtimeRefreshTimer);
      realtimeRefreshTimer = setTimeout(async () => {
        try {
          const result = await hydrate();
          if (!result.skipped) global.dispatchEvent(new Event("smartfit:supabase-data-hydrated"));
        } catch (error) {
          console.warn("No se pudieron actualizar los datos en tiempo real.", error);
        }
      }, 350);
    };
    // El mensaje de Broadcast solo anuncia que hubo un cambio; los datos siempre
    // se vuelven a consultar por REST, donde Supabase aplica RLS por perfil.
    realtimeChannel.on("broadcast", { event: "smartfit-change" }, scheduleRefresh);
    realtimeChannel.subscribe((status, error) => {
      if (status === "SUBSCRIBED") scheduleRefresh();
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        console.warn("La sincronización en tiempo real no pudo conectarse.", error || status);
      }
    });
    return true;
  }
  async function manageUser(payload) {
    const token = auth()?.access_token;
    if (!token) throw new Error("No hay una sesión autenticada de Supabase.");
    const response = await authorizedFetch(`${URL}/functions/v1/admin-manage-user`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const text = await response.text();
    let result = {};
    try { result = text ? JSON.parse(text) : {}; } catch (error) {}
    if (!response.ok) throw new Error(result.error || text || `No se pudo gestionar la cuenta (${response.status}).`);
    return result;
  }
  const cleanName = value => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLocaleLowerCase("es");
  const dateOnly = value => String(value || "").slice(0, 10);
  function setLocal(key, value) { localStorage.setItem(key, JSON.stringify(value)); }
  function readPending() {
    const value = parseLocal(PENDING_KEY, {});
    return value && typeof value === "object" && !Array.isArray(value) ? value : { tickets: [], records: {} };
  }
  function savePending(value) { setLocal(PENDING_KEY, value); }

  async function lookupOne(table, select, field, value) {
    const rows = await queryRows(`${table}?select=${encodeURIComponent(select)}&${field}=eq.${encodeURIComponent(String(value))}`);
    return rows[0] || null;
  }
  async function profileIdForLegacy(localId, actor) {
    if (!localId) return null;
    if (actor && String(actor.id) === String(localId)) return actor.authId || null;
    return (await lookupOne("profiles", "id", "legacy_id", localId))?.id || null;
  }
  async function equipmentForRecordKey(recordKey) {
    const siteId = String(recordKey || "").split("::")[0];
    const site = AdminStore.listSites().find(row => String(row.id) === siteId);
    if (!site) return null;
    let foundLegacy = "";
    (Array.isArray(site.equipment) ? site.equipment : []).forEach((group, groupIndex) => {
      const units = Array.isArray(group.units) ? group.units : [];
      units.forEach((unit, unitIndex) => {
        const unitKey = String(unit.unitId || `${group.catalogId || group.brandId || "equipo"}:${unitIndex}`);
        if (`${siteId}::${unitKey}` === recordKey) {
          foundLegacy = `${siteId}::${group.brandId || group.catalogId || groupIndex}::${unit.unitId || unitIndex}`;
        }
      });
    });
    if (!foundLegacy) return null;
    return (await lookupOne("equipment", "id", "legacy_id", foundLegacy))?.id || null;
  }
  function localEquipmentForRecordKey(recordKey) {
    const [siteId, unitId] = String(recordKey || "").split("::");
    const site = AdminStore.listSites().find(row => String(row.id) === siteId);
    if (!site) return null;
    for (const [groupIndex, group] of (site.equipment || []).entries()) {
      for (const [unitIndex, unit] of (group.units || []).entries()) {
        const key = String(unit.unitId || `${group.catalogId || group.brandId || "equipo"}:${unitIndex}`);
        if (key !== unitId) continue;
        return {
          name: String(group.name || "Equipo"), model: String(group.model || "") || null,
          fixedAsset: unit.activeFixed === "" || unit.activeFixed == null ? null : String(unit.activeFixed),
          category: group.category || null, image: group.image || ""
        };
      }
    }
    return null;
  }
  async function siteUuidForLegacy(siteLegacyId) {
    return (await lookupOne("sites", "id", "legacy_id", siteLegacyId))?.id || null;
  }
  function normalizeEventType(value) {
    const type = cleanName(value);
    if (type.includes("correctivo")) return "Correctivo";
    if (type.includes("preventivo")) return "Preventivo";
    if (type.includes("inspeccion")) return "Inspección";
    if (type.includes("lubric")) return "Lubricación";
    return "Otro";
  }
  function cleanMetadata(value, photoField) {
    const metadata = Object.assign({}, value || {});
    delete metadata[photoField];
    return metadata;
  }
  async function ticketUuidForLegacy(ticketId) {
    return (await lookupOne("tickets", "id", "legacy_id", ticketId))?.id || null;
  }

  async function persistTicket(ticket) {
    const actor = appSession();
    if (!actor?.authId || !ticket?.id) throw new Error("No se identificó la sesión o el ticket.");
    const siteUuid = await siteUuidForLegacy(ticket.siteId);
    if (!siteUuid) throw new Error("La sede del ticket todavía no está vinculada a Supabase.");
    const existing = await lookupOne("tickets", "id,created_by", "legacy_id", ticket.id);
    const site = AdminStore.listSites().find(row => String(row.id) === String(ticket.siteId));
    const equipmentId = ticket.machineRecordKey ? await equipmentForRecordKey(ticket.machineRecordKey) : null;
    const creatorId = existing?.created_by || await profileIdForLegacy(ticket.createdById || ticket.leaderId, actor) || actor.authId;
    const supervisorId = await profileIdForLegacy(ticket.supervisorId || site?.supervisorUserId, actor);
    const technicianId = await profileIdForLegacy(ticket.technicianId || site?.technicianUserId, actor);
    const leaderId = await profileIdForLegacy(ticket.leaderId, actor);
    const ticketDate = String(ticket.date || ticket.createdAt || new Date().toISOString()).slice(0, 10);
    const ticketType = cleanName(ticket.type).includes("infraestructura") ? "Infraestructura" : "Mantenimiento";
    const statusName = cleanName(ticket.status || "Pendiente");
    const status = statusName.includes("ejecucion") ? "En ejecución" : statusName.includes("ejecutad") ? "Ejecutado" : statusName.includes("cerrad") ? "Cerrado" : statusName.includes("rechaz") ? "Rechazado" : "Pendiente";
    const photos = Array.isArray(ticket.images) ? ticket.images : [];
    return postRow("tickets", {
      legacy_id: String(ticket.id), ticket_number: String(ticket.ticketNumber || ticket.id), ticket_type: ticketType,
      site_id: siteUuid, equipment_id: equipmentId,
      fixed_asset: !ticket.activeFixed || cleanName(ticket.activeFixed) === "n/a" ? null : String(ticket.activeFixed),
      title: String(ticket.title || ticket.machineName || ticket.ticketNumber || "Ticket"), description: String(ticket.description || ""), status,
      supervisor_id: supervisorId, supervisor_name: String(ticket.supervisor || site?.supervisor || "") || null,
      technician_id: technicianId, technician_name: String(ticket.technician || site?.technician || "") || null,
      leader_id: leaderId, leader_name: String(ticket.leaderName || "") || null,
      created_by: creatorId, created_by_name: String(ticket.createdByName || ticket.leaderName || ticket.supervisor || actor.name || "") || null,
      updated_by: actor.authId, machine_record_key: ticket.machineRecordKey || null, ticket_date: ticketDate,
      photos, metadata: cleanMetadata(ticket, "images"),
      created_at: ticket.createdAt || new Date().toISOString(), updated_at: new Date().toISOString()
    });
  }

  async function persistMaintenance(recordKey, entry) {
    const actor = appSession();
    const siteLegacyId = String(recordKey).split("::")[0];
    const siteUuid = await siteUuidForLegacy(siteLegacyId);
    if (!actor?.authId || !siteUuid || !entry?.id) throw new Error("No se pudo vincular el evento con una sesión y sede válidas.");
    const legacyId = `${recordKey}::maintenance::${entry.id}`;
    const existing = await lookupOne("maintenance_events", "id,registered_by,created_at", "legacy_id", legacyId);
    const site = AdminStore.listSites().find(row => String(row.id) === siteLegacyId);
    const ticketUuid = Array.isArray(entry.ticketIds) && entry.ticketIds.length ? await ticketUuidForLegacy(entry.ticketIds[0]) : null;
    const technician = AdminStore.listUsers().find(user => user.name === entry.technician && user.role === "Técnico");
    const supervisor = AdminStore.listUsers().find(user => user.id === site?.supervisorUserId) || AdminStore.listUsers().find(user => user.name === site?.supervisor && user.role === "Supervisor");
    const equipment = localEquipmentForRecordKey(recordKey) || {};
    const date = String(entry.date || entry.recordedAt || new Date().toISOString()).slice(0, 10);
    const details = [entry.work, entry.replacement ? `Repuesto: ${entry.replacement}` : "", entry.observations ? `Observaciones: ${entry.observations}` : ""].filter(Boolean).join("\n");
    await postRow("maintenance_events", {
      legacy_id: legacyId, source_record_key: recordKey, site_id: siteUuid,
      equipment_id: await equipmentForRecordKey(recordKey), equipment_name: equipment.name || "Equipo",
      equipment_model: equipment.model, fixed_asset: equipment.fixedAsset, event_type: normalizeEventType(entry.type),
      status: String(entry.status || entry.type || "Registrado"), details, ticket_id: ticketUuid,
      technician_id: await profileIdForLegacy(technician?.id, actor), technician_name: entry.technician || null,
      supervisor_id: await profileIdForLegacy(supervisor?.id, actor), supervisor_name: supervisor?.name || site?.supervisor || null,
      registered_by: existing?.registered_by || await profileIdForLegacy(entry.recordedById, actor) || actor.authId,
      registered_by_name: entry.recordedByName || actor.name || null,
      photos: Array.isArray(entry.images) ? entry.images : [], occurred_at: `${date}T12:00:00.000Z`,
      created_at: existing?.created_at || entry.recordedAt || new Date().toISOString(), updated_at: new Date().toISOString(),
      metadata: cleanMetadata(entry, "images")
    });
    const saved = await lookupOne("maintenance_events", "id", "legacy_id", legacyId);
    const ticketIds = [...new Set(Array.isArray(entry.ticketIds) ? entry.ticketIds : [])];
    if (saved?.id) {
      const links = [];
      for (const ticketId of ticketIds) {
        const remoteTicketId = await ticketUuidForLegacy(ticketId);
        if (remoteTicketId) links.push({ event_id: saved.id, ticket_id: remoteTicketId });
      }
      await deleteRow("maintenance_event_tickets", `event_id=eq.${encodeURIComponent(saved.id)}`);
      if (links.length) await postLinks(saved.id, links);
    }
  }

  async function persistMileage(recordKey, entry) {
    const actor = appSession();
    const siteLegacyId = String(recordKey).split("::")[0];
    const siteUuid = await siteUuidForLegacy(siteLegacyId);
    if (!actor?.authId || !siteUuid || !entry?.id) throw new Error("No se pudo vincular el kilometraje con una sesión y sede válidas.");
    const legacyId = `${recordKey}::mileage::${entry.id}`;
    const existing = await lookupOne("mileage_records", "id,registered_by", "legacy_id", legacyId);
    const site = AdminStore.listSites().find(row => String(row.id) === siteLegacyId);
    const technician = AdminStore.listUsers().find(user => user.name === entry.technician && user.role === "Técnico");
    const supervisor = AdminStore.listUsers().find(user => user.id === site?.supervisorUserId) || AdminStore.listUsers().find(user => user.name === site?.supervisor && user.role === "Supervisor");
    const equipment = localEquipmentForRecordKey(recordKey) || {};
    const date = String(entry.date || entry.recordedAt || new Date().toISOString()).slice(0, 10);
    return postRow("mileage_records", {
      legacy_id: legacyId, source_record_key: recordKey, site_id: siteUuid,
      equipment_id: await equipmentForRecordKey(recordKey), equipment_name: equipment.name || "Equipo", equipment_model: equipment.model, fixed_asset: equipment.fixedAsset,
      mileage_km: Number(entry.km), entry_date: date,
      technician_id: await profileIdForLegacy(technician?.id, actor), technician_name: entry.technician || null,
      supervisor_id: await profileIdForLegacy(supervisor?.id, actor), supervisor_name: supervisor?.name || site?.supervisor || null,
      registered_by: existing?.registered_by || await profileIdForLegacy(entry.recordedById, actor) || actor.authId,
      registered_by_name: entry.recordedByName || actor.name || null, notes: String(entry.observation || ""),
      lubrication: entry.lubrication || null, photos: [], recorded_at: entry.recordedAt || new Date().toISOString(),
      metadata: cleanMetadata(entry, "photos")
    });
  }

  async function postLinks(eventId, links) {
    const token = auth()?.access_token;
    if (!token) throw new Error("No hay una sesión autenticada de Supabase.");
    const response = await authorizedFetch(`${URL}/rest/v1/maintenance_event_tickets?on_conflict=event_id,ticket_id`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(links)
    });
    if (!response.ok) throw new Error(`No se pudo vincular el ticket al evento (${response.status}): ${await response.text()}`);
  }

  async function persistMachineRecordNow(recordKey, before, after) {
    const errors = [];
    for (const kind of ["maintenance", "mileage"]) {
      const previous = new Map((before?.[kind] || []).map(entry => [String(entry.id), entry]));
      const next = new Map((after?.[kind] || []).map(entry => [String(entry.id), entry]));
      for (const [id, entry] of next) {
        if (JSON.stringify(previous.get(id)) === JSON.stringify(entry)) continue;
        try {
          if (kind === "maintenance") await persistMaintenance(recordKey, entry);
          else await persistMileage(recordKey, entry);
        } catch (error) { errors.push(error.message); }
      }
      for (const [id] of previous) {
        if (next.has(id)) continue;
        try {
          const table = kind === "maintenance" ? "maintenance_events" : "mileage_records";
          const prefix = kind === "maintenance" ? "maintenance" : "mileage";
          const legacyId = `${recordKey}::${prefix}::${id}`;
          await deleteRow(table, `legacy_id=eq.${encodeURIComponent(legacyId)}`);
        } catch (error) { errors.push(error.message); }
      }
    }
    if (errors.length) throw new Error(errors.join("\n"));
  }

  async function persistTicketQueued(ticket) {
    try {
      await persistTicket(ticket);
      const pending = readPending();
      pending.tickets = (pending.tickets || []).filter(id => String(id) !== String(ticket.id));
      savePending(pending);
    } catch (error) {
      const pending = readPending();
      pending.tickets = [...new Set([...(pending.tickets || []), String(ticket.id)])];
      savePending(pending);
      throw error;
    }
  }
  async function persistMachineRecord(recordKey, before, after) {
    const queued = readPending().records?.[recordKey] || { maintenance: [], mileage: [] };
    const beforeForSync = {
      maintenance: [...(before?.maintenance || []), ...(queued.maintenance || []).map(id => ({ id }))],
      mileage: [...(before?.mileage || []), ...(queued.mileage || []).map(id => ({ id }))]
    };
    try {
      await persistMachineRecordNow(recordKey, beforeForSync, after);
      const pending = readPending();
      delete pending.records?.[recordKey];
      savePending(pending);
    } catch (error) {
      const pending = readPending();
      const deleted = { maintenance: [...(queued.maintenance || [])], mileage: [...(queued.mileage || [])] };
      for (const kind of ["maintenance", "mileage"]) {
        const oldIds = new Set((before?.[kind] || []).map(entry => String(entry.id)));
        const newIds = new Set((after?.[kind] || []).map(entry => String(entry.id)));
        oldIds.forEach(id => { if (!newIds.has(id)) deleted[kind].push(id); });
        deleted[kind] = [...new Set(deleted[kind])];
      }
      pending.records = Object.assign({}, pending.records, { [recordKey]: deleted });
      savePending(pending);
      throw error;
    }
  }
  async function flushPending() {
    const pending = readPending();
    const localTickets = parseLocal(TICKETS_KEY, []);
    for (const id of pending.tickets || []) {
      const ticket = localTickets.find(row => String(row.id) === String(id));
      if (!ticket) continue;
      try { await persistTicket(ticket); pending.tickets = pending.tickets.filter(value => String(value) !== String(id)); }
      catch (error) { console.warn("Pendiente de sincronizar ticket", id, error); }
    }
    const localRecords = parseLocal(RECORDS_KEY, {});
    for (const [recordKey, deleted] of Object.entries(pending.records || {})) {
      const after = localRecords[recordKey] || { maintenance: [], mileage: [] };
      const before = {
        maintenance: (deleted.maintenance || []).map(id => ({ id })),
        mileage: (deleted.mileage || []).map(id => ({ id }))
      };
      try { await persistMachineRecordNow(recordKey, before, after); delete pending.records[recordKey]; }
      catch (error) { console.warn("Pendiente de sincronizar registro", recordKey, error); }
    }
    savePending(pending);
  }

  function mergeById(localRows, remoteRows) {
    const map = new Map((Array.isArray(localRows) ? localRows : []).filter(Boolean).map(row => [String(row.id), row]));
    remoteRows.forEach(row => map.set(String(row.id), row));
    return [...map.values()];
  }

  function hydrateSites(remoteSites, remoteBrands, remoteEquipment, localSites) {
    const brandById = new Map(remoteBrands.map(brand => [brand.id, brand]));
    const equipmentBySite = new Map();
    remoteEquipment.forEach(row => {
      const groupKey = `${row.brand_id || row.metadata?.legacyBrandId || "sin-marca"}::${row.metadata?.catalogId || row.name}::${row.model || ""}`;
      const siteRows = equipmentBySite.get(row.site_id) || new Map();
      const group = siteRows.get(groupKey) || {
        brandId: row.metadata?.legacyBrandId || brandById.get(row.brand_id)?.legacy_id || "",
        brandName: brandById.get(row.brand_id)?.name || "Sin marca",
        catalogId: row.metadata?.catalogId || "",
        name: row.name || "Equipo", model: row.model || "", category: row.category || "",
        image: row.image_url || "", quantity: 0, units: []
      };
      const parts = String(row.legacy_id || "").split("::");
      group.units.push({ unitId: parts.slice(2).join("::") || row.id, activeFixed: row.fixed_asset === null ? "" : Number.isFinite(Number(row.fixed_asset)) ? Number(row.fixed_asset) : row.fixed_asset });
      group.quantity = group.units.length;
      siteRows.set(groupKey, group);
      equipmentBySite.set(row.site_id, siteRows);
    });
    const localById = new Map((Array.isArray(localSites) ? localSites : []).map(site => [String(site.id), site]));
    const merged = new Map(localById);
    remoteSites.forEach(row => {
      const legacyId = String(row.legacy_id || "");
      if (!legacyId) return;
      const prior = merged.get(legacyId) || {};
      const groups = [...(equipmentBySite.get(row.id)?.values() || [])];
      merged.set(legacyId, Object.assign({}, prior, {
        id: legacyId,
        name: row.name || prior.name,
        region: row.region || prior.region || "",
        internalCode: row.internal_code ?? prior.internalCode,
        equipment: groups,
        machineCount: groups.reduce((sum, group) => sum + group.quantity, 0),
        active: row.active
      }));
    });
    return [...merged.values()];
  }

  function hydrateTickets(rows, siteIdToLegacy, profileIdToLegacy) {
    return rows.map(row => {
      const original = row.metadata && typeof row.metadata === "object" ? row.metadata : {};
      return Object.assign({}, original, {
        id: row.legacy_id || original.id,
        ticketNumber: row.ticket_number || original.ticketNumber,
        type: row.ticket_type || original.type,
        siteId: siteIdToLegacy.get(row.site_id) || original.siteId || "",
        siteName: original.siteName || "",
        activeFixed: row.fixed_asset ?? original.activeFixed ?? "N/A",
        status: row.status || original.status || "Pendiente",
        date: row.ticket_date || original.date || dateOnly(row.created_at),
        supervisorId: profileIdToLegacy.get(row.supervisor_id) || original.supervisorId || "",
        supervisor: row.supervisor_name || original.supervisor || "",
        technicianId: profileIdToLegacy.get(row.technician_id) || original.technicianId || "",
        technician: row.technician_name || original.technician || "",
        leaderId: profileIdToLegacy.get(row.leader_id) || original.leaderId || "",
        leaderName: row.leader_name || original.leaderName || "",
        createdById: profileIdToLegacy.get(row.created_by) || original.createdById || "",
        createdByName: row.created_by_name || original.createdByName || "",
        machineRecordKey: row.machine_record_key || original.machineRecordKey || "",
        title: row.title || original.title || "",
        description: row.description || original.description || "",
        images: Array.isArray(row.photos) ? row.photos : Array.isArray(original.images) ? original.images : [],
        statusUpdatedAt: row.updated_at || original.statusUpdatedAt || ""
      });
    });
  }

  function hydrateRecords(events, mileageRows, ticketLinks, ticketUuidToLegacy, siteIdToLegacy, profileIdToLegacy) {
    const records = {};
    events.forEach(row => {
      const recordKey = row.source_record_key || `${siteIdToLegacy.get(row.site_id) || ""}::`;
      if (!recordKey) return;
      const record = records[recordKey] || { maintenance: [], mileage: [] };
      const original = row.metadata && typeof row.metadata === "object" ? row.metadata : {};
      const ticketIds = ticketLinks.filter(link => link.event_id === row.id).map(link => ticketUuidToLegacy.get(link.ticket_id)).filter(Boolean);
      if (!ticketIds.length && row.ticket_id && ticketUuidToLegacy.has(row.ticket_id)) ticketIds.push(ticketUuidToLegacy.get(row.ticket_id));
      record.maintenance.push(Object.assign({}, original, {
        id: original.id || String(row.legacy_id || "").split("::maintenance::").pop(),
        date: original.date || dateOnly(row.occurred_at),
        type: original.type || row.event_type,
        work: original.work || row.details || "",
        replacement: original.replacement || "",
        observations: original.observations || "",
        technician: row.technician_name || original.technician || "",
        recordedById: profileIdToLegacy.get(row.registered_by) || original.recordedById || "",
        recordedByName: row.registered_by_name || original.recordedByName || "",
        recordedAt: row.created_at || original.recordedAt || "",
        images: Array.isArray(row.photos) ? row.photos : Array.isArray(original.images) ? original.images : [],
        ticketIds: ticketIds.length ? ticketIds : Array.isArray(original.ticketIds) ? original.ticketIds : []
      }));
      records[recordKey] = record;
    });
    mileageRows.forEach(row => {
      const recordKey = row.source_record_key || `${siteIdToLegacy.get(row.site_id) || ""}::`;
      if (!recordKey) return;
      const record = records[recordKey] || { maintenance: [], mileage: [] };
      const original = row.metadata && typeof row.metadata === "object" ? row.metadata : {};
      record.mileage.push(Object.assign({}, original, {
        id: original.id || String(row.legacy_id || "").split("::mileage::").pop(),
        date: row.entry_date || dateOnly(row.recorded_at),
        recordedAt: row.recorded_at || "",
        recordedById: profileIdToLegacy.get(row.registered_by) || original.recordedById || "",
        recordedByName: row.registered_by_name || original.recordedByName || "",
        recordedByRole: original.recordedByRole || "",
        km: Number(row.mileage_km), lubrication: row.lubrication || original.lubrication || "",
        observation: row.notes || original.observation || "",
        technician: row.technician_name || original.technician || ""
      }));
      records[recordKey] = record;
    });
    Object.values(records).forEach(record => {
      record.maintenance.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
      record.mileage.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
    });
    return records;
  }

  async function hydrate() {
    if (!auth()?.access_token) return { skipped: true };
    const canReadAccountEmails = appSession()?.role === "Administrador";
    const [sites, brands, equipment, tickets, events, mileageRows, eventLinks, profiles, assignments, accountAccess, accessRows] = await Promise.all([
      getRows("sites", "id,legacy_id,name,region,internal_code,active"),
      getRows("brands", "id,legacy_id,name,active"),
      getRows("equipment", "id,legacy_id,site_id,brand_id,fixed_asset,name,model,category,image_url,active,metadata"),
      getRows("tickets", "id,legacy_id,ticket_number,ticket_type,site_id,equipment_id,fixed_asset,title,description,status,supervisor_id,supervisor_name,technician_id,technician_name,leader_id,leader_name,created_by,created_by_name,updated_by,machine_record_key,ticket_date,photos,metadata,created_at,updated_at"),
      getRows("maintenance_events", "id,legacy_id,source_record_key,site_id,equipment_id,equipment_name,equipment_model,fixed_asset,event_type,status,details,ticket_id,technician_id,technician_name,supervisor_id,supervisor_name,registered_by,registered_by_name,photos,occurred_at,created_at,metadata"),
      getRows("mileage_records", "id,legacy_id,source_record_key,site_id,equipment_id,equipment_name,equipment_model,fixed_asset,mileage_km,entry_date,technician_id,technician_name,supervisor_id,supervisor_name,registered_by,registered_by_name,notes,lubrication,photos,recorded_at,metadata"),
      getRows("maintenance_event_tickets", "event_id,ticket_id"),
      getRows("profiles", "id,legacy_id,full_name,username,role,active,password_change_required,updated_at"),
      getRows("site_assignments", "site_id,user_id,assignment_role"),
      canReadAccountEmails
        ? getRows("admin_user_access", "profile_id,email").catch(error => {
          console.warn("No se pudo consultar el directorio de correos de administración; se continúa cargando el panel.", error);
          return [];
        })
        : Promise.resolve([]),
      canReadAccountEmails
        ? queryRows("audit_log?select=id,actor_id,action,entity_id,details,created_at&action=eq.login_success&order=created_at.desc", 15)
        : Promise.resolve([])
    ]);
    const siteIdToLegacy = new Map(sites.map(row => [row.id, String(row.legacy_id || "")]));
    // La función de login devuelve asignaciones como UUID de Supabase; las vistas locales
    // trabajan con legacy_id. Traducirlas aquí conserva el alcance por sede del supervisor.
    for (const key of ["smartfit.site.session", "smartfit.leader.session", "smartfit.admin.session"]) {
      const session = parseLocalSession(key);
      if (!session?.siteIds) continue;
      session.siteIds = session.siteIds.map(id => siteIdToLegacy.get(id) || String(id));
      sessionStorage.setItem(key, JSON.stringify(session));
    }
    const profileIdToLegacy = new Map(profiles.map(row => [row.id, String(row.legacy_id || "")]));
    const emailByProfileId = new Map(accountAccess.map(row => [row.profile_id, String(row.email || "")]));
    const assignmentSitesByUser = new Map();
    assignments.forEach(row => {
      const siteLegacyId = siteIdToLegacy.get(row.site_id);
      if (!siteLegacyId) return;
      const list = assignmentSitesByUser.get(row.user_id) || [];
      list.push(siteLegacyId);
      assignmentSitesByUser.set(row.user_id, list);
    });
    const siteRowsForLocal = hydrateSites(sites, brands, equipment, parseLocal("smartfit.admin.sites.v1", []));
    const brandLegacyIdByUuid = new Map(brands.map(row => [row.id, String(row.legacy_id || row.id)]));
    const equipmentCountByBrand = new Map();
    equipment.forEach(row => {
      const brandId = brandLegacyIdByUuid.get(row.brand_id) || String(row.metadata?.legacyBrandId || "");
      if (brandId) equipmentCountByBrand.set(brandId, (equipmentCountByBrand.get(brandId) || 0) + 1);
    });
    const brandRowsForLocal = mergeById(parseLocal("smartfit.admin.brands.v1", []), brands.map(row => {
      const id = String(row.legacy_id || row.id);
      return {
        id, name: row.name, active: row.active !== false,
        equipmentCount: equipmentCountByBrand.get(id) || 0
      };
    }));
    const hydratedTickets = hydrateTickets(tickets, siteIdToLegacy, profileIdToLegacy);
    const localUsers = parseLocal("smartfit.admin.users.v1", []);
    const hydratedUsers = profiles.filter(row => row.legacy_id).map(row => ({
      id: String(row.legacy_id), authId: row.id, name: row.full_name, username: row.username,
      email: emailByProfileId.get(row.id) || "", role: row.role, active: row.active !== false,
      passwordChangeRequired: row.password_change_required === true,
      siteIds: assignmentSitesByUser.get(row.id) || [], updatedAt: row.updated_at || "", password: ""
    }));
    const mergedUsers = mergeById(localUsers, hydratedUsers);
    mergedUsers.forEach(user => { if (user.authId) user.password = ""; });
    if (canReadAccountEmails) {
      const remoteAccesses = accessRows.map(row => ({
        userId: String(row.actor_id || row.entity_id || ""),
        name: String(row.details?.full_name || "Usuario"),
        username: String(row.details?.username || "—"),
        role: String(row.details?.role || "Usuario"),
        accessedAt: row.created_at
      }));
      const localAccesses = parseLocal(ACCESS_HISTORY_KEY, []);
      const mergedAccesses = [...remoteAccesses, ...(Array.isArray(localAccesses) ? localAccesses : [])]
        .filter(entry => entry?.accessedAt)
        .sort((a, b) => String(b.accessedAt).localeCompare(String(a.accessedAt)));
      setLocal(ACCESS_HISTORY_KEY, mergedAccesses.slice(0, 500));
    }
    const ticketUuidToLegacy = new Map(tickets.map(row => [row.id, String(row.legacy_id || "")]));
    const hydratedRecords = hydrateRecords(events, mileageRows, eventLinks, ticketUuidToLegacy, siteIdToLegacy, profileIdToLegacy);
    const localTickets = parseLocal(TICKETS_KEY, []);
    const mergedTickets = mergeById(localTickets, hydratedTickets);
    const localRecords = parseLocal(RECORDS_KEY, {});
    const mergedRecords = Object.assign({}, localRecords && typeof localRecords === "object" ? localRecords : {});
    Object.entries(hydratedRecords).forEach(([recordKey, remoteRecord]) => {
      const localRecord = mergedRecords[recordKey] || { maintenance: [], mileage: [] };
      mergedRecords[recordKey] = {
        maintenance: mergeById(localRecord.maintenance, remoteRecord.maintenance),
        mileage: mergeById(localRecord.mileage, remoteRecord.mileage)
      };
    });
    setLocal("smartfit.admin.sites.v1", siteRowsForLocal);
    setLocal("smartfit.admin.brands.v1", brandRowsForLocal);
    setLocal(TICKETS_KEY, mergedTickets);
    setLocal(RECORDS_KEY, mergedRecords);
    setLocal("smartfit.admin.users.v1", mergedUsers);
    await flushPending();
    return { sites: sites.length, brands: brands.length, equipment: equipment.length, tickets: tickets.length, events: events.length, mileage: mileageRows.length };
  }

  function parseLocalSession(key) {
    try { return JSON.parse(sessionStorage.getItem(key) || "null"); } catch (error) { return null; }
  }

  global.SmartFitSupabaseData = { hydrate, manageUser, persistSite, persistBrand, deleteBrand, deleteSite, recordAccess, startRealtimeSync, persistTicket: persistTicketQueued, persistMachineRecord };
})(window);
