(() => {
  // Recupera solo los datos creados por el usuario. No descarga planos ni imágenes del catálogo.
  const sources = [
    ["t600x-sf", "Matrix-T600X-SF:MTM3839-00", "smartfit-catalog-local-photos-v1"],
    ["e-es-f", "Matrix-E-ES-F:MEP1354-00", "smartfit-catalog-mep1354-photos-v1"],
    ["hs-abc", "Hammer-HS-ABC", "smartfit-catalog-hs-abc-photos-v1"],
    ["rt-g2", "Movement-RT-G2", "smartfit-catalog-movement-rt-g2-photos-v1"],
    ...window.catalogManuals.map(({ id }) => [id, id, `smartfit-catalog-${id}-photos-v1`]),
  ];
  let running;
  let version = 0;
  let notice;
  const read = (key, fallback) => {
    try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch { return fallback; }
  };
  function status(text) {
    if (!notice) {
      notice = document.createElement("p");
      notice.className = "catalog-recovery-status";
      notice.setAttribute("role", "status");
      document.querySelector("#catalogApp > main").prepend(notice);
    }
    notice.textContent = text;
    notice.hidden = !text;
  }
  async function openDatabase(name) {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onupgradeneeded = () => { request.transaction.abort(); reject(new Error("No existe la copia local.")); };
    });
  }
  async function photos(db, operation, key) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction("photos", "readonly");
      const request = tx.objectStore("photos")[operation](key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  async function recover() {
    if (running || !window.CatalogSync.canWrite) return running;
    const currentVersion = version;
    running = (async () => {
      let existing = [];
      try { existing = await indexedDB.databases?.() || []; } catch { /* Los nombres no dependen de IndexedDB. */ }
      const databases = new Set(existing.map(db => db.name));
      let saved = 0;
      let failed = 0;
      for (const [id, prefix, database] of sources) {
        if (version !== currentVersion || !window.CatalogSync.canWrite) return;
        const storage = "smartfit-catalog:" + prefix;
        const names = read(storage + ":technical-names:v1", {});
        const markers = read(storage + ":manual-refs:v1", []);
        const candidates = [
          ...Object.entries(names).filter(([, value]) => typeof value === "string").map(([clave, valor]) => ({ tipo: "nombre", clave, valor })),
          ...(Array.isArray(markers) ? markers : []).filter(row => row?.callout?.key && row.part && row.viewId)
            .map(valor => ({ tipo: "marcador", clave: valor.callout.key, valor })),
        ];
        let photoKeys = [];
        if (databases.has(database)) {
          try {
            const db = await openDatabase(database);
            try { if (db.objectStoreNames.contains("photos")) photoKeys = await photos(db, "getAllKeys"); }
            finally { db.close(); }
          } catch { failed++; }
        }
        if (!candidates.length && !photoKeys.length) continue;
        status("Compartiendo los datos locales pendientes… Puedes seguir utilizando el catálogo.");
        try {
          const sync = window.CatalogSync.forModel(id);
          let rows = await sync.read(true);
          const keys = new Set(rows.map(row => row.tipo + ":" + row.clave));
          const missing = candidates.filter(row => !keys.has(row.tipo + ":" + row.clave));
          for (let i = 0; i < missing.length; i += 400) {
            if (version !== currentVersion || !window.CatalogSync.canWrite) return;
            const batch = missing.slice(i, i + 400);
            await sync.edit(batch.map(row => ({ ...row, expected: null })));
            saved += batch.length;
          }
          if (!photoKeys.length) continue;
          rows = await sync.read(true);
          const sharedPhotos = new Set(rows.filter(row => row.tipo === "foto").map(row => row.clave));
          const db = await openDatabase(database);
          try {
            if (!db.objectStoreNames.contains("photos")) continue;
            for (const key of photoKeys) {
              if (version !== currentVersion || !window.CatalogSync.canWrite) return;
              if (sharedPhotos.has(String(key))) continue;
              const blob = await photos(db, "get", key);
              if (blob instanceof Blob && blob.type.startsWith("image/")) {
                if (await sync.importPhoto(String(key), blob)) saved++;
              }
            }
          } finally { db.close(); }
        } catch {
          // Se conservan los originales; el siguiente inicio o reconexión vuelve a intentarlo.
          failed++;
        }
      }
      if (version === currentVersion) status(failed
        ? "Hay datos locales pendientes de compartir. Conservamos los originales y volveremos a intentarlo al reconectar."
        : saved ? `Se compartieron ${saved} nombres, marcadores o fotos locales. Los datos compartidos existentes se conservaron.` : "");
    })().finally(() => {
      running = null;
      if (version !== currentVersion && window.CatalogSync.canWrite) setTimeout(() => recover().catch(() => {}), 0);
    });
    return running;
  }
  window.addEventListener("catalog-session-ready", () => {
    version++;
    setTimeout(() => recover().catch(() => status("No se pudo comprobar la copia local. Tus datos se conservan.")), 1200);
  });
  window.addEventListener("online", () => recover().catch(() => {}));
})();
