(() => {
  const indexes = new WeakMap();
  window.catalogPartNameKey = (brand, part) => {
    const reference = String(part?.reference || "").trim();
    const sap = String(part?.sap || "").trim();
    if (!reference && !sap) return null;
    const key = `pieza:${brand}:${reference ? "ref" : "sap"}:${encodeURIComponent(reference || sap)}`;
    return key.length <= 200 ? key : null;
  };
  window.catalogNameIndex = (brand, rows) => {
    if (indexes.has(rows)) return indexes.get(rows);
    const names = new Map();
    const legacy = new Map();
    const manuals = new Set(window.catalogManuals.filter(model => model.brand === brand).map(model => model.id));
    for (const row of rows) {
      if (row.tipo !== "nombre" || typeof row.valor !== "string") continue;
      if (row.clave.startsWith(`pieza:${brand}:`)) {
        names.set(row.clave, row.valor);
        continue;
      }
      const [, model, ...identity] = row.clave.split(":");
      if (!row.clave.startsWith("modelo:") || !manuals.has(model) || identity.length < 3 || !row.valor.trim()) continue;
      const key = window.catalogPartNameKey(brand, { reference: identity.slice(2).join(":") });
      if (!key) continue;
      if (!legacy.has(key)) legacy.set(key, new Map());
      legacy.get(key).set(row.valor.trim().toLocaleLowerCase(), row.valor);
    }
    for (const [key, candidates] of legacy) {
      if (!names.has(key) && candidates.size === 1) names.set(key, candidates.values().next().value);
    }
    indexes.set(rows, names);
    return names;
  };
  window.catalogTechnicalName = (brand, part, localNames, localKey, names) => {
    const key = window.catalogPartNameKey(brand, part);
    return key && names?.has(key) ? names.get(key) : localNames?.[localKey] || "";
  };
})();
