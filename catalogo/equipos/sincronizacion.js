window.CatalogSync = (() => {
  let session;
  const scopes = new Map();
  const brandNames = new Map();
  const bucket = "catalogo-fotos-compartidas";

  async function request(path, options = {}) {
    if (!session) throw new Error("Inicia sesión para conectar el catálogo.");
    const { url, key, getToken } = session;
    const token = await getToken();
    return fetch(url + path, {
      ...options,
      cache: "no-store",
      headers: { apikey: key, Authorization: `Bearer ${token}`, ...options.headers },
    });
  }

  async function checked(response) {
    if (response.ok) return response;
    const detail = await response.json().catch(() => null);
    throw Object.assign(new Error(detail?.message || `Supabase devolvió un error (${response.status}).`), {
      code: detail?.code, status: response.status,
    });
  }

  const photoPath = (item, model = "") => `/storage/v1/object/${bucket}/mtm3839/${model ? model + "/" : ""}${encodeURIComponent(item)}`;
  const canWrite = () => ["administrador", "supervisor"].includes(session?.role);
  const changed = modelId => {
    brandNames.clear();
    window.dispatchEvent(new CustomEvent("catalog-data-changed", { detail: { modelId } }));
  };
  const scopedChange = (row, prefix) => {
    const { global: shared, ...change } = row;
    if (shared && (row.tipo !== "nombre" || !row.clave.startsWith("pieza:"))) throw new Error("Nombre compartido inválido.");
    return { ...change, clave: shared ? row.clave : prefix + row.clave };
  };
  async function readBrandNames(brand, force = false) {
    if (!/^[a-z0-9-]+$/.test(brand)) throw new Error("Marca inválida.");
    const cached = brandNames.get(brand);
    if (cached?.pending) return cached.pending;
    if (!force && cached?.rows && Date.now() - cached.time < 5000) return cached.rows;
    const current = session;
    const entry = {};
    const patterns = [`clave.like.pieza:${brand}:*`, `clave.like.modelo:${brand}-*`];
    if (brand === "hammer-strength") patterns.push("clave.like.modelo:hs-abc:*");
    if (brand === "matrix") patterns.push("clave.like.modelo:e-es-f:*");
    if (brand === "movement") patterns.push("clave.like.modelo:rt-g2:*");
    entry.pending = (async () => {
      const rows = [];
      for (let offset = 0; ; offset += 500) {
        const response = await checked(await request(`/rest/v1/rpc/catalogo_cambios?tipo=eq.nombre&or=${encodeURIComponent("(" + patterns.join(",") + ")")}&order=clave&limit=500&offset=${offset}`));
        const page = await response.json();
        rows.push(...page);
        if (page.length < 500) break;
      }
      if (current !== session) throw new Error("La sesión cambió.");
      entry.rows = rows;
      entry.time = Date.now();
      return rows;
    })().finally(() => {
      entry.pending = null;
      if (!entry.rows && brandNames.get(brand) === entry) brandNames.delete(brand);
    });
    brandNames.set(brand, entry);
    return entry.pending;
  }

  function modelScope(id) {
    const model = id === "t600x-sf" ? "" : id;
    if (model && !/^[a-z0-9-]+$/.test(model)) throw new Error("Modelo inválido.");
    if (scopes.has(model)) return scopes.get(model);
    const prefix = model ? "modelo:" + model + ":" : "";
    let snapshot;
    let snapshotSession;
    let loadedAt = 0;
    let pending;
    let generation = 0;
    const scope = {
      get active() { return Boolean(session); },
      get canWrite() { return canWrite(); },
      async read(force = false) {
        if (!force && snapshot && snapshotSession === session && Date.now() - loadedAt < 5000) return snapshot;
        if (pending) return pending;
        const current = session;
        const revision = generation;
        pending = (async () => {
          const entries = [];
          const filter = prefix ? "clave=like." + encodeURIComponent(prefix + "*") : "clave=not.like.modelo%3A*";
          for (let offset = 0; ; offset += 500) {
            const response = await checked(await request(
              `/rest/v1/rpc/catalogo_cambios?order=tipo,clave&limit=500&offset=${offset}&${filter}`
            ));
            const page = await response.json();
            entries.push(...page.map(row => ({ ...row, clave: prefix ? row.clave.slice(prefix.length) : row.clave })));
            if (page.length < 500) break;
          }
          if (current !== session || revision !== generation) throw new Error("La sesión o el catálogo cambió. Vuelve a intentar.");
          snapshot = entries;
          snapshotSession = session;
          loadedAt = Date.now();
          return entries;
        })().finally(() => { pending = null; });
        return pending;
      },
      async save(changes) {
        if (!canWrite()) throw new Error("Tu perfil no permite editar el catálogo.");
        await checked(await request("/rest/v1/rpc/catalogo_guardar_cambios", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cambios: changes.map(row => scopedChange(row, prefix)) }),
        }));
        generation++;
        loadedAt = 0;
        changed(id);
      },
      async edit(changes) {
        if (!canWrite()) throw new Error("Tu perfil no permite editar el catálogo.");
        await checked(await request("/rest/v1/rpc/catalogo_editar", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cambios: changes.map(row => scopedChange(row, prefix)) }),
        }));
        generation++;
        loadedAt = 0;
        changed(id);
      },
      async readPhoto(item) {
        const response = await request(photoPath(item, model).replace("/object/", "/object/authenticated/"));
        if (response.status === 404) return null;
        if (response.status === 400) {
          const error = await response.clone().json().catch(() => null);
          if (String(error?.statusCode) === "404") return null;
        }
        await checked(response);
        return response.blob();
      },
      async savePhoto(item, blob) {
        if (!canWrite()) throw new Error("Tu perfil no permite publicar fotos.");
        await checked(await request(photoPath(item, model), {
          method: "POST", headers: { "Content-Type": blob.type, "x-upsert": "true" }, body: blob,
        }));
        await scope.save([{ tipo: "foto", clave: item, valor: crypto.randomUUID() }]);
      },
      async importPhoto(item, blob) {
        if (!canWrite()) throw new Error("Tu perfil no permite compartir fotos.");
        const response = await request(photoPath(item, model), {
          method: "POST", headers: { "Content-Type": blob.type, "x-upsert": "false" }, body: blob,
        });
        if (!response.ok) {
          const error = await response.clone().json().catch(() => null);
          if (response.status === 409 || String(error?.statusCode) === "409" || error?.error === "Duplicate") return false;
          await checked(response);
        }
        await scope.edit([{ tipo: "foto", clave: item, valor: crypto.randomUUID(), expected: null }]);
        return true;
      },
      async removePhoto(item) {
        if (!canWrite()) throw new Error("Tu perfil no permite eliminar fotos.");
        await checked(await request(`/storage/v1/object/${bucket}`, {
          method: "DELETE", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prefixes: [`mtm3839/${model ? model + "/" : ""}${item}`] }),
        }));
        await scope.save([{ tipo: "foto", clave: item, valor: "" }]);
      },
    };
    scopes.set(model, scope);
    return scope;
  }

  return {
    connect(settings) { session = settings; scopes.clear(); brandNames.clear(); },
    disconnect() { session = null; scopes.clear(); brandNames.clear(); },
    readBrandNames,
    forModel: modelScope,
    get active() { return Boolean(session); },
    get canWrite() { return canWrite(); },
    async readInventory() {
      const records = [];
      for (let offset = 0; ; offset += 500) {
        const response = await checked(await request(
          `/rest/v1/rpc/catalogo_inventario?order=id&limit=500&offset=${offset}`
        ));
        const page = await response.json();
        records.push(...page);
        if (page.length < 500) return records;
      }
    },
    async saveInventory(record, version = 0, createOnly = false) {
      const response = await checked(await request("/rest/v1/rpc/catalogo_inventario_guardar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ registro: record, version_esperada: version, solo_crear: createOnly }),
      }));
      const result = await response.json();
      const saved = Array.isArray(result) ? result[0] : result;
      if (!saved?.id || !Array.isArray(saved.links) || !Number.isInteger(saved.version)) {
        throw new Error("No se pudo confirmar el guardado del inventario.");
      }
      return saved;
    },
    async removeInventory(id, version) {
      await checked(await request("/rest/v1/rpc/catalogo_inventario_eliminar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ registro_id: id, version_esperada: version }),
      }));
    },
    read(force = false) { return modelScope("t600x-sf").read(force); },
    save(changes) { return modelScope("t600x-sf").save(changes); },
    edit(changes) { return modelScope("t600x-sf").edit(changes); },
    readPhoto(item) { return modelScope("t600x-sf").readPhoto(item); },
    savePhoto(item, blob) { return modelScope("t600x-sf").savePhoto(item, blob); },
    removePhoto(item) { return modelScope("t600x-sf").removePhoto(item); },
  };
})();
