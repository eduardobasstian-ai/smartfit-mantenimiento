(function (global) {
  "use strict";
  const URL = "https://acmcksmiqrfrxopceies.supabase.co";
  const KEY = "sb_publishable_uWaLgff_Xc03iC68QpUUuQ_QkmCLLGy";
  const TICKETS_KEY = "smartfit.leader-tickets.v1";
  const RECORDS_KEY = "smartfit.machine-records.v1";
  const PENDING_KEY = "smartfit.supabase.pending.v1";
  const PENDING_ACCESS_LOGS_KEY = "smartfit.supabase.pending-access-logs.v1";
  const ACCESS_HISTORY_KEY = "smartfit.admin.access-history.v1";
  const COMMON_KNOWLEDGE_SYNC_KEY = "smartfit.common-knowledge.changed.v1";
  const COMMON_KNOWLEDGE_BUCKET = "equipment-knowledge";
  const INSPECTION_BUCKET = "site-inspections";
  let realtimeClient = null;
  let realtimeChannel = null;
  let realtimeRefreshTimer = null;
  let realtimeLibraryPromise = null;
  let hydrateInFlight = null;
  let hydrationSnapshot = null;
  let queuedHydrationTables = new Set();
  let pendingRealtimeTables = new Set();
  let pendingFlushInFlight = null;
  let pendingAccessSyncInFlight = null;
  let refreshWhenVisible = false;
  let recordMediaDbPromise = null;
  let syncOutboxDbPromise = null;
  let persistentStoragePromise = null;
  let pendingRetryTimer = null;
  const recordMediaCache = new Map();
  const ticketMediaCache = new Map();
  const syncedRecordMediaKeys = new Set();
  const commonKnowledgePhotoUrls = new Map();

  function readPendingAccessLogs() {
    const entries = new Map();
    for (const storage of [global.localStorage, global.sessionStorage]) {
      try {
        const saved = JSON.parse(storage.getItem(PENDING_ACCESS_LOGS_KEY) || "null");
        if (Array.isArray(saved)) saved.forEach(entry => {
          if (entry?.id) entries.set(String(entry.id), entry);
        });
      } catch (error) { /* intenta el almacenamiento alternativo */ }
    }
    return [...entries.values()];
  }

  function savePendingAccessLogs(entries) {
    const value = JSON.stringify(Array.isArray(entries) ? entries.slice(-100) : []);
    const storages = [global.localStorage, global.sessionStorage];
    for (let index = 0; index < storages.length; index += 1) {
      const storage = storages[index];
      try {
        storage.setItem(PENDING_ACCESS_LOGS_KEY, value);
        try { storages[index === 0 ? 1 : 0].removeItem(PENDING_ACCESS_LOGS_KEY); } catch (error) {}
        return true;
      } catch (error) { /* el almacenamiento local puede estar lleno o bloqueado */ }
    }
    return false;
  }

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
  function openSyncOutboxDb() {
    if (!global.indexedDB) return Promise.reject(new Error("IndexedDB no está disponible en este navegador."));
    if (!syncOutboxDbPromise) {
      syncOutboxDbPromise = new Promise((resolve, reject) => {
        const request = global.indexedDB.open("smartfit-sync-outbox", 1);
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains("pending")) request.result.createObjectStore("pending");
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error("No se pudo abrir la cola de sincronización."));
        request.onblocked = () => reject(new Error("La cola de sincronización está ocupada."));
      }).catch(error => { syncOutboxDbPromise = null; throw error; });
    }
    return syncOutboxDbPromise;
  }
  async function writeOutboxItem(key, value) {
    const database = await openSyncOutboxDb();
    await new Promise((resolve, reject) => {
      const transaction = database.transaction("pending", "readwrite");
      transaction.objectStore("pending").put(value, String(key));
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error("No se pudo guardar la cola de sincronización."));
      transaction.onabort = () => reject(transaction.error || new Error("Se canceló el guardado de la cola de sincronización."));
    });
  }
  async function deleteOutboxItem(key) {
    try {
      const database = await openSyncOutboxDb();
      await new Promise((resolve, reject) => {
        const transaction = database.transaction("pending", "readwrite");
        transaction.objectStore("pending").delete(String(key));
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error || new Error("No se pudo limpiar la cola local."));
        transaction.onabort = () => reject(transaction.error || new Error("Se canceló la limpieza de la cola local."));
      });
    } catch (error) { console.warn("El registro remoto está guardado, pero no se pudo limpiar su copia local pendiente.", error); }
  }
  async function readOutboxItems() {
    try {
      const database = await openSyncOutboxDb();
      return await new Promise((resolve, reject) => {
        const request = database.transaction("pending", "readonly").objectStore("pending").getAll();
        request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result : []);
        request.onerror = () => reject(request.error || new Error("No se pudo leer la cola de sincronización."));
      });
    } catch (error) {
      console.warn("No se pudo leer la cola local de sincronización.", error);
      return [];
    }
  }
  function requestPersistentStorage() {
    if (!persistentStoragePromise) {
      persistentStoragePromise = (async () => {
        try {
          if (global.navigator?.storage?.persist) return await global.navigator.storage.persist();
        } catch (error) { console.info("El navegador no concedió almacenamiento persistente; IndexedDB seguirá funcionando normalmente."); }
        return false;
      })();
    }
    return persistentStoragePromise;
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
  function cacheTicketMedia(tickets) {
    (Array.isArray(tickets) ? tickets : []).forEach(ticket => {
      if (!ticket?.id || !Array.isArray(ticket.images)) return;
      ticketMediaCache.set(`ticket::${ticket.id}`, ticket.images.slice(0, 4));
    });
  }
  function cacheRecordMedia(recordKey, record) {
    for (const kind of ["maintenance", "mileage"]) {
      for (const entry of Array.isArray(record?.[kind]) ? record[kind] : []) {
        if (!entry?.id || !Array.isArray(entry.images)) continue;
        recordMediaCache.set(recordMediaKey(recordKey, kind, entry.id), entry.images.slice(0, 4));
      }
    }
  }
  async function deleteStoredMedia(keysOrPrefix, { prefix = false } = {}) {
    if (!prefix && !(Array.isArray(keysOrPrefix) ? keysOrPrefix : [keysOrPrefix]).filter(Boolean).length) return;
    try {
      const database = await openRecordMediaDb();
      await new Promise((resolve, reject) => {
        const transaction = database.transaction("images", "readwrite");
        const store = transaction.objectStore("images");
        const remove = keys => keys.forEach(key => store.delete(key));
        if (prefix) {
          const request = store.getAllKeys();
          request.onsuccess = () => remove(request.result.filter(key => String(key).startsWith(String(keysOrPrefix))));
          request.onerror = () => reject(request.error || new Error("No se pudieron liberar las fotografías locales."));
        } else remove(Array.isArray(keysOrPrefix) ? keysOrPrefix : [keysOrPrefix]);
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error || new Error("No se pudieron liberar las fotografías locales."));
        transaction.onabort = () => reject(transaction.error || new Error("Se canceló la liberación de fotografías locales."));
      });
    } catch (error) {
      // El guardado remoto ya está confirmado; un fallo de limpieza no debe hacer
      // aparecer como fallido el registro ni borrar la copia en memoria.
      console.warn("No se pudo liberar el espacio local de fotografías sincronizadas.", error);
    }
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
    const rows = Array.isArray(tickets) ? tickets : [];
    const imagesByKey = new Map();
    const missingKeys = new Set();
    rows.forEach(ticket => {
      if (!ticket?.id) return;
      const key = `ticket::${ticket.id}`;
      const images = Array.isArray(ticket.images) ? ticket.images : null;
      if (images?.length) {
        ticketMediaCache.set(key, images);
        imagesByKey.set(key, images);
        return;
      }
      const cached = ticketMediaCache.get(key);
      if (cached?.length) imagesByKey.set(key, cached);
      else missingKeys.add(key);
    });

    // Una sola conexión/transacción para todos los adjuntos que no estén en RAM.
    // Evita abrir una transacción IndexedDB por cada ticket en cada refresco.
    if (missingKeys.size) {
      try {
        const database = await openRecordMediaDb();
        const transaction = database.transaction("images", "readonly");
        const store = transaction.objectStore("images");
        const reads = [...missingKeys].map(key => new Promise((resolve, reject) => {
          const request = store.get(key);
          request.onsuccess = () => resolve([key, Array.isArray(request.result) ? request.result : null]);
          request.onerror = () => reject(request.error || new Error("No se pudo recuperar una fotografía local."));
        }));
        const results = await Promise.all(reads);
        results.forEach(([key, images]) => {
          if (!images?.length) return;
          ticketMediaCache.set(key, images);
          imagesByKey.set(key, images);
        });
      } catch (error) {
        // El ticket puede reintentarse sin fotos si el almacenamiento no está disponible.
      }
    }
    return rows.map(ticket => {
      const images = ticket?.id ? imagesByKey.get(`ticket::${ticket.id}`) : null;
      return images ? Object.assign({}, ticket, { images }) : ticket;
    });
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
    cacheTicketMedia(tickets);
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
  function overlayOutboxRecord(baseRecord, outboxItem, durableRecord) {
    const result = { maintenance: [], mileage: [] };
    for (const kind of ["maintenance", "mileage"]) {
      const after = Array.isArray(durableRecord?.[kind]) ? durableRecord[kind] : [];
      const afterIds = new Set(after.map(entry => String(entry.id)));
      const removedIds = new Set((outboxItem?.before?.[kind] || [])
        .map(entry => String(entry.id))
        .filter(id => !afterIds.has(id)));
      const base = Array.isArray(baseRecord?.[kind]) ? baseRecord[kind] : [];
      result[kind] = mergeById(base.filter(entry => !removedIds.has(String(entry.id))), after);
    }
    return result;
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
    const writes = [];
    for (const kind of ["maintenance", "mileage"]) {
      for (const entry of Array.isArray(record?.[kind]) ? record[kind] : []) {
        if (!entry?.id || !Array.isArray(entry.images) || !entry.images.length) continue;
        const key = recordMediaKey(recordKey, kind, entry.id);
        const previousImages = recordMediaCache.get(key);
        const changed = !previousImages || JSON.stringify(previousImages) !== JSON.stringify(entry.images);
        recordMediaCache.set(key, entry.images.slice(0, 4));
        if (!syncedRecordMediaKeys.has(key) || changed) writes.push([key, entry.images.slice(0, 4)]);
      }
    }
    if (writes.length) {
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
  async function restoreRecordMediaBatch(entries) {
    const rows = Array.isArray(entries) ? entries : [];
    const imagesByKey = new Map();
    const missingKeys = new Set();
    rows.forEach(({ recordKey, record }) => {
      for (const kind of ["maintenance", "mileage"]) {
        for (const entry of Array.isArray(record?.[kind]) ? record[kind] : []) {
          if (!entry?.id) continue;
          const key = recordMediaKey(recordKey, kind, entry.id);
          const images = Array.isArray(entry.images) ? entry.images : null;
          if (images?.length) {
            recordMediaCache.set(key, images);
            imagesByKey.set(key, images);
          } else {
            const cached = recordMediaCache.get(key);
            if (cached?.length) imagesByKey.set(key, cached);
            else missingKeys.add(key);
          }
        }
      }
    });
    if (missingKeys.size) {
      try {
        const database = await openRecordMediaDb();
        const transaction = database.transaction("images", "readonly");
        const store = transaction.objectStore("images");
        const reads = [...missingKeys].map(key => new Promise((resolve, reject) => {
          const request = store.get(key);
          request.onsuccess = () => resolve([key, Array.isArray(request.result) ? request.result : null]);
          request.onerror = () => reject(request.error || new Error("No se pudo recuperar una fotografía local."));
        }));
        (await Promise.all(reads)).forEach(([key, images]) => {
          if (!images?.length) return;
          recordMediaCache.set(key, images);
          imagesByKey.set(key, images);
        });
      } catch (error) { /* Las entradas se pueden sincronizar sin fotos locales. */ }
    }
    return rows.map(({ recordKey, record }) => {
      const restored = { maintenance: [], mileage: [] };
      for (const kind of ["maintenance", "mileage"]) {
        restored[kind] = (Array.isArray(record?.[kind]) ? record[kind] : []).map(entry => {
          const images = entry?.id ? imagesByKey.get(recordMediaKey(recordKey, kind, entry.id)) : null;
          return images ? Object.assign({}, entry, { images }) : entry;
        });
      }
      return restored;
    });
  }
  async function restoreRecordMedia(recordKey, record) {
    const [restored] = await restoreRecordMediaBatch([{ recordKey, record }]);
    return restored || { maintenance: [], mileage: [] };
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
  async function getRows(table, select = "*") { return queryRows(`${table}?select=${encodeURIComponent(select)}`); }
  function announceCommonKnowledgeChange() {
    try { localStorage.setItem(COMMON_KNOWLEDGE_SYNC_KEY, String(Date.now())); }
    catch (error) { /* El aviso en tiempo real de Supabase sigue disponible. */ }
  }
  async function listCommonKnowledgeEntries({ brandLegacyId = "", model = "" } = {}) {
    const filters = [];
    if (brandLegacyId) filters.push(`brand_legacy_id=eq.${encodeURIComponent(String(brandLegacyId))}`);
    if (model) filters.push(`model=eq.${encodeURIComponent(String(model))}`);
    const suffix = filters.length ? `&${filters.join("&")}` : "";
    return queryRows(`knowledge_entries?select=id,legacy_id,kind,brand_legacy_id,brand_name,equipment_name,model,title,description,symptoms,resolution,url,thumbnail_url,duration,photos,created_by,updated_by,created_at,updated_at&order=updated_at.desc${suffix}`);
  }
  async function saveCommonKnowledgeEntry(entry) {
    if (!entry || !entry.id || !entry.legacyId) throw new Error("El registro de contenido no tiene identificadores válidos.");
    const role = appSession()?.role;
    if (!["Administrador", "Supervisor"].includes(role)) throw new Error("Solo Administrador y Supervisor pueden gestionar este contenido.");
    const actorId = appSession()?.authId || auth()?.user?.id || null;
    const row = {
      id: entry.remoteId || entry.id,
      legacy_id: String(entry.legacyId),
      kind: entry.kind,
      brand_legacy_id: String(entry.brandId || ""),
      brand_name: String(entry.brandName || ""),
      equipment_name: String(entry.equipmentName || ""),
      model: String(entry.model || ""),
      title: String(entry.title || ""),
      description: String(entry.description || ""),
      symptoms: String(entry.symptoms || ""),
      resolution: String(entry.resolution || ""),
      url: String(entry.url || ""),
      thumbnail_url: String(entry.thumbnailUrl || ""),
      duration: String(entry.duration || ""),
      photos: Array.isArray(entry.photos) ? entry.photos.slice(0, 4) : [],
      created_by: entry.createdBy || actorId,
      updated_by: actorId,
      updated_at: new Date().toISOString()
    };
    const rows = await postRows("knowledge_entries", [row], "legacy_id", "id,legacy_id,kind,brand_legacy_id,brand_name,equipment_name,model,title,description,symptoms,resolution,url,thumbnail_url,duration,photos,created_by,updated_by,created_at,updated_at");
    const saved = rows[0];
    if (!saved?.id) throw new Error("Supabase no devolvió el registro guardado.");
    announceCommonKnowledgeChange();
    return saved;
  }
  async function deleteCommonKnowledgeEntry(legacyId, photoPaths = []) {
    const role = appSession()?.role;
    if (!["Administrador", "Supervisor"].includes(role)) throw new Error("Solo Administrador y Supervisor pueden eliminar este contenido.");
    await deleteRow("knowledge_entries", `legacy_id=eq.${encodeURIComponent(String(legacyId))}`);
    if (photoPaths.length) {
      try { await deleteCommonKnowledgeImages(photoPaths); }
      catch (error) { console.warn("El registro se eliminó, pero algunas fotos quedaron pendientes de limpieza.", error); }
    }
    announceCommonKnowledgeChange();
  }
  function createCommonKnowledgeUuid() { return global.crypto?.randomUUID?.() || "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, char => { const value = Math.random() * 16 | 0; return (char === "x" ? value : value & 3 | 8).toString(16); }); }
  function encodedStoragePath(path) { return String(path || "").split("/").map(encodeURIComponent).join("/"); }
  async function uploadCommonKnowledgeImage(entryId, blob, originalName = "fotografia", dimensions = {}) {
    if (!(blob instanceof Blob) || !blob.size) throw new Error("La fotografía seleccionada está vacía.");
    const role = appSession()?.role;
    if (!["Administrador", "Supervisor"].includes(role)) throw new Error("Solo Administrador y Supervisor pueden subir fotografías.");
    const mime = ["image/webp", "image/jpeg", "image/png"].includes(blob.type) ? blob.type : "image/jpeg";
    const extension = mime === "image/webp" ? "webp" : mime === "image/png" ? "png" : "jpg";
    const path = `${entryId}/${createCommonKnowledgeUuid()}.${extension}`;
    const response = await authorizedFetch(`${URL}/storage/v1/object/${COMMON_KNOWLEDGE_BUCKET}/${encodedStoragePath(path)}`, {
      method: "POST",
      headers: { "Content-Type": mime, "cache-control": "31536000", "x-upsert": "false" },
      body: blob
    });
    if (!response.ok) throw new Error(`No se pudo subir la fotografía (${response.status}): ${await response.text()}`);
    return { path, name: String(originalName || "fotografia").slice(0, 180), type: mime, size: blob.size, width: Number(dimensions.width) || null, height: Number(dimensions.height) || null };
  }
  async function deleteCommonKnowledgeImages(paths = []) {
    const uniquePaths = [...new Set((Array.isArray(paths) ? paths : []).map(String).filter(Boolean))];
    if (!uniquePaths.length) return;
    const response = await authorizedFetch(`${URL}/storage/v1/object/${COMMON_KNOWLEDGE_BUCKET}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prefixes: uniquePaths })
    });
    if (!response.ok) throw new Error(`No se pudieron eliminar las fotografías (${response.status}): ${await response.text()}`);
    uniquePaths.forEach(path => commonKnowledgePhotoUrls.delete(path));
  }
  async function getCommonKnowledgeImageUrls(paths = []) {
    const uniquePaths = [...new Set((Array.isArray(paths) ? paths : []).map(String).filter(Boolean))];
    const urls = {};
    await Promise.all(uniquePaths.map(async path => {
      const cached = commonKnowledgePhotoUrls.get(path);
      if (cached && cached.expiresAt > Date.now() + 60000) { urls[path] = cached.url; return; }
      const response = await authorizedFetch(`${URL}/storage/v1/object/sign/${COMMON_KNOWLEDGE_BUCKET}/${encodedStoragePath(path)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expiresIn: 3600 })
      });
      const text = await response.text();
      let result = {};
      try { result = text ? JSON.parse(text) : {}; } catch (error) {}
      if (!response.ok) throw new Error(`No se pudo abrir una fotografía (${response.status}): ${result.message || text}`);
      const signed = result.signedURL || result.signedUrl;
      if (!signed) throw new Error("Supabase no devolvió el enlace temporal de la fotografía.");
      const url = signed.startsWith("http") ? signed : `${URL}/storage/v1${signed.startsWith("/") ? "" : "/"}${signed}`;
      commonKnowledgePhotoUrls.set(path, { url, expiresAt: Date.now() + 3500000 });
      urls[path] = url;
    }));
    return urls;
  }
  function inspectionPhotoBlob(value) {
    if (value instanceof Blob) return value;
    const source = String(value || "");
    const match = source.match(/^data:(image\/(?:jpeg|png|webp));base64,([\s\S]+)$/i);
    if (!match) throw new Error("Una fotografía de la inspección no tiene un formato compatible.");
    const binary = atob(match[2]);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return new Blob([bytes], { type: match[1].toLowerCase() });
  }
  async function uploadInspectionPhoto(siteUuid, inspectionId, entryId, index, dataUrl) {
    const blob = inspectionPhotoBlob(dataUrl);
    const extension = blob.type === "image/webp" ? "webp" : blob.type === "image/png" ? "png" : "jpg";
    const safeInspectionId = String(inspectionId).replace(/[^a-z0-9-]/gi, "");
    const safeEntryId = String(entryId).replace(/[^a-z0-9-]/gi, "");
    const path = `${siteUuid}/${safeInspectionId}/${safeEntryId}-${index + 1}.${extension}`;
    const response = await authorizedFetch(`${URL}/storage/v1/object/${INSPECTION_BUCKET}/${encodedStoragePath(path)}`, {
      method: "POST",
      headers: { "Content-Type": blob.type, "cache-control": "31536000", "x-upsert": "true" },
      body: blob
    });
    if (!response.ok) throw new Error(`No se pudo subir una foto de inspección (${response.status}): ${await response.text()}`);
    return { path, type: blob.type, size: blob.size };
  }
  async function saveInspectionBatch(siteLegacyId, inspectionId, entries = []) {
    const actor = appSession();
    if (!actor?.authId || !inspectionId || !Array.isArray(entries) || !entries.length) throw new Error("La inspección no contiene equipos para enviar.");
    if (!["Administrador", "Supervisor"].includes(actor.role)) throw new Error("Solo el administrador o supervisor puede enviar inspecciones.");
    const siteUuid = await siteUuidForLegacy(siteLegacyId);
    if (!siteUuid) throw new Error("La sede de la inspección no está vinculada a Supabase.");
    const site = AdminStore.listSites().find(row => String(row.id) === String(siteLegacyId));
    const users = AdminStore.listUsers();
    const supervisor = actor.role === "Supervisor" ? users.find(row => row.authId === actor.authId) : users.find(row => row.id === site?.supervisorUserId);
    const technician = users.find(row => row.id === site?.technicianUserId && row.role === "Técnico")
      || users.find(row => row.role === "Técnico" && (row.siteIds || []).includes(String(siteLegacyId)));
    const saved = [];
    for (const entry of entries) {
      if (!entry?.id || !entry.recordKey || !String(entry.finding || "").trim()) throw new Error("Un equipo de la inspección tiene datos incompletos.");
      const equipmentId = await equipmentForRecordKey(entry.recordKey);
      if (!equipmentId) throw new Error(`No se pudo vincular ${entry.equipment || "un equipo"} con la sede en Supabase.`);
      const photos = await Promise.all((Array.isArray(entry.photos) ? entry.photos.slice(0, 4) : [])
        .map((photo, index) => uploadInspectionPhoto(siteUuid, inspectionId, entry.id, index, photo)));
      const row = {
        inspection_id: inspectionId,
        legacy_id: `${inspectionId}::${entry.id}`,
        site_id: siteUuid,
        site_legacy_id: String(siteLegacyId),
        equipment_id: equipmentId,
        equipment_legacy_id: String(entry.recordKey),
        equipment_name: String(entry.equipment || "Equipo"),
        equipment_model: String(entry.model || "") || null,
        brand_name: String(entry.brand || "") || null,
        fixed_asset: entry.activeFixed == null || String(entry.activeFixed) === "" ? null : String(entry.activeFixed),
        technician_id: technician?.authId || null,
        technician_name: technician?.name || site?.technician || null,
        supervisor_id: supervisor?.authId || (actor.role === "Supervisor" ? actor.authId : null),
        supervisor_name: supervisor?.name || (actor.role === "Supervisor" ? actor.name : site?.supervisor) || null,
        registered_by: actor.authId,
        registered_by_name: actor.name || null,
        occurred_at: String(entry.date || new Date().toISOString()).slice(0, 10),
        finding: String(entry.finding).trim(),
        observations: String(entry.observations || "").trim() || null,
        status: "Pendiente",
        photos,
        updated_at: new Date().toISOString()
      };
      const result = await postRow("inspection_records", row, "legacy_id", "id,legacy_id,status,inspection_number,inspection_counter");
      if (!result?.id) throw new Error(`Supabase no confirmó la inspección de ${entry.equipment || "un equipo"}.`);
      saved.push(result);
    }
    try { localStorage.setItem("smartfit.inspection.records.changed.v1", String(Date.now())); } catch (error) {}
    return { saved: saved.length, inspectionId, inspectionNumber: saved.find(row => row.inspection_number)?.inspection_number || null };
  }
  async function listInspectionRecords() {
    const [rows, sites] = await Promise.all([
      getRows("inspection_records", "id,inspection_id,inspection_number,inspection_counter,legacy_id,site_id,site_legacy_id,equipment_id,equipment_legacy_id,equipment_name,equipment_model,brand_name,fixed_asset,technician_id,technician_name,supervisor_id,supervisor_name,registered_by,registered_by_name,occurred_at,finding,observations,correction,corrected_by,corrected_by_name,corrected_at,status,execution_started_at,photos,deleted_at,deleted_by,deleted_by_name,created_at,updated_at"),
      getRows("sites", "id,legacy_id,name,internal_code")
    ]);
    const siteNames = new Map(sites.map(site => [site.id, site.name || ""]));
    const siteCodes = new Map(sites.map(site => [site.id, site.internal_code ?? null]));
    return rows.map(row => Object.assign({}, row, { site_name: siteNames.get(row.site_id) || row.site_legacy_id || "Sede", site_internal_code: siteCodes.get(row.site_id) }));
  }
  async function listPendingInspectionCounts() {
    const actor = appSession();
    const filters = ["status=not.in.(Ejecutado,Eliminado)", "deleted_at=is.null"];
    if (actor?.role === "Técnico" && actor.authId) filters.push(`technician_id=eq.${encodeURIComponent(String(actor.authId))}`);
    const rows = await queryRows(`inspection_records?select=site_legacy_id,equipment_legacy_id,status,technician_id,deleted_at&${filters.join("&")}`);
    const counts = { sites: {}, equipment: {} };
    rows.forEach(row => {
      const status = String(row.status || "Pendiente").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es");
      if (!row.site_legacy_id || row.deleted_at || status === "ejecutado" || status === "eliminado") return;
      if (actor?.role === "Técnico" && String(row.technician_id || "") !== String(actor.authId || "")) return;
      const siteId = String(row.site_legacy_id);
      counts.sites[siteId] = (counts.sites[siteId] || 0) + 1;
      const equipmentKey = String(row.equipment_legacy_id || "");
      if (equipmentKey) counts.equipment[equipmentKey] = (counts.equipment[equipmentKey] || 0) + 1;
    });
    return counts;
  }
  async function getInspectionPhotoUrls(paths = []) {
    const uniquePaths = [...new Set((Array.isArray(paths) ? paths : []).map(String).filter(Boolean))];
    const urls = {};
    await Promise.all(uniquePaths.map(async path => {
      const response = await authorizedFetch(`${URL}/storage/v1/object/sign/${INSPECTION_BUCKET}/${encodedStoragePath(path)}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expiresIn: 3600 })
      });
      const text = await response.text();
      let result = {}; try { result = text ? JSON.parse(text) : {}; } catch (error) {}
      if (!response.ok) throw new Error(`No se pudo abrir una foto de inspección (${response.status}).`);
      const signed = result.signedURL || result.signedUrl;
      if (!signed) throw new Error("Supabase no devolvió el enlace temporal de la fotografía.");
      urls[path] = signed.startsWith("http") ? signed : `${URL}/storage/v1${signed.startsWith("/") ? "" : "/"}${signed}`;
    }));
    return urls;
  }
  async function updateInspectionStatus(recordId, status, correction = "") {
    if (!["Pendiente", "En ejecución", "Ejecutado", "Eliminado"].includes(status)) throw new Error("Estado de inspección no válido.");
    const actor = appSession();
    const completed = status === "Ejecutado";
    const deleted = status === "Eliminado";
    const response = await authorizedFetch(`${URL}/rest/v1/inspection_records?id=eq.${encodeURIComponent(String(recordId))}`, {
      method: "PATCH", headers: { "Content-Type": "application/json", Prefer: "return=representation" },
      body: JSON.stringify(Object.assign({ status, updated_at: new Date().toISOString() }, completed ? { correction: String(correction || "").trim() || null, corrected_by: actor?.authId || null, corrected_by_name: actor?.name || null, corrected_at: new Date().toISOString() } : {}, deleted ? { deleted_at: new Date().toISOString(), deleted_by: actor?.authId || null, deleted_by_name: actor?.name || null } : {}))
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`No se pudo actualizar la inspección (${response.status}): ${text}`);
    const result = text ? JSON.parse(text) : [];
    if (!result.length) throw new Error("No tienes acceso para actualizar esta inspección.");
    try { localStorage.setItem("smartfit.inspection.records.changed.v1", String(Date.now())); } catch (error) {}
    return result[0];
  }
  async function startInspectionExecution(recordId) {
    const now = new Date().toISOString();
    const response = await authorizedFetch(`${URL}/rest/v1/inspection_records?id=eq.${encodeURIComponent(String(recordId))}&status=eq.Pendiente`, {
      method: "PATCH", headers: { "Content-Type": "application/json", Prefer: "return=representation" },
      body: JSON.stringify({ status: "En ejecución", execution_started_at: now, updated_at: now })
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`No se pudo iniciar la inspección (${response.status}): ${text}`);
    const result = text ? JSON.parse(text) : [];
    if (!result.length) throw new Error("La inspección ya cambió de estado o no tienes acceso para iniciarla.");
    try { localStorage.setItem("smartfit.inspection.records.changed.v1", String(Date.now())); } catch (error) {}
    return result[0];
  }
  async function importLocalCommonKnowledge(entries = []) {
    const role = appSession()?.role;
    if (!["Administrador", "Supervisor"].includes(role)) return { imported: 0 };
    const remote = await listCommonKnowledgeEntries();
    const known = new Set(remote.map(row => String(row.legacy_id)));
    const missing = (Array.isArray(entries) ? entries : []).filter(entry => entry?.id && !known.has(String(entry.id)));
    if (!missing.length) return { imported: 0 };
    const actorId = appSession()?.authId || auth()?.user?.id || null;
    const rows = missing.map(entry => ({
      id: createCommonKnowledgeUuid(),
      legacy_id: String(entry.id),
      kind: entry.kind === "tutorial" ? "tutorial" : "failure",
      brand_legacy_id: String(entry.brandId || ""),
      brand_name: String(entry.brandName || ""),
      equipment_name: String(entry.equipmentName || ""),
      model: String(entry.model || ""),
      title: String(entry.title || ""),
      description: String(entry.description || ""),
      symptoms: String(entry.symptoms || ""),
      resolution: String(entry.resolution || ""),
      url: String(entry.url || ""),
      thumbnail_url: String(entry.thumbnailUrl || ""),
      duration: String(entry.duration || ""),
      photos: [],
      created_by: actorId,
      updated_by: actorId,
      updated_at: entry.updatedAt || new Date().toISOString()
    }));
    const importedRows = await postRows("knowledge_entries", rows, "legacy_id", "legacy_id");
    if (importedRows.length) announceCommonKnowledgeChange();
    return { imported: importedRows.length };
  }
  async function postRow(table, row, conflict = "legacy_id", returning = "id,legacy_id") {
    const token = auth()?.access_token;
    if (!token) throw new Error("No hay una sesión autenticada de Supabase.");
    const response = await authorizedFetch(`${URL}/rest/v1/${table}?on_conflict=${encodeURIComponent(conflict)}&select=${encodeURIComponent(returning)}`, {
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
    const pending = readPendingAccessLogs();
    const entry = {
      id: global.crypto?.randomUUID?.() || `access-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      authId: String(user.authId),
      name: String(user.name || "Usuario"),
      username: String(user.username || "—"),
      role: String(user.role || "Usuario"),
      queuedAt: new Date().toISOString()
    };
    pending.push(entry);
    if (!savePendingAccessLogs(pending)) console.warn("No se pudo guardar la cola local de accesos; el inicio de sesión continuará.");
    global.AdminStore?.recordAccess(user, entry.id);
    return { queued: true };
  }

  function currentAuthUserId() {
    try {
      const payload = auth()?.access_token?.split(".")[1];
      return payload ? JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))).sub || "" : "";
    } catch (error) { return ""; }
  }

  async function syncPendingAccessLogs() {
    if (pendingAccessSyncInFlight) return pendingAccessSyncInFlight;
    const authUserId = currentAuthUserId();
    if (!authUserId) return { synced: 0 };
    pendingAccessSyncInFlight = (async () => {
      let pending = readPendingAccessLogs();
      let synced = 0;
      for (const entry of pending) {
        // RLS exige que el usuario autenticado registre su propio acceso.
        if (String(entry.authId) !== authUserId) continue;
        const response = await authorizedFetch(`${URL}/rest/v1/audit_log`, {
          method: "POST",
          keepalive: true,
          headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
          body: JSON.stringify({
            actor_id: entry.authId,
            action: "login_success",
            entity_type: "profile",
            entity_id: entry.authId,
            details: { full_name: entry.name, username: entry.username, role: entry.role, client_event_id: entry.id }
          })
        });
        if (!response.ok) throw new Error(`No se pudo sincronizar el inicio de sesión (${response.status}): ${await response.text()}`);
        pending = pending.filter(item => item.id !== entry.id);
        if (!savePendingAccessLogs(pending)) console.warn("No se pudo actualizar la cola local de accesos después de sincronizar.");
        synced += 1;
      }
      return { synced };
    })();
    try { return await pendingAccessSyncInFlight; }
    finally { pendingAccessSyncInFlight = null; }
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
      if (changedTable === "knowledge_entries") {
        announceCommonKnowledgeChange();
        return;
      }
      if (changedTable === "inspection_records") {
        global.dispatchEvent(new CustomEvent("smartfit:inspection-records-changed"));
        return;
      }
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
          if (!result.skipped) global.dispatchEvent(new CustomEvent("smartfit:supabase-data-hydrated", { detail: { tables } }));
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
  function emptyPending() { return { tickets: [], records: {} }; }
  function readPending() {
    const currentActorId = appSession()?.authId || auth()?.user?.id || "";
    try {
      const backup = JSON.parse(global.sessionStorage.getItem(PENDING_KEY) || "null");
      if (backup && typeof backup === "object" && !Array.isArray(backup)) {
        if (backup.actorId && currentActorId && backup.actorId !== currentActorId) return emptyPending();
        return backup;
      }
    } catch (error) { /* intenta la copia compacta */ }
    const value = parseLocal(PENDING_KEY, {});
    if (!value || typeof value !== "object" || Array.isArray(value)) return emptyPending();
    if (value.actorId && currentActorId && value.actorId !== currentActorId) return emptyPending();
    return value;
  }
  function savePending(value) {
    const actorId = appSession()?.authId || auth()?.user?.id || "";
    const ownedValue = Object.assign({}, value, actorId ? { actorId } : {});
    try {
      setLocal(PENDING_KEY, ownedValue);
      try { global.sessionStorage.removeItem(PENDING_KEY); } catch (error) {}
    } catch (error) {
      try { global.sessionStorage.setItem(PENDING_KEY, JSON.stringify(ownedValue)); }
      catch (sessionError) { console.warn("La cola durable está en IndexedDB; no se pudo actualizar su copia compacta.", sessionError); }
    }
  }

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
    if (type.includes("fuera de servicio")) return "Fuera de servicio";
    if (type === "en servicio" || type.includes("reactiv")) return "En servicio";
    if (type.includes("correctivo")) return "Correctivo";
    if (type.includes("preventivo")) return "Preventivo";
    if (type.includes("inspeccion")) return "Inspección";
    if (type.includes("lubric")) return "Lubricación";
    return "Otro";
  }
  function cleanMetadata(value, photoField) {
    const metadata = Object.assign({}, value || {});
    delete metadata[photoField];
    delete metadata.imagesChanged;
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
    const existing = await lookupOne("tickets", "id,created_by,technician_id,technician_name,metadata,photos", "legacy_id", ticket.id);
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
    const incomingPhotos = Array.isArray(ticket.images) ? ticket.images.slice(0, 4) : [];
    // Una actualización de estado o metadatos desde otro dispositivo suele traer
    // images=[] porque no tiene la caché local. En ese caso conserva lo remoto.
    const photos = incomingPhotos.length
      ? incomingPhotos
      : Array.isArray(existing?.photos) ? existing.photos.slice(0, 4) : incomingPhotos;
    const savedTicket = await postRow("tickets", {
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
    }, "legacy_id", "id,photos");
    const savedPhotos = Array.isArray(savedTicket?.photos) ? savedTicket.photos : [];
    if (!savedTicket?.id || savedPhotos.length !== photos.length || !photos.every((photo, index) => savedPhotos[index] === photo)) {
      throw new Error("Supabase no confirmó todas las fotografías del ticket. Se conservará la copia local para reintentar.");
    }
    const mediaKey = `ticket::${ticket.id}`;
    await deleteStoredMedia(mediaKey);
    return savedTicket;
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
    const incomingPhotos = Array.isArray(entry.images) ? entry.images.slice(0, 4) : [];
    // Leer las fotos remotas salvo que el usuario haya editado explícitamente
    // la galería. Así una edición de texto desde otro dispositivo no puede
    // reemplazar fotos ya guardadas por [] o por una caché incompleta.
    const existing = await lookupOne("maintenance_events", entry.imagesChanged ? "id,registered_by,created_at" : "id,registered_by,created_at,photos", "legacy_id", legacyId);
    const site = AdminStore.listSites().find(row => String(row.id) === siteLegacyId);
    const ticketUuid = Array.isArray(entry.ticketIds) && entry.ticketIds.length ? await ticketUuidForLegacy(entry.ticketIds[0]) : null;
    const technician = AdminStore.listUsers().find(user => user.name === entry.technician && user.role === "Técnico");
    const supervisor = AdminStore.listUsers().find(user => user.id === site?.supervisorUserId) || AdminStore.listUsers().find(user => user.name === site?.supervisor && user.role === "Supervisor");
    const equipment = localEquipmentForRecordKey(recordKey) || {};
    const date = String(entry.date || entry.recordedAt || new Date().toISOString()).slice(0, 10);
    const details = [entry.work, entry.replacement ? `Repuesto: ${entry.replacement}` : "", entry.observations ? `Observaciones: ${entry.observations}` : ""].filter(Boolean).join("\n");
    const photos = entry.imagesChanged
      ? incomingPhotos
      : Array.isArray(existing?.photos) && existing.photos.length
        ? existing.photos.slice(0, 4)
        : incomingPhotos;
    const saved = await postRow("maintenance_events", {
      legacy_id: legacyId, source_record_key: recordKey, site_id: siteUuid,
      equipment_id: await equipmentForRecordKey(recordKey), equipment_name: equipment.name || "Equipo",
      equipment_model: equipment.model, fixed_asset: equipment.fixedAsset, event_type: normalizeEventType(entry.type),
      status: String(entry.status || entry.type || "Registrado"), details, ticket_id: ticketUuid,
      technician_id: await profileIdForLegacy(technician?.id, actor), technician_name: entry.technician || null,
      supervisor_id: await profileIdForLegacy(supervisor?.id, actor), supervisor_name: supervisor?.name || site?.supervisor || null,
      registered_by: existing?.registered_by || await profileIdForLegacy(entry.recordedById, actor) || actor.authId,
      registered_by_name: entry.recordedByName || actor.name || null,
      photos, occurred_at: `${date}T12:00:00.000Z`,
      created_at: existing?.created_at || entry.recordedAt || new Date().toISOString(), updated_at: new Date().toISOString(),
      metadata: cleanMetadata(entry, "images")
    }, "legacy_id", "id,photos");
    const savedPhotos = Array.isArray(saved?.photos) ? saved.photos : [];
    if (!saved?.id || savedPhotos.length !== photos.length || !photos.every((photo, index) => savedPhotos[index] === photo)) {
      throw new Error("Supabase no confirmó todas las fotografías del mantenimiento. Se conservará la copia local para reintentar.");
    }
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
    for (const kind of ["maintenance", "mileage"]) {
      for (const entry of Array.isArray(after?.[kind]) ? after[kind] : []) {
        if (entry?.id) syncedRecordMediaKeys.add(recordMediaKey(recordKey, kind, entry.id));
      }
    }
    await deleteStoredMedia(`${recordKey}::`, { prefix: true });
  }

  async function persistTicketQueued(ticket) {
    const actorId = appSession()?.authId || auth()?.user?.id || "";
    try {
      await putTicketMedia([ticket]);
      await writeOutboxItem(`ticket::${ticket.id}`, {
        type: "ticket", actorId, ticket: stripTicketMedia([ticket])[0], savedAt: Date.now()
      });
      const pending = readPending();
      pending.tickets = [...new Set([...(pending.tickets || []), String(ticket.id)])];
      savePending(pending);
      await persistTicket(ticket);
      pending.tickets = (pending.tickets || []).filter(id => String(id) !== String(ticket.id));
      savePending(pending);
      await deleteOutboxItem(`ticket::${ticket.id}`);
    } catch (error) {
      const pending = readPending();
      pending.tickets = [...new Set([...(pending.tickets || []), String(ticket.id)])];
      savePending(pending);
      try {
        await writeOutboxItem(`ticket::${ticket.id}`, {
          type: "ticket", actorId, ticket: stripTicketMedia([ticket])[0], savedAt: Date.now()
        });
      } catch (queueError) { console.warn("No se pudo guardar la copia durable del ticket pendiente.", queueError); }
      throw error;
    }
  }
  async function persistMachineRecord(recordKey, before, after) {
    const actorId = appSession()?.authId || auth()?.user?.id || "";
    const queued = readPending().records?.[recordKey] || { maintenance: [], mileage: [] };
    const beforeForSync = {
      maintenance: [...(before?.maintenance || []), ...(queued.maintenance || []).map(id => ({ id }))],
      mileage: [...(before?.mileage || []), ...(queued.mileage || []).map(id => ({ id }))]
    };
    try {
      await writeOutboxItem(`record::${recordKey}`, {
        type: "record", actorId, recordKey,
        before: stripRecordMedia(beforeForSync),
        record: stripRecordMedia(after), savedAt: Date.now()
      });
      await persistMachineRecordNow(recordKey, beforeForSync, after);
      const pending = readPending();
      delete pending.records?.[recordKey];
      savePending(pending);
      await deleteOutboxItem(`record::${recordKey}`);
    } catch (error) {
      const pending = readPending();
      const deleted = { maintenance: [...(queued.maintenance || [])], mileage: [...(queued.mileage || [])] };
      for (const kind of ["maintenance", "mileage"]) {
        const oldIds = new Set((before?.[kind] || []).map(entry => String(entry.id)));
        const newIds = new Set((after?.[kind] || []).map(entry => String(entry.id)));
        oldIds.forEach(id => { if (!newIds.has(id)) deleted[kind].push(id); });
        // Los IDs nuevos o modificados también deben reintentarse después de
        // una falla de red; la cola cubre tanto altas/ediciones como borrados.
        newIds.forEach(id => {
          const oldEntry = (before?.[kind] || []).find(entry => String(entry.id) === id);
          const newEntry = (after?.[kind] || []).find(entry => String(entry.id) === id);
          if (!oldEntry || JSON.stringify(oldEntry) !== JSON.stringify(newEntry)) deleted[kind].push(id);
        });
        deleted[kind] = [...new Set(deleted[kind])];
      }
      pending.records = Object.assign({}, pending.records, { [recordKey]: deleted });
      savePending(pending);
      try {
        await writeOutboxItem(`record::${recordKey}`, {
          type: "record", actorId, recordKey,
          before: stripRecordMedia(beforeForSync),
          record: stripRecordMedia(after), savedAt: Date.now()
        });
      } catch (queueError) { console.warn("No se pudo guardar la copia durable del evento pendiente.", queueError); }
      throw error;
    }
  }
  async function flushPendingNow() {
    if (global.navigator && global.navigator.onLine === false) return { skipped: true, offline: true };
    const currentActorId = appSession()?.authId || auth()?.user?.id || "";
    const outbox = (await readOutboxItems()).filter(item => item?.actorId && item.actorId === currentActorId);
    const pending = readPending();
    pending.tickets = Array.isArray(pending.tickets) ? pending.tickets : [];
    pending.records = pending.records && typeof pending.records === "object" ? pending.records : {};
    const outboxTickets = new Map(outbox.filter(item => item?.type === "ticket" && item.ticket?.id)
      .map(item => [String(item.ticket.id), item.ticket]));
    outboxTickets.forEach((_ticket, id) => { if (!pending.tickets.includes(id)) pending.tickets.push(id); });
    const localTicketsById = new Map((Array.isArray(parseLocal(TICKETS_KEY, [])) ? parseLocal(TICKETS_KEY, []) : [])
      .map(ticket => [String(ticket.id), ticket]));
    outboxTickets.forEach((ticket, id) => localTicketsById.set(id, Object.assign({}, localTicketsById.get(id) || {}, ticket)));
    const localTickets = [...localTicketsById.values()];
    const ticketsWithPhotos = await restoreTicketMedia(localTickets);
    for (const id of pending.tickets || []) {
      const ticket = ticketsWithPhotos.find(row => String(row.id) === String(id));
      if (!ticket) continue;
      try {
        await persistTicket(ticket);
        pending.tickets = pending.tickets.filter(value => String(value) !== String(id));
        await deleteOutboxItem(`ticket::${id}`);
      }
      catch (error) { console.warn("Pendiente de sincronizar ticket", id, error); }
    }
    const localRecords = parseLocal(RECORDS_KEY, {});
    const outboxRecords = new Map(outbox.filter(item => item?.type === "record" && item.recordKey)
      .map(item => [String(item.recordKey), item]));
    outboxRecords.forEach((item, key) => {
      const queued = pending.records[key] || { maintenance: [], mileage: [] };
      pending.records[key] = queued;
      for (const kind of ["maintenance", "mileage"]) {
        queued[kind] = [...new Set([...(queued[kind] || []), ...(item.before?.[kind] || []).map(row => String(row.id))
          .filter(id => !(item.record?.[kind] || []).some(row => String(row.id) === id))])];
      }
      const current = localRecords[key] || { maintenance: [], mileage: [] };
      localRecords[key] = {
        maintenance: mergeById(current.maintenance, item.record?.maintenance || []),
        mileage: mergeById(current.mileage, item.record?.mileage || [])
      };
    });
    for (const [recordKey, deleted] of Object.entries(pending.records)) {
      const outboxItem = outboxRecords.get(recordKey);
      const after = outboxItem?.record
        ? await restoreRecordMedia(recordKey, outboxItem.record)
        : localRecords[recordKey] || { maintenance: [], mileage: [] };
      const before = outboxItem?.before || {
        maintenance: (deleted.maintenance || []).map(id => ({ id })),
        mileage: (deleted.mileage || []).map(id => ({ id }))
      };
      try {
        await persistMachineRecordNow(recordKey, before, after);
        delete pending.records[recordKey];
        await deleteOutboxItem(`record::${recordKey}`);
      }
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
  async function getReportImages({ maintenanceLegacyIds = [], ticketLegacyIds = [] } = {}) {
    const readImages = async (table, values) => {
      const ids = [...new Set((Array.isArray(values) ? values : []).map(value => String(value || "")).filter(Boolean))];
      const imagesByLegacyId = {};
      let remoteError = null;
      if (auth()?.access_token) {
        // Mantén las respuestas pequeñas: las fotos viajan como JSON y varios
        // eventos con adjuntos pueden superar límites de memoria/red del móvil.
        try {
          const chunks = [];
          for (let offset = 0; offset < ids.length; offset += 2) chunks.push(ids.slice(offset, offset + 2));
          for (let offset = 0; offset < chunks.length; offset += 2) {
            const page = await Promise.all(chunks.slice(offset, offset + 2).map(async chunk => {
              const filterValues = chunk.map(value => `"${value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"`).join(",");
              const filter = encodeURIComponent(`in.(${filterValues})`);
              return queryRows(`${table}?select=legacy_id,photos&legacy_id=${filter}`);
            }));
            page.flat().forEach(row => {
              if (row.legacy_id) imagesByLegacyId[String(row.legacy_id)] = Array.isArray(row.photos) ? row.photos : [];
            });
          }
        } catch (error) { remoteError = error; }
      }
      const fallbackImage = legacyId => {
        if (table === "tickets") return ticketMediaCache.get(`ticket::${legacyId}`) || [];
        for (const kind of ["maintenance", "mileage"]) {
          const marker = `::${kind}::`;
          const index = legacyId.lastIndexOf(marker);
          if (index < 0) continue;
          return recordMediaCache.get(recordMediaKey(legacyId.slice(0, index), kind, legacyId.slice(index + marker.length))) || [];
        }
        return [];
      };
      ids.forEach(id => {
        if (!imagesByLegacyId[id]?.length) imagesByLegacyId[id] = fallbackImage(id);
        const images = imagesByLegacyId[id];
        if (!images.length) return;
        if (table === "tickets") {
          ticketMediaCache.set(`ticket::${id}`, images);
          return;
        }
        const marker = id.lastIndexOf("::");
        if (marker < 0) return;
        const kindMarker = id.lastIndexOf("::", marker - 1);
        if (kindMarker < 0) return;
        const kind = id.slice(kindMarker + 2, marker);
        if (kind !== "maintenance" && kind !== "mileage") return;
        const recordKey = id.slice(0, kindMarker);
        const entryId = id.slice(marker + 2);
        recordMediaCache.set(recordMediaKey(recordKey, kind, entryId), images);
      });
      return { images: imagesByLegacyId, error: remoteError };
    };
    const [maintenanceResult, ticketResult] = await Promise.all([
      readImages("maintenance_events", maintenanceLegacyIds),
      readImages("tickets", ticketLegacyIds)
    ]);
    return {
      maintenance: maintenanceResult.images,
      tickets: ticketResult.images,
      warning: maintenanceResult.error || ticketResult.error || null
    };
  }
  async function loadMachineRecordMedia(recordKey) {
    const key = String(recordKey || "");
    if (!key) return { images: {}, warning: null };
    const localRecord = parseLocal(RECORDS_KEY, {})[key] || { maintenance: [], mileage: [] };
    const restored = await restoreRecordMedia(key, localRecord);
    const ids = ["maintenance", "mileage"].flatMap(kind =>
      (Array.isArray(restored[kind]) ? restored[kind] : [])
        .filter(entry => entry?.id)
        .map(entry => `${key}::${kind}::${entry.id}`)
    );
    const result = await getReportImages({ maintenanceLegacyIds: ids });
    return { images: result.maintenance, warning: result.warning };
  }
  if (!global.__smartfitPendingOnlineBound) {
    global.__smartfitPendingOnlineBound = true;
    const retryPendingWhenReady = () => {
      if (!auth()?.access_token) return;
      if (global.navigator && global.navigator.onLine === false) return;
      if (global.document?.visibilityState === "hidden") return;
      flushPending().catch(error => console.warn("No se pudieron sincronizar los cambios al recuperar la conexión.", error));
    };
    global.addEventListener("online", retryPendingWhenReady);
    global.addEventListener("pageshow", retryPendingWhenReady);
    global.addEventListener("focus", retryPendingWhenReady);
    global.document?.addEventListener("visibilitychange", () => {
      if (global.document.visibilityState === "visible") retryPendingWhenReady();
    });
    if (!pendingRetryTimer) pendingRetryTimer = global.setInterval(retryPendingWhenReady, 60000);
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
    // Inicializa IndexedDB a la vez que se consulta Supabase. La preparación
    // sigue completándose antes de combinar/restaurar registros con fotografías.
    const localStorageReady = Promise.all([prepareMachineRecordStorage(), prepareTicketStorage()]);
    const currentActorId = appSession()?.authId || auth()?.user?.id || "";
    const durableOutboxPromise = readOutboxItems().then(items => items.filter(item => item?.actorId && item.actorId === currentActorId));
    requestPersistentStorage();
    const canReadAccountEmails = appSession()?.role === "Administrador";
    const loaders = {
      sites: () => getRows("sites", "id,legacy_id,name,region,internal_code,active"),
      brands: () => getRows("brands", "id,legacy_id,name,active"),
      equipment: () => getRows("equipment", "id,legacy_id,site_id,brand_id,fixed_asset,name,model,category,image_url,active,metadata"),
      tickets: () => getRows("tickets", "id,legacy_id,ticket_number,ticket_type,site_id,equipment_id,fixed_asset,title,description,status,supervisor_id,supervisor_name,technician_id,technician_name,leader_id,leader_name,created_by,created_by_name,updated_by,machine_record_key,ticket_date,metadata,created_at,updated_at"),
      maintenance_events: () => getRows("maintenance_events", "id,legacy_id,source_record_key,site_id,equipment_id,equipment_name,equipment_model,fixed_asset,event_type,status,details,ticket_id,technician_id,technician_name,supervisor_id,supervisor_name,registered_by,registered_by_name,occurred_at,created_at,metadata"),
      mileage_records: () => getRows("mileage_records", "id,legacy_id,source_record_key,site_id,equipment_id,equipment_name,equipment_model,fixed_asset,mileage_km,entry_date,technician_id,technician_name,supervisor_id,supervisor_name,registered_by,registered_by_name,notes,lubrication,recorded_at,metadata"),
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
    const [loadedValues, , durableOutbox] = await Promise.all([
      Promise.all(requestedTables.map(table => loaders[table]())),
      localStorageReady,
      durableOutboxPromise
    ]);
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
        eventId: String(row.details?.client_event_id || ""),
        userId: String(row.actor_id || row.entity_id || ""),
        name: String(row.details?.full_name || "Usuario"),
        username: String(row.details?.username || "—"),
        role: String(row.details?.role || "Usuario"),
        accessedAt: row.created_at
      }));
      const localAccesses = parseLocal(ACCESS_HISTORY_KEY, []);
      const remoteEventIds = new Set(remoteAccesses.map(entry => entry.eventId).filter(Boolean));
      const unmatchedLocalAccesses = (Array.isArray(localAccesses) ? localAccesses : [])
        .filter(entry => !entry.eventId || !remoteEventIds.has(String(entry.eventId)));
      const mergedAccesses = [...remoteAccesses, ...unmatchedLocalAccesses]
        .filter(entry => entry?.accessedAt)
        .sort((a, b) => String(b.accessedAt).localeCompare(String(a.accessedAt)));
      setLocal(ACCESS_HISTORY_KEY, mergedAccesses.slice(0, 500));
    }
    if (refreshTickets) {
      const outboxTickets = new Map((durableOutbox || []).filter(item => item?.type === "ticket" && item.ticket?.id)
        .map(item => [String(item.ticket.id), item.ticket]));
      const cachedTickets = Array.isArray(parseLocal(TICKETS_KEY, [])) ? parseLocal(TICKETS_KEY, []) : [];
      const cachedTicketMap = new Map(cachedTickets.map(ticket => [String(ticket.id), ticket]));
      outboxTickets.forEach((ticket, id) => cachedTicketMap.set(id, Object.assign({}, cachedTicketMap.get(id) || {}, ticket)));
      const localTickets = await restoreTicketMedia([...cachedTicketMap.values()]);
      const localById = new Map(localTickets.map(ticket => [String(ticket.id), ticket]));
      const pending = readPending();
      pending.tickets = Array.isArray(pending.tickets) ? pending.tickets : [];
      outboxTickets.forEach((_ticket, id) => { if (!pending.tickets.includes(id)) pending.tickets.push(id); });
      const remoteTicketsWithRecoveredMedia = hydratedTickets.map(ticket => {
        const localTicket = localById.get(String(ticket.id));
        const remoteHasPhotos = Array.isArray(ticket.images) && ticket.images.length > 0;
        const localHasPhotos = Array.isArray(localTicket?.images) && localTicket.images.length > 0;
        if (!remoteHasPhotos && localHasPhotos) {
          pending.tickets = [...new Set([...pending.tickets, String(ticket.id)])];
          return Object.assign({}, ticket, { images: localTicket.images });
        }
        return ticket;
      });
      const remoteTicketIds = new Set(remoteTicketsWithRecoveredMedia.map(ticket => String(ticket.id)));
      for (const ticket of localTickets) {
        if (!remoteTicketIds.has(String(ticket.id)) && Array.isArray(ticket.images) && ticket.images.length) {
          pending.tickets = [...new Set([...pending.tickets, String(ticket.id)])];
        }
      }
      const mergedTickets = mergeById(localTickets, remoteTicketsWithRecoveredMedia);
      outboxTickets.forEach((ticket, id) => {
        const local = localById.get(id);
        const index = mergedTickets.findIndex(row => String(row.id) === id);
        const queuedTicket = Object.assign({}, ticket, local?.images?.length ? { images: local.images } : {});
        if (index >= 0) mergedTickets.splice(index, 1, queuedTicket);
        else mergedTickets.push(queuedTicket);
      });
      cacheTicketMedia(mergedTickets);
      const syncedKeys = [];
      for (const ticket of remoteTicketsWithRecoveredMedia) {
        if (!Array.isArray(ticket.images) || !ticket.images.length) continue;
        if (outboxTickets.has(String(ticket.id))) continue;
        const key = `ticket::${ticket.id}`;
        syncedKeys.push(key);
      }
      await deleteStoredMedia(syncedKeys);
      await writeTicketCache(mergedTickets);
      savePending(pending);
    }
    if (refreshRecords) {
      const ticketUuidToLegacy = new Map(tickets.map(row => [row.id, String(row.legacy_id || "")]));
      const hydratedRecords = hydrateRecords(events, mileageRows, eventLinks, ticketUuidToLegacy, siteIdToLegacy, profileIdToLegacy);
      const localRecords = parseLocal(RECORDS_KEY, {});
      const mergedRecords = Object.assign({}, localRecords && typeof localRecords === "object" ? localRecords : {});
      const pending = readPending();
      pending.records = Object.assign({}, pending.records || {});
      const outboxRecords = new Map((durableOutbox || []).filter(item => item?.type === "record" && item.recordKey)
        .map(item => [String(item.recordKey), item]));
      outboxRecords.forEach((item, recordKey) => {
        const cached = mergedRecords[recordKey] || { maintenance: [], mileage: [] };
        mergedRecords[recordKey] = {
          maintenance: mergeById(cached.maintenance, item.record?.maintenance || []),
          mileage: mergeById(cached.mileage, item.record?.mileage || [])
        };
        const queued = pending.records[recordKey] || { maintenance: [], mileage: [] };
        for (const kind of ["maintenance", "mileage"]) {
          queued[kind] = [...new Set([...(queued[kind] || []), ...(item.before?.[kind] || [])
            .map(row => String(row.id))
            .filter(id => !(item.record?.[kind] || []).some(row => String(row.id) === id))])];
        }
        pending.records[recordKey] = queued;
      });
      const mediaRestoreTargets = [];
      Object.entries(mergedRecords).forEach(([recordKey, record]) => {
        mediaRestoreTargets.push({ recordKey, record, target: "local" });
      });
      outboxRecords.forEach((item, recordKey) => {
        if (item.record) mediaRestoreTargets.push({ recordKey, record: item.record, target: "outbox" });
      });
      const restoredMediaTargets = await restoreRecordMediaBatch(mediaRestoreTargets);
      const localMediaByRecord = new Map();
      const outboxMediaByRecord = new Map();
      mediaRestoreTargets.forEach((target, index) => {
        const restored = restoredMediaTargets[index];
        if (target.target === "outbox") outboxMediaByRecord.set(target.recordKey, restored);
        else localMediaByRecord.set(target.recordKey, restored);
      });
      outboxMediaByRecord.forEach((record, recordKey) => {
        const local = localMediaByRecord.get(recordKey) || { maintenance: [], mileage: [] };
        localMediaByRecord.set(recordKey, {
          maintenance: mergeById(local.maintenance, record.maintenance),
          mileage: mergeById(local.mileage, record.mileage)
        });
      });
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
        const localWithMedia = localMediaByRecord.get(recordKey) || localRecord;
        const remoteWithRecoveredMedia = { maintenance: [], mileage: [] };
        const syncedMediaKeys = [];
        for (const kind of ["maintenance", "mileage"]) {
          const localById = new Map((localWithMedia[kind] || []).map(item => [String(item.id), item]));
          const localImagesToKeep = [];
          const remoteItems = (remoteRecord[kind] || []).map(item => {
            const localItem = localById.get(String(item.id));
            const remoteHasImages = Array.isArray(item.images) && item.images.length > 0;
            const localHasImages = Array.isArray(localItem?.images) && localItem.images.length > 0;
            const mediaKey = recordMediaKey(recordKey, kind, item.id);
            if (remoteHasImages && !outboxRecords.has(recordKey)) {
              syncedRecordMediaKeys.add(mediaKey);
              syncedMediaKeys.push(mediaKey);
            }
            if (!remoteHasImages && localHasImages) {
              queueRecordEntry(recordKey, kind, item.id);
              localImagesToKeep.push(Object.assign({}, item, { images: localItem.images }));
              return Object.assign({}, item, { images: localItem.images });
            }
            return item;
          });
          remoteWithRecoveredMedia[kind] = remoteItems;
          if (localImagesToKeep.length) {
            try { await putRecordMedia(recordKey, { [kind]: localImagesToKeep }); }
            catch (error) { console.warn("No se pudieron conservar fotografías pendientes de sincronización.", error); }
          }
          const remoteIds = new Set(remoteItems.map(item => String(item.id)));
          // A local entry missing remotely can be a save interrupted before its
          // Supabase call. Queue it so the next flush can restore text and photos.
          for (const localItem of localWithMedia[kind] || []) {
            if (!remoteIds.has(String(localItem.id))) queueRecordEntry(recordKey, kind, localItem.id);
          }
        }
        await deleteStoredMedia(syncedMediaKeys);
        cacheRecordMedia(recordKey, remoteWithRecoveredMedia);
        const durableRecord = outboxRecords.get(recordKey);
        const durableWithMedia = outboxMediaByRecord.get(recordKey) || { maintenance: [], mileage: [] };
        const mergedRecord = {
          maintenance: mergeById(localWithMedia.maintenance, remoteWithRecoveredMedia.maintenance),
          mileage: mergeById(localWithMedia.mileage, remoteWithRecoveredMedia.mileage)
        };
        mergedRecords[recordKey] = durableRecord
          ? overlayOutboxRecord(mergedRecord, durableRecord, durableWithMedia)
          : mergedRecord;
      }
      // También reintenta copias locales de sedes que todavía no aparecen entre
      // los eventos remotos para esta cuenta.
      for (const [recordKey, localRecord] of Object.entries(mergedRecords)) {
        if (hydratedRecords[recordKey]) continue;
        const localWithMedia = localMediaByRecord.get(recordKey) || localRecord;
        for (const kind of ["maintenance", "mileage"]) {
          for (const item of localWithMedia[kind] || []) queueRecordEntry(recordKey, kind, item.id);
        }
        const durableRecord = outboxRecords.get(recordKey);
        const durableWithMedia = outboxMediaByRecord.get(recordKey) || null;
        mergedRecords[recordKey] = durableRecord
          ? overlayOutboxRecord(localWithMedia, durableRecord, durableWithMedia)
          : localWithMedia;
      }
      savePending(pending);
      setLocal(RECORDS_KEY, stripRecordsMedia(mergedRecords));
    }
    if (refreshSites) {
      setLocal("smartfit.admin.sites.v1", siteRowsForLocal);
      setLocal("smartfit.admin.brands.v1", brandRowsForLocal);
    }
    if (refreshUsers) setLocal("smartfit.admin.users.v1", mergedUsers);
    if (fullHydration || refreshTickets || refreshRecords) setTimeout(() => {
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
          if (!result.skipped) global.dispatchEvent(new CustomEvent("smartfit:supabase-data-hydrated", { detail: { tables } }));
        } catch (error) {
          console.warn("No se pudieron aplicar todos los cambios recibidos durante la sincronización.", error);
        }
      });
    });
  }

  function parseLocalSession(key) {
    try { return JSON.parse(sessionStorage.getItem(key) || "null"); } catch (error) { return null; }
  }

  global.SmartFitSupabaseData = { hydrate, manageUser, persistSite, persistBrand, deleteBrand, deleteSite, recordAccess, syncPendingAccessLogs, startRealtimeSync, persistTicket: persistTicketQueued, assignTicketTechnician, listAssignableTicketTechnicians, persistMachineRecord, retryPending: flushPending, getReportImages, loadMachineRecordMedia, prepareMachineRecordStorage, writeMachineRecordCache, getMachineRecordWithCachedMediaSync, prepareTicketStorage, writeTicketCache, getTicketsWithCachedMediaSync, listCommonKnowledgeEntries, saveCommonKnowledgeEntry, deleteCommonKnowledgeEntry, uploadCommonKnowledgeImage, deleteCommonKnowledgeImages, getCommonKnowledgeImageUrls, saveInspectionBatch, listInspectionRecords, listPendingInspectionCounts, getInspectionPhotoUrls, updateInspectionStatus, startInspectionExecution, importLocalCommonKnowledge };
})(window);
