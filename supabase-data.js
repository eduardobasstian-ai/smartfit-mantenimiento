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
  let realtimeLibraryPromise = null;
  let hydrateInFlight = null;
  let hydrationSnapshot = null;
  let queuedHydrationTables = new Set();
  let pendingRealtimeTables = new Set();
  let pendingFlushInFlight = null;
  let refreshWhenVisible = false;
  let recordMediaDbPromise = null;
  const recordMediaCache = new Map();
  const ticketMediaCache = new Map();

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
  function recordMediaKey(recordKey, kind, entryId) {
    return `${recordKey}::${kind}::${entryId}`;
  }
  function openRecordMediaDb() {
    if (!global.indexedDB) return Promise.reject(new Error("IndexedDB no está disponible en este navegador."));
    if (!recordMediaDbPromise) {
      recordMediaDbPromise = new Promise((resolve, reject) => {
        const request = global.indexedDB.open("smartfit-record-media", 1);
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains("images")) request.result.createObjectStore("images");
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error("No se pudo abrir el almacenamiento de fotografías."));
        request.onblocked = () => reject(new Error("El almacenamiento de fotografías está ocupado."));
      }).catch(error => { recordMediaDbPromise = null; throw error; });
    }
    return recordMediaDbPromise;
  }
  async function putRecordMedia(recordKey, record) {
    const writes = [];
    for (const kind of ["maintenance", "mileage"]) {
      for (const entry of Array.isArray(record?.[kind]) ? record[kind] : []) {
        if (!entry?.id || !Array.isArray(entry.images)) continue;
        const key = recordMediaKey(recordKey, kind, entry.id);
        const images = entry.images.slice(0, 4);
        recordMediaCache.set(key, images);
        writes.push([key, images]);
      }
    }
    if (!writes.length) return;
    const database = await openRecordMediaDb();
    await new Promise((resolve, reject) => {
      const transaction = database.transaction("images", "readwrite");
      const store = transaction.objectStore("images");
      writes.forEach(([key, images]) => store.put(images, key));
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error("No se pudieron conservar las fotografías."));
      transaction.onabort = () => reject(transaction.error || new Error("Se canceló el guardado de las fotografías."));
    });
  }
  async function putTicketMedia(tickets) {
    const writes = [];
    (Array.isArray(tickets) ? tickets : []).forEach(ticket => {
      if (!ticket?.id || !Array.isArray(ticket.images)) return;
      const key = `ticket::${ticket.id}`;
      const images = ticket.images.slice(0, 4);
      ticketMediaCache.set(key, images);
      writes.push([key, images]);
    });
    if (!writes.length) return;
    const database = await openRecordMediaDb();
    await new Promise((resolve, reject) => {
      const transaction = database.transaction("images", "readwrite");
      const store = transaction.objectStore("images");
      writes.forEach(([key, images]) => store.put(images, key));
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error("No se pudieron conservar las fotos de los tickets."));
      transaction.onabort = () => reject(transaction.error || new Error("Se canceló el guardado de las fotos de los tickets."));
    });
  }
  function stripTicketMedia(tickets) {
    return (Array.isArray(tickets) ? tickets : []).map(ticket =>
      Array.isArray(ticket?.images) ? Object.assign({}, ticket, { images: [] }) : ticket
    );
  }
  function getTicketsWithCachedMediaSync(tickets) {
    return (Array.isArray(tickets) ? tickets : []).map(ticket => {
      const images = ticketMediaCache.get(`ticket::${ticket?.id}`);
      return images ? Object.assign({}, ticket, { images }) : ticket;
    });
  }
  async function restoreTicketMedia(tickets) {
    const restored = [];
    for (const ticket of Array.isArray(tickets) ? tickets : []) {
      const key = `ticket::${ticket?.id}`;
      let images = Array.isArray(ticket?.images) ? ticket.images : null;
      if (images?.length) {
        ticketMediaCache.set(key, images);
        try { await putTicketMedia([ticket]); } catch (error) { /* La copia en Supabase sigue siendo la fuente remota. */ }
      } else {
        images = ticketMediaCache.get(key);
        if (!images) {
          try {
            const database = await openRecordMediaDb();
            images = await new Promise((resolve, reject) => {
              const request = database.transaction("images", "readonly").objectStore("images").get(key);
              request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result : null);
              request.onerror = () => reject(request.error);
            });
            if (images) ticketMediaCache.set(key, images);
          } catch (error) { /* El ticket puede reintentarse sin fotos si el almacenamiento no está disponible. */ }
        }
      }
      restored.push(images ? Object.assign({}, ticket, { images }) : ticket);
    }
    return restored;
  }
  async function prepareTicketStorage() {
    const tickets = parseLocal(TICKETS_KEY, []);
    if (!Array.isArray(tickets) || !tickets.some(ticket => Array.isArray(ticket?.images) && ticket.images.length)) return false;
    try {
      await putTicketMedia(tickets);
      localStorage.setItem(TICKETS_KEY, JSON.stringify(stripTicketMedia(tickets)));
      return true;
    } catch (error) {
      console.warn("No se pudieron trasladar las fotos antiguas de tickets; se mantiene la copia actual.", error);
      return false;
    }
  }
  async function writeTicketCache(tickets) {
    await prepareTicketStorage();
    await putTicketMedia(tickets);
    const activeKeys = new Set((Array.isArray(tickets) ? tickets : []).filter(ticket => ticket?.id).map(ticket => `ticket::${ticket.id}`));
    try {
      const database = await openRecordMediaDb();
      await new Promise((resolve, reject) => {
        const transaction = database.transaction("images", "readwrite");
        const store = transaction.objectStore("images");
        const request = store.getAllKeys();
        request.onsuccess = () => request.result.forEach(key => {
          if (String(key).startsWith("ticket::") && !activeKeys.has(String(key))) {
            store.delete(key);
            ticketMediaCache.delete(String(key));
          }
        });
        request.onerror = () => reject(request.error || new Error("No se pudieron depurar fotos de tickets eliminados."));
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error || new Error("No se pudieron depurar fotos de tickets eliminados."));
        transaction.onabort = () => reject(transaction.error || new Error("Se canceló la depuración de fotos de tickets."));
      });
    } catch (error) { console.warn("No se pudieron depurar fotos de tickets eliminados.", error); }
    localStorage.setItem(TICKETS_KEY, JSON.stringify(stripTicketMedia(tickets)));
  }
  function stripRecordMedia(record) {
    const compact = { maintenance: [], mileage: [] };
    for (const kind of ["maintenance", "mileage"]) {
      compact[kind] = (Array.isArray(record?.[kind]) ? record[kind] : []).map(entry =>
        Array.isArray(entry?.images) ? Object.assign({}, entry, { images: [] }) : entry
      );
    }
    return compact;
  }
  function stripRecordsMedia(records) {
    const compact = {};
    Object.entries(records && typeof records === "object" ? records : {}).forEach(([key, record]) => {
      compact[key] = stripRecordMedia(record);
    });
    return compact;
  }
  function getMachineRecordWithCachedMediaSync(recordKey, record) {
    const hydrated = stripRecordMedia(record);
    for (const kind of ["maintenance", "mileage"]) {
      hydrated[kind] = hydrated[kind].map(entry => {
        const key = recordMediaKey(recordKey, kind, entry.id);
        const images = recordMediaCache.get(key);
        return images ? Object.assign({}, entry, { images }) : entry;
      });
    }
    return hydrated;
  }
  async function prepareMachineRecordStorage() {
    const records = parseLocal(RECORDS_KEY, {});
    let changed = false;
    for (const [recordKey, record] of Object.entries(records && typeof records === "object" ? records : {})) {
      const hasImages = ["maintenance", "mileage"].some(kind =>
        (Array.isArray(record?.[kind]) ? record[kind] : []).some(entry => Array.isArray(entry?.images) && entry.images.length)
      );
      if (!hasImages) continue;
      try {
        await putRecordMedia(recordKey, record);
        records[recordKey] = stripRecordMedia(record);
        changed = true;
      } catch (error) {
        console.warn("No se pudo mover las fotografías al almacenamiento local ampliado; se conserva la copia actual.", error);
      }
    }
    if (changed) {
      try { localStorage.setItem(RECORDS_KEY, JSON.stringify(records)); }
      catch (error) { console.warn("No se pudo compactar el almacenamiento local de registros.", error); }
    }
    return changed;
  }
  async function writeMachineRecordCache(recordKey, record) {
    await prepareMachineRecordStorage();
    await putRecordMedia(recordKey, record);
    const activeMediaKeys = new Set();
    for (const kind of ["maintenance", "mileage"]) {
      for (const entry of Array.isArray(record?.[kind]) ? record[kind] : []) {
        if (entry?.id) activeMediaKeys.add(recordMediaKey(recordKey, kind, entry.id));
      }
    }
    try {
      const database = await openRecordMediaDb();
      await new Promise((resolve, reject) => {
        const transaction = database.transaction("images", "readwrite");
        const store = transaction.objectStore("images");
        const request = store.getAllKeys();
        request.onsuccess = () => request.result.forEach(key => {
          if (String(key).startsWith(`${recordKey}::`) && !activeMediaKeys.has(String(key))) {
            store.delete(key);
            recordMediaCache.delete(String(key));
          }
        });
        request.onerror = () => reject(request.error || new Error("No se pudieron depurar fotos antiguas."));
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error || new Error("No se pudieron depurar fotos antiguas."));
        transaction.onabort = () => reject(transaction.error || new Error("Se canceló la depuración de fotos antiguas."));
      });
    } catch (error) { console.warn("No se pudieron depurar las fotografías eliminadas del registro.", error); }
    const records = parseLocal(RECORDS_KEY, {});
    records[recordKey] = stripRecordMedia(record);
    localStorage.setItem(RECORDS_KEY, JSON.stringify(records));
  }
  async function restoreRecordMedia(recordKey, record) {
    const restored = { maintenance: [], mileage: [] };
    for (const kind of ["maintenance", "mileage"]) {
      for (const entry of Array.isArray(record?.[kind]) ? record[kind] : []) {
        let images = Array.isArray(entry?.images) ? entry.images : null;
        const key = recordMediaKey(recordKey, kind, entry?.id);
        if (images?.length) {
          recordMediaCache.set(key, images);
          try { await putRecordMedia(recordKey, { [kind]: [entry] }); } catch (error) { /* Supabase is still the durable copy. */ }
        } else {
          images = recordMediaCache.get(key);
          if (!images) {
            try {
              const database = await openRecordMediaDb();
              images = await new Promise((resolve, reject) => {
                const request = database.transaction("images", "readonly").objectStore("images").get(key);
                request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result : null);
                request.onerror = () => reject(request.error);
              });
              if (images) recordMediaCache.set(key, images);
            } catch (error) { /* La entrada se puede sincronizar sin fotografías locales. */ }
          }
        }
        restored[kind].push(images ? Object.assign({}, entry, { images }) : entry);
      }
    }
    return restored;
  }
  // Mantiene el tamaño por debajo del límite máximo de filas que puede fijar
  // Supabase REST; así la paginación no confunde una página truncada con el final.
  async function queryRows(path, pageSize = 1000) {
    const token = auth()?.access_token;
    if (!token) return [];
    const rows = [];
    const limit = Math.max(1, Math.min(1000, Number(pageSize) || 250));
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
  async function getRows(table, select = "*", pageSize = 1000) {
    try {
      return await queryRows(`${table}?select=${encodeURIComponent(select)}`, pageSize);
    } catch (error) {
      throw new Error(`No se pudo cargar la tabla ${table}. ${error.message || "Revisa la conexión con Supabase."}`);
    }
  }
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
        let brandId = brandIdByLegacy.get(brandLegacyId) || brandIdByName.get(cleanName(group.brandName)) || null;
        if (!brandId && brandLegacyId && group.brandName && global.BRAND_EQUIPMENT_CATALOGS?.[brandLegacyId]) {
          const createdBrand = await persistBrand({ id: brandLegacyId, name: group.brandName, active: true });
          brandId = createdBrand?.id || null;
          if (brandId) {
            brandIdByLegacy.set(brandLegacyId, brandId);
            brandIdByName.set(cleanName(group.brandName), brandId);
          }
        }
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
  function loadRealtimeLibrary() {
    if (global.supabase?.createClient) return Promise.resolve(global.supabase);
    if (realtimeLibraryPromise) return realtimeLibraryPromise;
    realtimeLibraryPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
      script.async = true;
      script.onload = () => global.supabase?.createClient
        ? resolve(global.supabase)
        : reject(new Error("El cliente de Supabase no quedó disponible."));
      script.onerror = () => reject(new Error("No se pudo cargar el cliente de sincronización en tiempo real."));
      document.head.appendChild(script);
    }).catch(error => {
      realtimeLibraryPromise = null;
      throw error;
    });
    return realtimeLibraryPromise;
  }
  async function startRealtimeSync() {
    if (realtimeChannel) return true;
    if (!auth()?.access_token) return false;
    try {
      await loadRealtimeLibrary();
    } catch (error) {
      console.warn("La carga de datos terminó, pero no se pudo iniciar la sincronización en vivo.", error);
      return false;
    }
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
    const scheduleRefresh = payload => {
      const changedTable = String(payload?.payload?.table || "");
      if (!changedTable || changedTable === "part_requests") return;
      if (["admin_user_access", "audit_log"].includes(changedTable) && appSession()?.role !== "Administrador") return;
      pendingRealtimeTables.add(changedTable);
      if (document.hidden) {
        refreshWhenVisible = true;
        return;
      }
      clearTimeout(realtimeRefreshTimer);
      realtimeRefreshTimer = setTimeout(async () => {
        try {
          const tables = [...pendingRealtimeTables];
          pendingRealtimeTables.clear();
          const result = await hydrate({ tables });
          if (!result.skipped) global.dispatchEvent(new Event("smartfit:supabase-data-hydrated"));
        } catch (error) {
          console.warn("No se pudieron actualizar los datos en tiempo real.", error);
        }
      }, 500);
    };
    // El mensaje de Broadcast solo anuncia que hubo un cambio; los datos siempre
    // se vuelven a consultar por REST, donde Supabase aplica RLS por perfil.
    realtimeChannel.on("broadcast", { event: "smartfit-change" }, scheduleRefresh);
    realtimeChannel.subscribe((status, error) => {
      // La carga inicial ya terminó antes de conectarse al canal. Evita repetir
      // de inmediato la descarga completa de tablas al abrir cada panel.
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        console.warn("La sincronización en tiempo real no pudo conectarse.", error || status);
      }
    });
    if (!global.__smartfitRealtimeVisibilityBound) {
      global.__smartfitRealtimeVisibilityBound = true;
      document.addEventListener("visibilitychange", () => {
        if (document.hidden || !refreshWhenVisible) return;
        refreshWhenVisible = false;
        pendingRealtimeTables.forEach(table => scheduleRefresh({ payload: { table } }));
      });
    }
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
    const existing = await lookupOne("tickets", "id,created_by,technician_id,technician_name,metadata", "legacy_id", ticket.id);
    const site = AdminStore.listSites().find(row => String(row.id) === String(ticket.siteId));
    const equipmentId = ticket.machineRecordKey ? await equipmentForRecordKey(ticket.machineRecordKey) : null;
    const creatorId = existing?.created_by || await profileIdForLegacy(ticket.createdById || ticket.leaderId, actor) || actor.authId;
    const supervisorId = await profileIdForLegacy(ticket.supervisorId || site?.supervisorUserId, actor);
    // Los guardados de estado o datos del ticket no deben revertir una reasignación
    // que ya hizo el supervisor o el administrador en otra sesión.
    const technicianId = existing?.technician_id || await profileIdForLegacy(ticket.technicianId || site?.technicianUserId, actor);
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
      technician_id: technicianId, technician_name: existing?.technician_name || String(ticket.technician || site?.technician || "") || null,
      leader_id: leaderId, leader_name: String(ticket.leaderName || "") || null,
      created_by: creatorId, created_by_name: String(ticket.createdByName || ticket.leaderName || ticket.supervisor || actor.name || "") || null,
      updated_by: actor.authId, machine_record_key: ticket.machineRecordKey || null, ticket_date: ticketDate,
      photos, metadata: Object.assign({}, existing?.metadata || {}, cleanMetadata(ticket, "images"), {
        ...(existing?.metadata?.technicianAssignment ? { technicianAssignment: existing.metadata.technicianAssignment } : {})
      }),
      created_at: ticket.createdAt || new Date().toISOString(), updated_at: new Date().toISOString()
    });
  }
  async function assignTicketTechnician(ticketId, technicianId) {
    if (!String(ticketId || "").trim() || !String(technicianId || "").trim()) {
      throw new Error("Selecciona el ticket y el técnico que se asignará.");
    }
    const response = await authorizedFetch(`${URL}/rest/v1/rpc/assign_ticket_technician`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ p_ticket_legacy_id: String(ticketId), p_technician_legacy_id: String(technicianId) })
    });
    const text = await response.text();
    if (!response.ok) {
      let message = text;
      try { const data = JSON.parse(text); message = data.message || data.details || data.error || text; } catch (error) {}
      throw new Error(`No se pudo asignar el técnico (${response.status}): ${message}`);
    }
    return text ? JSON.parse(text) : {};
  }
  async function listAssignableTicketTechnicians(ticketId) {
    if (!String(ticketId || "").trim()) throw new Error("No se identificó el ticket.");
    const response = await authorizedFetch(`${URL}/rest/v1/rpc/list_assignable_ticket_technicians`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ p_ticket_legacy_id: String(ticketId) })
    });
    const text = await response.text();
    if (!response.ok) {
      let message = text;
      try { const data = JSON.parse(text); message = data.message || data.details || data.error || text; } catch (error) {}
      throw new Error(`No se pudo cargar la nómina de técnicos (${response.status}): ${message}`);
    }
    const rows = text ? JSON.parse(text) : [];
    return Array.isArray(rows) ? rows : [];
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
    after = await restoreRecordMedia(recordKey, after);
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
      await putTicketMedia([ticket]);
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
  async function flushPendingNow() {
    const pending = readPending();
    const localTickets = parseLocal(TICKETS_KEY, []);
    const ticketsWithPhotos = await restoreTicketMedia(localTickets);
    for (const id of pending.tickets || []) {
      const ticket = ticketsWithPhotos.find(row => String(row.id) === String(id));
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
  function flushPending() {
    if (!pendingFlushInFlight) {
      pendingFlushInFlight = flushPendingNow().finally(() => { pendingFlushInFlight = null; });
    }
    return pendingFlushInFlight;
  }
  if (!global.__smartfitPendingOnlineBound) {
    global.__smartfitPendingOnlineBound = true;
    global.addEventListener("online", () => {
      if (!auth()?.access_token) return;
      flushPending().catch(error => console.warn("No se pudieron sincronizar los cambios al recuperar la conexión.", error));
    });
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

  function hydrateTickets(rows, siteIdToLegacy, profileIdToLegacy, siteNameByLegacy) {
    return rows.map(row => {
      const original = row.metadata && typeof row.metadata === "object" ? row.metadata : {};
      const siteLegacyId = siteIdToLegacy.get(row.site_id) || original.siteId || "";
      return Object.assign({}, original, {
        id: row.legacy_id || original.id,
        ticketNumber: row.ticket_number || original.ticketNumber,
        type: row.ticket_type || original.type,
        siteId: siteLegacyId,
        siteName: original.siteName || siteNameByLegacy.get(String(siteLegacyId)) || "",
        activeFixed: row.fixed_asset ?? original.activeFixed ?? "N/A",
        status: row.status || original.status || "Pendiente",
        date: row.ticket_date || original.date || dateOnly(row.created_at),
        supervisorId: profileIdToLegacy.get(row.supervisor_id) || original.supervisorId || "",
        supervisor: row.supervisor_name || original.supervisor || "",
        technicianId: profileIdToLegacy.get(row.technician_id) || original.technicianId || "",
        technician: row.technician_name || original.technician || "",
        technicianAssignment: original.technicianAssignment || null,
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
    const ticketIdsByEvent = new Map();
    ticketLinks.forEach(link => {
      const ticketId = ticketUuidToLegacy.get(link.ticket_id);
      if (!ticketId) return;
      const ids = ticketIdsByEvent.get(link.event_id) || [];
      ids.push(ticketId);
      ticketIdsByEvent.set(link.event_id, ids);
    });
    events.forEach(row => {
      const recordKey = row.source_record_key || `${siteIdToLegacy.get(row.site_id) || ""}::`;
      if (!recordKey) return;
      const record = records[recordKey] || { maintenance: [], mileage: [] };
      const original = row.metadata && typeof row.metadata === "object" ? row.metadata : {};
      const ticketIds = ticketIdsByEvent.get(row.id) || [];
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

  async function hydrateNow(refreshTables = null) {
    if (!auth()?.access_token) return { skipped: true };
    await prepareMachineRecordStorage();
    await prepareTicketStorage();
    const canReadAccountEmails = appSession()?.role === "Administrador";
    const loaders = {
      sites: () => getRows("sites", "id,legacy_id,name,region,internal_code,active"),
      brands: () => getRows("brands", "id,legacy_id,name,active"),
      equipment: () => getRows("equipment", "id,legacy_id,site_id,brand_id,fixed_asset,name,model,category,image_url,active,metadata"),
      // Las columnas photos pueden contener varias imágenes en base64 por fila.
      // Cargarlas en lotes pequeños evita que Postgres cancele la consulta por timeout.
      tickets: () => getRows("tickets", "id,legacy_id,ticket_number,ticket_type,site_id,equipment_id,fixed_asset,title,description,status,supervisor_id,supervisor_name,technician_id,technician_name,leader_id,leader_name,created_by,created_by_name,updated_by,machine_record_key,ticket_date,photos,metadata,created_at,updated_at", 20),
      maintenance_events: () => getRows("maintenance_events", "id,legacy_id,source_record_key,site_id,equipment_id,equipment_name,equipment_model,fixed_asset,event_type,status,details,ticket_id,technician_id,technician_name,supervisor_id,supervisor_name,registered_by,registered_by_name,photos,occurred_at,created_at,metadata", 8),
      mileage_records: () => getRows("mileage_records", "id,legacy_id,source_record_key,site_id,equipment_id,equipment_name,equipment_model,fixed_asset,mileage_km,entry_date,technician_id,technician_name,supervisor_id,supervisor_name,registered_by,registered_by_name,notes,lubrication,photos,recorded_at,metadata", 50),
      maintenance_event_tickets: () => getRows("maintenance_event_tickets", "event_id,ticket_id"),
      profiles: () => getRows("profiles", "id,legacy_id,full_name,username,role,active,password_change_required,updated_at"),
      site_assignments: () => getRows("site_assignments", "site_id,user_id,assignment_role"),
      admin_user_access: () => getRows("admin_user_access", "profile_id,email").catch(error => {
        console.warn("No se pudo consultar el directorio de correos de administración; se continúa cargando el panel.", error);
        return [];
      }),
      audit_log: () => queryRows("audit_log?select=id,actor_id,action,entity_id,details,created_at&action=eq.login_success&order=created_at.desc", 15)
    };
    const refreshableTables = Object.keys(loaders).filter(table => canReadAccountEmails || !["admin_user_access", "audit_log"].includes(table));
    const useSnapshot = hydrationSnapshot && Array.isArray(refreshTables);
    const requestedTables = useSnapshot
      ? [...new Set(refreshTables)].filter(table => refreshableTables.includes(table))
      : refreshableTables;
    const loadedValues = await Promise.all(requestedTables.map(table => loaders[table]()));
    const nextSnapshot = useSnapshot ? Object.assign({}, hydrationSnapshot) : {};
    requestedTables.forEach((table, index) => { nextSnapshot[table] = loadedValues[index]; });
    if (!canReadAccountEmails) {
      nextSnapshot.admin_user_access = [];
      nextSnapshot.audit_log = [];
    }
    hydrationSnapshot = nextSnapshot;
    if (!requestedTables.length) return { skipped: true };
    const { sites, brands, equipment, tickets, maintenance_events: events, mileage_records: mileageRows,
      maintenance_event_tickets: eventLinks, profiles, site_assignments: assignments,
      admin_user_access: accountAccess, audit_log: accessRows } = hydrationSnapshot;
    const changed = new Set(requestedTables);
    const fullHydration = !useSnapshot;
    const refreshSites = fullHydration || ["sites", "brands", "equipment"].some(table => changed.has(table));
    const refreshTickets = fullHydration || ["tickets", "sites", "profiles"].some(table => changed.has(table));
    const refreshRecords = fullHydration || ["maintenance_events", "mileage_records", "maintenance_event_tickets", "tickets", "sites", "profiles"].some(table => changed.has(table));
    const refreshUsers = fullHydration || ["profiles", "site_assignments", "sites", "tickets", "admin_user_access"].some(table => changed.has(table));
    const refreshAccessHistory = fullHydration || changed.has("audit_log");
    const siteIdToLegacy = new Map(sites.map(row => [row.id, String(row.legacy_id || "")]));
    // La función de login devuelve asignaciones como UUID de Supabase; las vistas locales
    // trabajan con legacy_id. Traducirlas aquí conserva el alcance por sede del supervisor.
    if (refreshUsers) {
      for (const key of ["smartfit.site.session", "smartfit.leader.session", "smartfit.admin.session"]) {
        const session = parseLocalSession(key);
        if (!session?.siteIds) continue;
        session.siteIds = session.siteIds.map(id => siteIdToLegacy.get(id) || String(id));
        sessionStorage.setItem(key, JSON.stringify(session));
      }
    }
    const profileIdToLegacy = new Map(refreshTickets || refreshRecords || refreshUsers
      ? profiles.map(row => [row.id, String(row.legacy_id || "")])
      : []);
    const emailByProfileId = new Map(refreshUsers ? accountAccess.map(row => [row.profile_id, String(row.email || "")]) : []);
    const assignmentSitesByUser = new Map();
    if (refreshUsers) assignments.forEach(row => {
      const siteLegacyId = siteIdToLegacy.get(row.site_id);
      if (!siteLegacyId) return;
      const list = assignmentSitesByUser.get(row.user_id) || [];
      list.push(siteLegacyId);
      assignmentSitesByUser.set(row.user_id, list);
    });
    // El acceso temporal derivado de tickets se agrega solo al usuario de esta
    // sesión; nunca se mezcla con las asignaciones permanentes de los perfiles.
    const temporaryTicketSitesByUser = new Map();
    if (refreshUsers) {
      const activeTicketStatuses = new Set(["Pendiente", "En ejecución", "Ejecutado"]);
      tickets.forEach(ticket => {
        if (!ticket.technician_id || !ticket.site_id || !activeTicketStatuses.has(ticket.status)) return;
        const siteLegacyId = siteIdToLegacy.get(ticket.site_id);
        if (!siteLegacyId) return;
        const list = temporaryTicketSitesByUser.get(ticket.technician_id) || [];
        if (!list.includes(siteLegacyId)) list.push(siteLegacyId);
        temporaryTicketSitesByUser.set(ticket.technician_id, list);
      });
    }
    const currentAuthUserId = appSession()?.authId || "";
    if (refreshUsers && currentAuthUserId) {
      for (const key of ["smartfit.site.session", "smartfit.leader.session", "smartfit.admin.session"]) {
        const session = parseLocalSession(key);
        if (session?.authId !== currentAuthUserId || session.role !== "Técnico") continue;
        const permanentSiteIds = [...(assignmentSitesByUser.get(currentAuthUserId) || [])];
        const temporaryTicketSiteIds = [...(temporaryTicketSitesByUser.get(currentAuthUserId) || [])];
        const siteIds = [...permanentSiteIds];
        temporaryTicketSiteIds.forEach(siteId => {
          if (!siteIds.includes(siteId)) siteIds.push(siteId);
        });
        session.siteIds = siteIds;
        session.permanentSiteIds = permanentSiteIds;
        session.temporaryTicketSiteIds = temporaryTicketSiteIds;
        sessionStorage.setItem(key, JSON.stringify(session));
      }
    }
    const siteRowsForLocal = refreshSites
      ? hydrateSites(sites, brands, equipment, parseLocal("smartfit.admin.sites.v1", []))
      : null;
    const brandLegacyIdByUuid = new Map(refreshSites ? brands.map(row => [row.id, String(row.legacy_id || row.id)]) : []);
    const equipmentCountByBrand = new Map();
    if (refreshSites) equipment.forEach(row => {
      const brandId = brandLegacyIdByUuid.get(row.brand_id) || String(row.metadata?.legacyBrandId || "");
      if (brandId) equipmentCountByBrand.set(brandId, (equipmentCountByBrand.get(brandId) || 0) + 1);
    });
    const storedBrands = refreshSites ? parseLocal("smartfit.admin.brands.v1", []) : [];
    const knownBrandNames = new Set([...storedBrands, ...(refreshSites ? brands : [])].map(row => cleanName(row.name)).filter(Boolean));
    const catalogBrands = refreshSites ? Object.entries(global.BRAND_EQUIPMENT_CATALOGS || {}).map(([id, items]) => ({
      id,
      name: items.find(item => item.brandName)?.brandName || id.replace(/^brand-/, "").replace(/[-_]+/g, " ").replace(/(^|\s)\S/g, letter => letter.toLocaleUpperCase("es")),
      active: true,
      equipmentCount: equipmentCountByBrand.get(id) || 0
    })).filter(brand => !knownBrandNames.has(cleanName(brand.name))) : null;
    const brandRowsForLocal = refreshSites ? mergeById(mergeById(storedBrands, catalogBrands), brands.map(row => {
      const id = String(row.legacy_id || row.id);
      return {
        id, name: row.name, active: row.active !== false,
        equipmentCount: equipmentCountByBrand.get(id) || 0
      };
    })) : null;
    const siteNameByLegacy = new Map(refreshTickets ? sites.map(row => [String(row.legacy_id || ""), String(row.name || "")]) : []);
    const hydratedTickets = refreshTickets ? hydrateTickets(tickets, siteIdToLegacy, profileIdToLegacy, siteNameByLegacy) : null;
    const localUsers = refreshUsers ? parseLocal("smartfit.admin.users.v1", []) : [];
    const hydratedUsers = refreshUsers ? profiles.filter(row => row.legacy_id).map(row => {
      const permanentSiteIds = [...(assignmentSitesByUser.get(row.id) || [])];
      const siteIds = [...permanentSiteIds];
      let temporaryTicketSiteIds = [];
      if (row.id === currentAuthUserId) {
        temporaryTicketSiteIds = [...(temporaryTicketSitesByUser.get(row.id) || [])];
        temporaryTicketSiteIds.forEach(siteId => {
          if (!siteIds.includes(siteId)) siteIds.push(siteId);
        });
      }
      return {
        id: String(row.legacy_id), authId: row.id, name: row.full_name, username: row.username,
        email: emailByProfileId.get(row.id) || "", role: row.role, active: row.active !== false,
        passwordChangeRequired: row.password_change_required === true,
        siteIds, permanentSiteIds, temporaryTicketSiteIds,
        updatedAt: row.updated_at || "", password: ""
      };
    }) : null;
    const mergedUsers = refreshUsers ? mergeById(localUsers, hydratedUsers) : null;
    mergedUsers?.forEach(user => { if (user.authId) user.password = ""; });
    if (canReadAccountEmails && refreshAccessHistory) {
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
    if (refreshTickets) {
      const localTickets = parseLocal(TICKETS_KEY, []);
      const mergedTickets = mergeById(localTickets, hydratedTickets);
      await putTicketMedia(mergedTickets);
      await writeTicketCache(mergedTickets);
    }
    if (refreshRecords) {
      const ticketUuidToLegacy = new Map(tickets.map(row => [row.id, String(row.legacy_id || "")]));
      const hydratedRecords = hydrateRecords(events, mileageRows, eventLinks, ticketUuidToLegacy, siteIdToLegacy, profileIdToLegacy);
      const localRecords = parseLocal(RECORDS_KEY, {});
      const mergedRecords = Object.assign({}, localRecords && typeof localRecords === "object" ? localRecords : {});
      const pending = readPending();
      pending.records = Object.assign({}, pending.records || {});
      const queueRecordEntry = (recordKey, kind, id) => {
        if (!id) return;
        const queued = pending.records[recordKey] || { maintenance: [], mileage: [] };
        queued[kind] = [...new Set([...(queued[kind] || []), String(id)])];
        pending.records[recordKey] = queued;
      };
      for (const [recordKey, remoteRecord] of Object.entries(hydratedRecords)) {
        const localRecord = mergedRecords[recordKey] || { maintenance: [], mileage: [] };
        // Los registros remotos pueden tener photos=[] cuando una sincronización
        // anterior subió el evento, pero no sus adjuntos. Recupera los originales
        // de IndexedDB antes de reemplazar la caché local con la respuesta remota.
        const localWithMedia = await restoreRecordMedia(recordKey, localRecord);
        const remoteWithRecoveredMedia = { maintenance: [], mileage: [] };
        for (const kind of ["maintenance", "mileage"]) {
          const localById = new Map((localWithMedia[kind] || []).map(item => [String(item.id), item]));
          const remoteItems = (remoteRecord[kind] || []).map(item => {
            const localItem = localById.get(String(item.id));
            const remoteHasImages = Array.isArray(item.images) && item.images.length > 0;
            const localHasImages = Array.isArray(localItem?.images) && localItem.images.length > 0;
            if (!remoteHasImages && localHasImages) {
              queueRecordEntry(recordKey, kind, item.id);
              return Object.assign({}, item, { images: localItem.images });
            }
            return item;
          });
          remoteWithRecoveredMedia[kind] = remoteItems;
          const remoteIds = new Set(remoteItems.map(item => String(item.id)));
          // A local entry missing remotely can be a save interrupted before its
          // Supabase call. Queue it so the next flush can restore text and photos.
          for (const localItem of localWithMedia[kind] || []) {
            if (!remoteIds.has(String(localItem.id))) queueRecordEntry(recordKey, kind, localItem.id);
          }
        }
        await putRecordMedia(recordKey, remoteWithRecoveredMedia);
        mergedRecords[recordKey] = {
          maintenance: mergeById(localWithMedia.maintenance, remoteWithRecoveredMedia.maintenance),
          mileage: mergeById(localWithMedia.mileage, remoteWithRecoveredMedia.mileage)
        };
      }
      // También reintenta copias locales de sedes que todavía no aparecen entre
      // los eventos remotos para esta cuenta.
      for (const [recordKey, localRecord] of Object.entries(mergedRecords)) {
        if (hydratedRecords[recordKey]) continue;
        const localWithMedia = await restoreRecordMedia(recordKey, localRecord);
        for (const kind of ["maintenance", "mileage"]) {
          for (const item of localWithMedia[kind] || []) queueRecordEntry(recordKey, kind, item.id);
        }
        mergedRecords[recordKey] = localWithMedia;
      }
      savePending(pending);
      setLocal(RECORDS_KEY, stripRecordsMedia(mergedRecords));
    }
    if (refreshSites) {
      setLocal("smartfit.admin.sites.v1", siteRowsForLocal);
      setLocal("smartfit.admin.brands.v1", brandRowsForLocal);
    }
    if (refreshUsers) setLocal("smartfit.admin.users.v1", mergedUsers);
    if (fullHydration) setTimeout(() => {
      flushPending().catch(error => console.warn("No se pudieron sincronizar algunos cambios pendientes.", error));
    }, 0);
    return { sites: sites.length, brands: brands.length, equipment: equipment.length, tickets: tickets.length, events: events.length, mileage: mileageRows.length };
  }

  function hydrate(options = {}) {
    if (!auth()?.access_token) return Promise.resolve({ skipped: true });
    const requestedTables = Array.isArray(options.tables) ? options.tables : null;
    if (hydrateInFlight) {
      requestedTables?.forEach(table => queuedHydrationTables.add(table));
      return hydrateInFlight;
    }
    const task = hydrateNow(requestedTables);
    hydrateInFlight = task;
    return task.finally(() => {
      hydrateInFlight = null;
      if (!queuedHydrationTables.size) return;
      const tables = [...queuedHydrationTables];
      queuedHydrationTables.clear();
      queueMicrotask(async () => {
        try {
          const result = await hydrate({ tables });
          if (!result.skipped) global.dispatchEvent(new Event("smartfit:supabase-data-hydrated"));
        } catch (error) {
          console.warn("No se pudieron aplicar todos los cambios recibidos durante la sincronización.", error);
        }
      });
    });
  }

  function parseLocalSession(key) {
    try { return JSON.parse(sessionStorage.getItem(key) || "null"); } catch (error) { return null; }
  }

  global.SmartFitSupabaseData = { hydrate, manageUser, persistSite, persistBrand, deleteBrand, deleteSite, recordAccess, startRealtimeSync, persistTicket: persistTicketQueued, assignTicketTechnician, listAssignableTicketTechnicians, persistMachineRecord, retryPending: flushPending, prepareMachineRecordStorage, writeMachineRecordCache, getMachineRecordWithCachedMediaSync, prepareTicketStorage, writeTicketCache, getTicketsWithCachedMediaSync };
})(window);
