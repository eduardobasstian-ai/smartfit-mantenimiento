(() => {
  const identity = part => ({
    item: String(part?.item || ""),
    reference: String(part?.reference || ""),
    sap: String(part?.sap || ""),
  });
  const matches = (part, original) => ["item", "reference", "sap"]
    .every(field => String(part?.[field] || "") === String(original?.[field] || ""));
  window.catalogReferenceOriginal = part => part._catalogOriginal || identity(part);

  window.catalogApplyChanges = (data, rows) => {
    const views = new Map(data.views.map(view => [view.id, view]));
    for (const row of rows) {
      if (row.tipo !== "marcador") continue;
      const record = row.valor;
      const view = views.get(record?.viewId);
      if (!view || !record?.callout?.key || !record.part) continue;
      const index = view.callouts.findIndex(marker => marker.key === record.callout.key);
      if (index < 0) view.callouts.push(structuredClone(record.callout));
      else view.callouts[index] = structuredClone(record.callout);
      const parts = view.parts || data.parts;
      if (parts && !parts[record.part.item] && !record.callout.variantItems) parts[record.part.item] = structuredClone(record.part);
      if (Array.isArray(view.bom) && !record.callout.variantItems && !view.bom.some(part => matches(part, record.part))) {
        view.bom.push(structuredClone(record.part));
      }
    }
    for (const row of rows) {
      if (row.tipo !== "referencia") continue;
      const record = row.valor;
      const view = views.get(record?.viewId);
      if (!view || !record?.original || !record.part?.item) continue;
      const original = record.original;
      const part = { ...structuredClone(record.part), _catalogOriginal: original };
      const parts = view.parts || (view.parts = { ...data.parts });
      const oldPart = parts?.[original.item];
      if (!view.bom && view.id === "general" && Array.isArray(data.bom)) view.bom = structuredClone(data.bom);
      if (Array.isArray(view.bom)) {
        view.bom = view.bom.map(entry => matches(entry, original) ? part : entry);
      }
      if (parts) {
        if (matches(oldPart, original)) delete parts[original.item];
        if (!parts[part.item] || matches(oldPart, original)) parts[part.item] = part;
      }
      if (part.item !== original.item) {
        const remaining = view.bom?.some(entry => entry.item === original.item);
        for (const marker of view.callouts) {
          if (marker.item === original.item) {
            if (remaining) marker.variantItems = [...new Set([...(marker.variantItems || []), original.item, part.item])];
            else {
              marker.item = part.item;
              marker.label = part.item;
            }
          }
          if (marker.variantItems?.includes(original.item)) {
            marker.variantItems = [...new Set(marker.variantItems.flatMap(item =>
              item === original.item ? (remaining ? [original.item, part.item] : [part.item]) : [item]))];
          }
        }
      }
    }
    return data;
  };
})();
