window.CatalogSync = (() => {
  let session;
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
    throw new Error(`Supabase devolvió un error (${response.status}).`);
  }

  const photoPath = item => `/storage/v1/object/${bucket}/mtm3839/${encodeURIComponent(item)}`;

  return {
    connect(settings) { session = settings; },
    disconnect() { session = null; },
    get active() { return Boolean(session); },
    get canWrite() { return session?.role === "administrador"; },
    async read() {
      const entries = [];
      for (let offset = 0; ; offset += 500) {
        const response = await checked(await request(
          `/rest/v1/rpc/catalogo_cambios?order=tipo,clave&limit=500&offset=${offset}`
        ));
        const page = await response.json();
        entries.push(...page);
        if (page.length < 500) return entries;
      }
    },
    async save(changes) {
      if (!this.canWrite) throw new Error("Solo un administrador puede publicar cambios.");
      await checked(await request("/rest/v1/rpc/catalogo_guardar_cambios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cambios: changes }),
      }));
    },
    async readPhoto(item) {
      const response = await request(photoPath(item).replace("/object/", "/object/authenticated/"));
      if (response.status === 404) return null;
      if (response.status === 400) {
        const error = await response.clone().json().catch(() => null);
        if (error?.statusCode === "404" || error?.statusCode === 404) return null;
      }
      await checked(response);
      return response.blob();
    },
    async savePhoto(item, blob) {
      if (!this.canWrite) throw new Error("Solo un administrador puede publicar fotos.");
      await checked(await request(photoPath(item), {
        method: "POST",
        headers: { "Content-Type": blob.type, "x-upsert": "true", "Cache-Control": "no-cache" },
        body: blob,
      }));
      await this.save([{ tipo: "foto", clave: item, valor: crypto.randomUUID() }]);
    },
    async removePhoto(item) {
      await checked(await request(`/storage/v1/object/${bucket}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prefixes: [`mtm3839/${item}`] }),
      }));
      await this.save([{ tipo: "foto", clave: item, valor: "" }]);
    },
  };
})();
