(() => {
  const models = new Map([
    ["t600x-sf", ["catalogo-assets/mtm3839-datos.js", () => window.matrixT600xCatalog]],
    ["e-es-f", ["catalogo-assets/eliptica-e-es-f/datos.js", () => window.ellipticalCatalog]],
    ["hs-abc", ["catalogo-assets/hs-abc/datos.js", () => window.hammerAbdominalCatalog]],
    ["rt-g2", ["catalogo-assets/movement-rt-g2/datos.js", () => window.movementRtG2Catalog]],
    ...window.catalogManuals.map(({ id, revision }) => [
      id, [`catalogo-assets/manuales/${id}/datos.js?v=${revision}`, () => window.catalogModelData[id]],
    ]),
  ]);
  const pending = new Map();
  const requested = new URLSearchParams(location.search).get("equipo");
  window.catalogModelId = models.has(requested) ? requested : "t600x-sf";
  window.catalogModelData = Object.create(null);

  window.catalogLoadModel = id => {
    const entry = models.get(id);
    if (!entry) return Promise.reject(new Error("Equipo sin planos disponibles."));
    if (pending.has(id)) return pending.get(id);
    const [url, getData] = entry;
    const promise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = url;
      script.onload = () => {
        script.remove();
        const data = getData();
        if (data?.views?.length) resolve(data);
        else reject(new Error("Los datos del equipo están incompletos."));
      };
      script.onerror = () => {
        script.remove();
        reject(new Error("No se pudieron cargar los planos de este equipo."));
      };
      document.head.append(script);
    }).catch(error => {
      pending.delete(id);
      throw error;
    });
    pending.set(id, promise);
    return promise;
  };
})();
