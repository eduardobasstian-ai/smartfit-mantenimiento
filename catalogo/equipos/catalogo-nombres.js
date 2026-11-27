(() => {
  const indexes = new WeakMap();
  const photoIndexes = new WeakMap();
  window.catalogPartFamily = brand => brand;
  window.catalogPartBrands = brand => [brand];
  window.catalogPartNameKey = (brand, part) => {
    const reference = String(part?.reference || "").trim();
    const sap = String(part?.sap || "").trim();
    if (!reference && !sap) return null;
    const key = `pieza:${window.catalogPartFamily(brand)}:${reference ? "ref" : "sap"}:${encodeURIComponent(reference || sap)}`;
    return key.length <= 200 ? key : null;
  };
  window.catalogNameIndex = (brand, rows) => {
    if (indexes.get(rows)?.has(brand)) return indexes.get(rows).get(brand);
    const names = new Map();
    const legacy = new Map();
    const aliases = window.catalogPartBrands(brand);
    const family = window.catalogPartFamily(brand);
    const manuals = new Set(window.catalogManuals.filter(model => aliases.includes(model.brand)).map(model => model.id));
    const canonical = [];
    for (const row of rows) {
      if (row.tipo !== "nombre" || typeof row.valor !== "string") continue;
      if (row.clave.startsWith(`pieza:${family}:`)) {
        canonical.push(row);
        continue;
      }
      if (aliases.some(alias => row.clave.startsWith(`pieza:${alias}:`))) {
        const key = row.clave.replace(/^pieza:[^:]+:/, `pieza:${family}:`);
        if (!legacy.has(key)) legacy.set(key, new Map());
        legacy.get(key).set(row.valor.trim().toLocaleLowerCase(),row.valor);
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
    for (const row of canonical) names.set(row.clave,row.valor);
    if (!indexes.has(rows)) indexes.set(rows,new Map());
    indexes.get(rows).set(brand, names);
    return names;
  };
  window.catalogTechnicalName = (brand, part, localNames, localKey, names) => {
    const key = window.catalogPartNameKey(brand, part);
    return key && names?.has(key) ? names.get(key) : localNames?.[localKey] || "";
  };
  window.catalogPhotoIndex = (brand, rows) => {
    if(photoIndexes.get(rows)?.has(brand))return photoIndexes.get(rows).get(brand);
    const photos = new Map();
    const aliases = window.catalogPartBrands(brand);
    const manuals = new Set(window.catalogManuals.filter(model=>aliases.includes(model.brand)).map(model=>model.id));
    if(aliases.includes('hammer-strength')) manuals.add('hs-abc');
    // Las fotografías históricas de manuales incluyen la referencia en su clave.
    for(const row of rows){
      if(row.tipo!=='foto' || !row.valor || !row.clave.startsWith('modelo:'))continue;
      const [,modelId,...identity]=row.clave.split(':');
      if(!manuals.has(modelId) || identity.length<3)continue;
      const key=window.catalogPartNameKey(brand,{reference:identity.slice(2).join(':')});
      if(key && !photos.has(key))photos.set(key,{modelId,key:identity.join(':'),version:row.valor});
    }
    for(const row of rows)if(row.tipo==='foto' && row.clave.startsWith(`pieza:${window.catalogPartFamily(brand)}:`)){
      photos.set(row.clave,row.valor ? {modelId:'piezas',key:row.clave,version:row.valor} : null);
    }
    if(!photoIndexes.has(rows))photoIndexes.set(rows,new Map());
    photoIndexes.get(rows).set(brand,photos);
    return photos;
  };
})();
