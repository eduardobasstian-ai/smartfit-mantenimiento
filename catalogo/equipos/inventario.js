window.createCatalogInventory = (brands, models) => {
  const $ = id => document.getElementById(id);
  const key = "smartfit.catalog.inventory.v1";
  const sharedKey = "smartfit.catalog.inventory.shared.v1";
  const importedKey = "smartfit.catalog.inventory.imported.v1";
  const dialog = $("inventoryDialog");
  const form = $("inventoryForm");
  const search = $("inventorySearch");
  const brandFilter = $("inventoryBrand");
  const modelFilter = $("inventoryModel");
  const picker = $("inventoryPicker");
  const addLink = $("inventoryAddLink");
  const shared = $("inventoryShared");
  const modelsDialog = $("inventoryModelsDialog");
  const modelChoices = $("inventoryModelChoices");
  const modelSearch = $("inventoryModelSearch");
  const modelDraftList = $("inventoryModelDraft");
  const selectedModelsList = $("inventorySelectedModels");
  const quantity = $("inventoryQuantity");
  const untracked = $("inventoryUntracked");
  const formStatus = $("inventoryFormStatus");
  const inventorySearch = $("inventoryListSearch");
  const inventoryBrand = $("inventoryListBrand");
  const esc = value => String(value ?? "").replace(/[&<>"']/g, char =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  const normalize = value => String(value ?? "").normalize("NFD").replace(/\p{M}/gu, "").trim().toLowerCase();
  const sources = new Map([
    ["t600x-sf", ["Matrix-T600X-SF:MTM3839-00", false]],
    ["e-es-f", ["Matrix-E-ES-F:MEP1354-00", false]],
    ["hs-abc", ["Hammer-HS-ABC", true]],
    ["rt-g2", ["Movement-RT-G2", true]],
    ...window.catalogManuals.map(({ id }) => [id, [id, true, true]]),
  ]);
  const brandNames = new Map(brands);
  const catalogModels = models.filter(model => sources.has(model.id));
  const modelsById = new Map(catalogModels.map(model => [model.id, model]));
  inventoryBrand.innerHTML += brands
    .filter(([id]) => catalogModels.some(model => model.brand === id))
    .sort(([, a], [, b]) => a.localeCompare(b, "es"))
    .map(([, name]) => `<option value="${esc(name)}">${esc(name)}</option>`).join("");
  brandFilter.innerHTML = '<option value="">Selecciona una marca</option>' + brands
    .filter(([id]) => catalogModels.some(model => model.brand === id))
    .map(([id, name]) => `<option value="${esc(id)}">${esc(name)}</option>`).join("");
  const indexes = new Map();
  const pickerErrors = new Set();
  let matrixChanges;
  let loading;
  let matrixRefreshedAt = 0;
  let sessionVersion = 0;
  let links = [];
  let selectedModels = [];
  let modelDraft = new Set();
  let assigningModel = "";
  let editing = null;
  let stockRaw;
  let stockCache = [];
  let sharedRecords = parseStored(storedValue(sharedKey), null);
  if (!Array.isArray(sharedRecords)) sharedRecords = null;
  let inventoryLoading;
  let inventoryReady = false;
  let inventoryWriting = false;
  let lastInventoryRead = 0;
  let editingVersion = 0;

  function records() {
    if (sharedRecords) return sharedRecords;
    const raw = storedValue(key);
    if (raw !== stockRaw) {
      stockRaw = raw;
      const stored = parseStored(raw, []);
      stockCache = Array.isArray(stored) ? stored : [];
    }
    return stockCache;
  }

  function cacheInventory(rows) {
    sharedRecords = rows;
    try { localStorage.setItem(sharedKey, JSON.stringify(rows)); } catch { /* Se conserva la copia en memoria. */ }
  }

  function inventoryError(error) {
    if (error.code === "40001" || error.code === "23505") {
      inventoryReady = false;
      lastInventoryRead = 0;
    }
    return error.message || "No se pudo conectar el inventario compartido.";
  }

  async function syncInventory(force = false) {
    if (!window.CatalogSync.active || inventoryWriting) return;
    if (inventoryLoading) return inventoryLoading;
    if (!force && Date.now() - lastInventoryRead < 5000) return;
    const version = sessionVersion;
    inventoryLoading = (async () => {
      $("inventoryStatus").textContent = "Sincronizando inventario…";
      let rows = await window.CatalogSync.readInventory();
      if (version !== sessionVersion) return;
      let failedImport = false;
      if (window.CatalogSync.canWrite) {
        const legacy = parseStored(storedValue(key), []);
        const savedImports = parseStored(storedValue(importedKey), []);
        const migrated = new Set(Array.isArray(savedImports) ? savedImports : []);
        let imported = false;
        for (const record of Array.isArray(legacy) ? legacy : []) {
          if (!record?.id || !record.links?.length || migrated.has(record.id)) continue;
          if (version !== sessionVersion) return;
          try {
            await window.CatalogSync.saveInventory(record, 0, true);
            migrated.add(record.id);
            imported = true;
          } catch {
            failedImport = true;
          }
        }
        if (version !== sessionVersion) return;
        try { localStorage.setItem(importedKey, JSON.stringify([...migrated])); } catch {}
        if (imported) rows = await window.CatalogSync.readInventory();
      }
      if (version !== sessionVersion) return;
      cacheInventory(rows);
      inventoryReady = true;
      lastInventoryRead = Date.now();
      $("inventoryStatus").textContent = failedImport
        ? "Algunos registros locales siguen pendientes de compartir. Conservamos sus datos en este dispositivo."
        : "Inventario compartido actualizado.";
      if (!$("inventoryView").hidden) {
        renderInventory();
        if (referencesLoading) await referencesLoading;
        await refreshReferences(force);
      }
    })().catch(error => {
      if (version === sessionVersion) $("inventoryStatus").textContent = inventoryError(error);
    }).finally(() => {
      if (version === sessionVersion) inventoryLoading = null;
    });
    return inventoryLoading;
  }

  function storedValue(storageKey) {
    try { return localStorage.getItem(storageKey); } catch { return null; }
  }

  function parseStored(raw, fallback) {
    try { return JSON.parse(raw) ?? fallback; } catch { return fallback; }
  }

  async function indexModel(modelId, force = false) {
    const model = modelsById.get(modelId);
    if (!model) return;
    const base = await window.catalogLoadModel(modelId);
    const [prefix, scoped, manual] = sources.get(modelId);
    const storage = "smartfit-catalog:" + prefix;
    const remote = window.CatalogSync.active
      ? await window.CatalogSync.forModel(modelId).read(force)
      : modelId === "t600x-sf" ? matrixChanges : undefined;
    const localNames = remote ? null : storedValue(storage + ":technical-names:v1");
    const localMarkers = remote ? null : storedValue(storage + ":manual-refs:v1");
    const cached = indexes.get(modelId);
    if (cached && cached.remote === remote && cached.localNames === localNames && cached.localMarkers === localMarkers) return;
    const data = window.catalogApplyChanges(structuredClone(base), remote ||
      parseStored(localMarkers, []).map(valor => ({ tipo: "marcador", valor })));
    const names = remote
      ? Object.fromEntries(remote.filter(row => row.tipo === "nombre").map(row => [row.clave, row.valor]))
      : parseStored(localNames, {});
    const partsById = new Map();
    const brand = brandNames.get(model.brand);
    const equipmentNames = window.catalogEquipmentName?.(model) || { es: model.name, en: "" };
    const equipment = equipmentNames.es + " " + model.model;
    for (const view of data.views) {
      const parts = [
        ...(view.id === "general" ? data.bom || [] : []),
        ...(view.bom || []),
        ...Object.values(view.parts || (view.id === "general" ? data.parts : {})),
      ];
      for (const part of parts) {
        if (!part || part.viewIds || !(part.item || part.reference || part.sap)) continue;
        const code = String(part.item || "").trim().toUpperCase();
        const itemKey = scoped ? view.id + ":" + code : code;
        const nameKey = part._catalogIdentityKey || (manual ? itemKey + ":" + (part.reference || "") : itemKey);
        const name = names?.[nameKey];
        const original = window.catalogReferenceOriginal(part);
        const id = JSON.stringify([model.id, scoped ? view.id : "", original.item.trim().toUpperCase(), original.reference, original.sap]);
        partsById.set(id, {
          id, modelId: model.id, brand, equipment, modelName: equipmentNames.es,
          modelEnglish: equipmentNames.en, model: model.model,
          supplierName: part.description || "", scope: scoped ? view.label : "",
          item: part.item, reference: part.reference, sap: part.sap, technicalName: name,
          name: name || part.description || part.reference || part.sap || code,
        });
      }
    }
    indexes.set(modelId, { partsById, remote, localNames, localMarkers });
  }

  const currentPart = link => indexes.get(link.modelId)?.partsById.get(link.id) || link;
  const partCode = part => [
    part.item && "Ítem " + part.item, part.reference && "Ref. " + part.reference, part.sap && "SAP " + part.sap,
  ].filter(Boolean).join(" · ");
  const equipmentLabel = part => [part.brand, part.equipment, part.scope].filter(Boolean).join(" · ");
  const modelLabel = model => {
    const names = window.catalogEquipmentName?.(model) || { es: model.name, en: "" };
    return [brandNames.get(model.brand), names.es, names.en, "Modelo: " + model.model].filter(Boolean).join(" · ");
  };
  const modelNameMarkup = model => {
    const names = window.catalogEquipmentName?.(model) || { es: model.name, en: "" };
    return `<strong>${esc(brandNames.get(model.brand))} · ${esc(names.es)}</strong><small>${esc([names.en, "Modelo: " + model.model].filter(Boolean).join(" · "))}</small>`;
  };
  const partTechnicalName = part => part.technicalName?.trim() || "";
  const partSupplierName = part => {
    const technicalName = partTechnicalName(part);
    const supplierName = part.supplierName?.trim() ||
      (part.name !== technicalName ? part.name : "");
    return technicalName && normalize(supplierName) !== normalize(technicalName) ? supplierName : "";
  };
  const partSearchValues = part => [
    part.technicalName, part.name, part.supplierName, part.brand, part.equipment,
    part.modelName, part.modelEnglish, part.model, part.item, part.reference, part.sap, part.scope,
  ];
  const matchesPartSearch = (part, value) => {
    const terms = normalize(value).match(/[\p{L}\p{N}]+/gu) || [];
    const fields = partSearchValues(part).map(normalize);
    return terms.every(term => fields.some(field => field.includes(term)));
  };

  function renderInventory() {
    const canWrite = window.CatalogSync.canWrite;
    $("inventoryAdd").hidden = !canWrite;
    $("inventoryAdd").disabled = !inventoryReady || inventoryWriting;
    const query = normalize(inventorySearch.value);
    const brand = inventoryBrand.value;
    const stock = records();
    const groups = new Map();
    for (const record of stock) {
      for (const link of record.links.map(currentPart)) {
        if (brand && link.brand !== brand) continue;
        if (query && !matchesPartSearch(link, query)) continue;
        const groupKey = [link.brand, link.modelName || link.equipment, link.model && "Modelo: " + link.model]
          .filter(Boolean).join(" · ");
        if (!groups.has(groupKey)) groups.set(groupKey, { modelEnglish: link.modelEnglish, rows: [] });
        groups.get(groupKey).rows.push({ record, link });
      }
    }
    const list = $("inventoryList");
    list.innerHTML = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b, "es"))
      .map(([group, { modelEnglish, rows }]) => `
        <section class="inventory-group">
          <h3>${esc(group)}</h3>
          ${modelEnglish ? `<small class="inventory-model-english">${esc(modelEnglish)}</small>` : ""}
          <ul>${rows.sort((a, b) => (partTechnicalName(a.link) || a.link.name || "").localeCompare(partTechnicalName(b.link) || b.link.name || "", "es")).map(({ record, link }) => `
            <li class="inventory-row">
              <div class="inventory-part-copy">
                <strong class="inventory-part-technical">${esc(partTechnicalName(link) || link.name)}</strong>
                ${partSupplierName(link) ? `<small class="inventory-part-supplier">${esc(partSupplierName(link))}</small>` : ""}
                <small>${esc([link.scope, partCode(link)].filter(Boolean).join(" · "))}</small>
              </div>
              <span>${record.quantity === null ? "Sin control de stock" : esc(record.quantity) + (record.links.length > 1 ? " unidades · stock compartido" : " unidades")}</span>
              ${canWrite ? `<div class="inventory-row-actions">
                <button type="button" class="btn" data-edit-stock="${esc(record.id)}">Editar</button>
                <button type="button" class="btn" data-delete-stock="${esc(record.id)}">Eliminar</button>
              </div>` : ""}
            </li>`).join("")}</ul>
        </section>`).join("") || `<p class="equipment-empty">${stock.length
      ? "No hay repuestos que coincidan con la búsqueda o el filtro."
      : "Todavía no hay repuestos en inventario."}</p>`;
  }

  function renderPicker() {
    $("inventoryCompatibility").hidden = !shared.checked;
    $("inventoryPickerFilters").hidden = shared.checked;
    $("inventoryPickerHeading").hidden = !shared.checked || !assigningModel;
    const pendingModels = selectedModels.some(id => !links.some(link => link.modelId === id));
    const readyToSave = links.length > 0 && picker.hidden && (!shared.checked || !pendingModels);
    $("inventoryStock").hidden = !readyToSave;
    updateStockMode();
    $("inventorySave").disabled = !readyToSave || !inventoryReady || inventoryWriting;
    const modelId = shared.checked ? assigningModel : modelFilter.value;
    search.disabled = !modelId;
    addLink.textContent = selectedModels.length ? "Cambiar selección de equipos" : "Seleccionar equipos";
    selectedModelsList.innerHTML = selectedModels.map((id, index) => {
      const model = catalogModels.find(model => model.id === id);
      const assigned = links.filter(link => link.modelId === id).length;
      return `<li class="inventory-row">
        <div class="inventory-model-copy">${modelNameMarkup(model)}<small>${assigned ? assigned + (assigned === 1 ? " repuesto vinculado" : " repuestos vinculados") : "Pendiente de asignar repuesto"}</small></div>
        <button class="btn" type="button" data-assign-stock="${index}">${assigned ? "Agregar otro repuesto" : "Asignar repuesto"}</button>
      </li>`;
    }).join("");
    for (const button of selectedModelsList.querySelectorAll("[data-assign-stock]")) {
      button.onclick = () => {
        assigningModel = selectedModels[Number(button.dataset.assignStock)];
        $("inventoryPickerModel").textContent = modelLabel(catalogModels.find(model => model.id === assigningModel));
        search.value = "";
        picker.hidden = false;
        preparePicker(assigningModel);
        search.focus();
      };
    }
    const selected = new Set(links.map(link => link.id));
    const query = normalize(search.value);
    const index = indexes.get(modelId)?.partsById;
    const matches = [];
    if (query && index) {
      for (const part of index.values()) {
        if (!selected.has(part.id) && matchesPartSearch(part, query)) matches.push(part);
        if (matches.length === 30) break;
      }
    }
    $("inventoryMatches").innerHTML = matches.map((part, index) => `
      <button type="button" data-stock-link="${index}">
        <strong>${esc(part.technicalName || part.name)}</strong>
        ${partSupplierName(part) ? `<small class="inventory-part-supplier">${esc(partSupplierName(part))}</small>` : ""}
        <span>${esc(equipmentLabel(part))}</span>
        ${part.modelEnglish ? `<small class="inventory-part-supplier">${esc([part.modelEnglish, "Modelo: " + part.model].filter(Boolean).join(" · "))}</small>` : ""}
        <span class="inventory-result-fields">
          <span>Ítem <strong>${esc(part.item || "—")}</strong></span>
          <span>Nombre técnico <strong>${esc(part.technicalName || "Sin asignar")}</strong></span>
          <span>Referencia <strong>${esc(part.reference || "—")}</strong></span>
          <span>SAP <strong>${esc(part.sap || "—")}</strong></span>
        </span>
      </button>`).join("") || (!modelId || picker.hidden ? ""
        : pickerErrors.has(modelId) ? '<p>No se pudo cargar el catálogo del equipo.</p><button type="button" data-retry-inventory-model>Reintentar</button>'
        : !index ? '<p role="status">Cargando repuestos…</p>'
        : query ? "<p>Sin coincidencias disponibles.</p>" : "");
    const retry = $("inventoryMatches").querySelector("[data-retry-inventory-model]");
    if (retry) retry.onclick = () => preparePicker(modelId);
    for (const button of $("inventoryMatches").querySelectorAll("[data-stock-link]")) {
      button.onclick = () => {
        links.push(matches[Number(button.dataset.stockLink)]);
        formStatus.textContent = "";
        picker.hidden = true;
        assigningModel = "";
        renderPicker();
        (selectedModelsList.querySelector("[data-assign-stock]") || untracked).focus();
      };
    }
    $("inventoryLinks").innerHTML = links.map(currentPart).map((part, index) => `
      <li class="inventory-row">
        <div><strong>${esc(partTechnicalName(part) || part.name)}</strong>${partSupplierName(part) ? `<small class="inventory-part-supplier">${esc(partSupplierName(part))}</small>` : ""}<small>${esc([part.modelEnglish, "Modelo: " + part.model, part.scope, partCode(part)].filter(Boolean).join(" · "))}</small></div>
        <button type="button" class="btn" data-remove-stock-link="${index}">Quitar vínculo</button>
      </li>`).join("") || "<li>Agrega al menos una pieza del catálogo.</li>";
    for (const button of $("inventoryLinks").querySelectorAll("[data-remove-stock-link]")) {
      button.onclick = () => {
        links.splice(Number(button.dataset.removeStockLink), 1);
        if (!links.length && !shared.checked) openPicker();
        else {
          renderPicker();
          (picker.hidden ? (shared.checked ? addLink : untracked) : shared.checked ? search : brandFilter).focus();
        }
      };
    }
  }

  function renderModelChoices() {
    const terms = normalize(modelSearch.value).match(/[\p{L}\p{N}]+/gu) || [];
    const matches = terms.length ? catalogModels.filter(model => {
      const text = normalize(modelLabel(model)).replace(/[^\p{L}\p{N}]/gu, "");
      return !modelDraft.has(model.id) && terms.every(term => text.includes(term));
    }).sort((a, b) => modelLabel(a).localeCompare(modelLabel(b), "es")) : [];
    modelChoices.innerHTML = matches.slice(0, 8).map(model =>
      `<button type="button" data-select-model="${esc(model.id)}">＋ <span class="inventory-model-copy">${modelNameMarkup(model)}</span></button>`
    ).join("") || (terms.length ? '<p>No hay coincidencias disponibles.</p>' : "");
    if (matches.length > 8) modelChoices.insertAdjacentHTML("beforeend", "<p>Escribe más detalles para acotar la búsqueda.</p>");
    modelDraftList.innerHTML = [...modelDraft].map(id => {
      const model = catalogModels.find(model => model.id === id);
      const linked = links.some(link => link.modelId === id);
      return `<li class="inventory-row"><div>${esc(modelLabel(model))}</div>
        <button class="btn" type="button" data-remove-model="${esc(id)}" ${linked ? 'disabled title="Tiene repuestos vinculados"' : ""}>Quitar</button></li>`;
    }).join("") || '<li>Aún no has seleccionado equipos.</li>';
  }

  modelSearch.oninput = renderModelChoices;
  modelChoices.onclick = event => {
    const button = event.target.closest("[data-select-model]");
    if (!button) return;
    modelDraft.add(button.dataset.selectModel);
    $("inventoryModelsStatus").textContent = "";
    renderModelChoices();
    modelSearch.focus();
  };
  modelDraftList.onclick = event => {
    const button = event.target.closest("[data-remove-model]");
    if (!button || button.disabled) return;
    modelDraft.delete(button.dataset.removeModel);
    $("inventoryModelsStatus").textContent = "";
    renderModelChoices();
    modelSearch.focus();
  };

  function openModelsDialog() {
    modelDraft = new Set([...selectedModels, ...links.map(link => link.modelId)]
      .filter(id => catalogModels.some(model => model.id === id)));
    modelSearch.value = "";
    $("inventoryModelsStatus").textContent = "";
    renderModelChoices();
    modelsDialog.showModal();
    modelSearch.focus();
  }

  $("inventoryModelsCancel").onclick = () => modelsDialog.close();
  modelsDialog.addEventListener("close", () => {
    if (!selectedModels.length) {
      shared.checked = false;
      if (!links.length) openPicker();
      else renderPicker();
      shared.focus();
    }
  });
  $("inventoryModelsForm").onsubmit = event => {
    event.preventDefault();
    const ids = [...modelDraft];
    if (ids.length < 2) {
      $("inventoryModelsStatus").textContent = "Selecciona al menos dos equipos.";
      return;
    }
    if (links.some(link => !ids.includes(link.modelId))) {
      $("inventoryModelsStatus").textContent = "Quita los repuestos vinculados a un equipo antes de retirarlo de la selección.";
      return;
    }
    selectedModels = ids;
    assigningModel = "";
    picker.hidden = true;
    renderPicker();
    modelsDialog.close();
    selectedModelsList.querySelector("[data-assign-stock]")?.focus();
  };

  function resetModels() {
    modelFilter.innerHTML = '<option value="">Selecciona un equipo</option>' + catalogModels
      .filter(model => model.brand === brandFilter.value)
      .map(model => `<option value="${esc(model.id)}">${esc(modelLabel(model))}</option>`).join("");
    modelFilter.value = "";
    modelFilter.disabled = !brandFilter.value;
    search.value = "";
    renderPicker();
  }

  function openPicker() {
    picker.hidden = false;
    brandFilter.value = "";
    resetModels();
    brandFilter.focus();
  }

  function updateStockMode() {
    quantity.disabled = untracked.checked || $("inventoryStock").hidden;
    quantity.closest("label").hidden = untracked.checked;
  }

  function open(record) {
    if (!window.CatalogSync.canWrite || !inventoryReady || inventoryWriting) return;
    editing = record?.id ?? null;
    editingVersion = record?.version ?? 0;
    links = [...(record?.links || [])];
    assigningModel = "";
    form.reset();
    shared.checked = record?.shared === true || links.length > 1;
    selectedModels = shared.checked
      ? [...new Set(links.map(link => link.modelId))].filter(id => catalogModels.some(model => model.id === id))
      : [];
    untracked.checked = record?.quantity === null;
    quantity.value = record?.quantity ?? 1;
    $("inventoryDialogTitle").textContent = editing ? "Editar inventario" : "Agregar a inventario";
    $("inventorySave").textContent = editing ? "Guardar cambios" : "Agregar a inventario";
    formStatus.textContent = "";
    dialog.showModal();
    if (links.length) {
      picker.hidden = true;
      renderPicker();
      shared.focus();
    } else {
      openPicker();
      shared.focus();
    }
  }

  $("inventoryAdd").onclick = () => open();
  inventorySearch.oninput = renderInventory;
  inventoryBrand.onchange = renderInventory;
  $("inventoryCancel").onclick = () => dialog.close();
  $("inventoryList").onclick = async event => {
    if (!window.CatalogSync.canWrite || !inventoryReady || inventoryWriting) return;
    const remove = event.target.closest("[data-delete-stock]");
    if (remove) {
      const id = remove.dataset.deleteStock;
      const record = records().find(entry => entry.id === id);
      if (!record) return;
      const name = currentPart(record.links[0]).name;
      const message = record.links.length > 1
        ? `¿Eliminar «${name}» del inventario? Se quitará de todos sus equipos vinculados.`
        : `¿Eliminar «${name}» del inventario?`;
      if (!window.confirm(message)) return;
      inventoryWriting = true;
      remove.disabled = true;
      try {
        await inventoryLoading;
        await window.CatalogSync.removeInventory(id, record.version);
        cacheInventory(records().filter(entry => entry.id !== id));
        lastInventoryRead = 0;
      } catch (error) {
        $("inventoryStatus").textContent = inventoryError(error);
        return;
      } finally {
        inventoryWriting = false;
        remove.disabled = false;
        if (!inventoryReady) syncInventory(true);
      }
      renderInventory();
      $("inventoryStatus").textContent = "Repuesto eliminado del inventario.";
      $("inventoryListSearch").focus();
      return;
    }
    const button = event.target.closest("[data-edit-stock]");
    if (button) open(records().find(record => record.id === button.dataset.editStock));
  };
  untracked.onchange = updateStockMode;
  shared.onchange = () => {
    if (!shared.checked && new Set(links.map(link => link.modelId)).size > 1) {
      shared.checked = true;
      formStatus.textContent = "Quita los vínculos adicionales para dejar un solo equipo.";
      return;
    }
    formStatus.textContent = "";
    if (shared.checked) {
      openModelsDialog();
      return;
    }
    selectedModels = [];
    assigningModel = "";
    if (!links.length) openPicker();
    else {
      picker.hidden = true;
      renderPicker();
    }
  };
  addLink.onclick = openModelsDialog;
  $("inventoryCancelAssignment").onclick = () => {
    assigningModel = "";
    picker.hidden = true;
    renderPicker();
    selectedModelsList.querySelector("[data-assign-stock]")?.focus();
  };
  brandFilter.onchange = resetModels;
  modelFilter.onchange = () => {
    search.value = "";
    preparePicker(modelFilter.value);
    if (!search.disabled) search.focus();
  };
  search.oninput = renderPicker;
  form.onsubmit = async event => {
    event.preventDefault();
    if (!window.CatalogSync.canWrite) return;
    if ($("inventorySave").disabled) return;
    if (!links.length) {
      formStatus.textContent = "Vincula al menos una pieza del catálogo.";
      return;
    }
    const count = untracked.checked ? null : quantity.valueAsNumber;
    if (count !== null && (!Number.isSafeInteger(count) || count < 0)) return;
    const stock = records();
    if (stock.some(record => record.id !== editing && record.links.some(link => links.some(part => part.id === link.id)))) {
      formStatus.textContent = "Una de las piezas ya está en inventario. Edita su registro para agregar compatibilidades.";
      return;
    }
    const id = editing || crypto.randomUUID();
    inventoryWriting = true;
    $("inventorySave").disabled = true;
    try {
      await inventoryLoading;
      const record = await window.CatalogSync.saveInventory(
        { id, quantity: count, shared: shared.checked, links: links.map(currentPart) }, editingVersion
      );
      cacheInventory([
        ...records().filter(record => record.id !== id),
        record,
      ]);
      lastInventoryRead = 0;
    } catch (error) {
      formStatus.textContent = inventoryError(error);
      return;
    } finally {
      inventoryWriting = false;
      renderPicker();
      if (!inventoryReady) syncInventory(true);
    }
    dialog.close();
    renderInventory();
    $("inventoryStatus").textContent = "Registro guardado en el inventario compartido.";
  };

  let referencesLoading;
  async function refreshReferences(force = false) {
    if (!window.CatalogSync.active || referencesLoading) return referencesLoading;
    const version = sessionVersion;
    const relevant = new Set(records().flatMap(record => record.links.map(link => link.modelId)));
    if (dialog.open && modelFilter.value) relevant.add(modelFilter.value);
    referencesLoading = Promise.allSettled([...relevant].map(id => indexModel(id, force))).then(results => {
      if (version !== sessionVersion) return;
      if (results.some(result => result.status === 'rejected')) $("inventoryStatus").textContent =
        "Algunos nombres compartidos no se pudieron actualizar. Se conservan los datos disponibles.";
      if (!$("inventoryView").hidden) renderInventory();
      if (dialog.open) renderPicker();
    }).finally(() => { if (version === sessionVersion) referencesLoading = null; });
    return referencesLoading;
  }
  function preparePicker(modelId) {
    pickerErrors.delete(modelId);
    renderPicker();
    if (!modelId) return;
    indexModel(modelId, true).catch(() => pickerErrors.add(modelId)).finally(() => {
      if (dialog.open) renderPicker();
    });
  }
  function refresh() {
    renderInventory();
    syncInventory();
    refreshReferences();
  }

  window.addEventListener("catalog-session-ready", () => {
    sessionVersion++;
    matrixChanges = undefined;
    matrixRefreshedAt = 0;
    loading = null;
    inventoryLoading = null;
    inventoryReady = false;
    lastInventoryRead = 0;
    indexes.clear();
    referencesLoading = null;
    syncInventory(true);
    if (!$("inventoryView").hidden) refresh();
  });
  window.addEventListener("focus", () => {
    if (!$("inventoryView").hidden) syncInventory(true);
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && !$("inventoryView").hidden) syncInventory(true);
  });
  window.addEventListener("online", () => syncInventory(true));
  setInterval(() => {
    if (!document.hidden && !$("inventoryView").hidden) syncInventory();
  }, 5000);
  window.addEventListener("catalog-data-changed", () => {
    if (!$("inventoryView").hidden || dialog.open) refreshReferences(true);
  });
  return refresh;
};
