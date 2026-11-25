window.createCatalogPlanEditor = options => {
  const { getView, getRows, getNames, partFor, pieceKey, sync, refresh, canvas, marks, parts, detail, esc } = options;
  const root = document.createElement("div");
  root.innerHTML = `
    <div class="plan-context-menu" role="menu" aria-label="Editar plano" hidden>
      <button type="button" role="menuitem" data-action="reference">Editar referencia</button>
      <button type="button" role="menuitem" data-action="move">Mover marcador</button>
      <button type="button" role="menuitem" data-action="all">Editar referencias de esta vista</button>
    </div>
    <dialog class="plan-edit-dialog" aria-labelledby="planEditTitle">
      <form>
        <header><h2 id="planEditTitle">Editar referencias</h2>
          <button type="button" data-action="close" aria-label="Cerrar edición">×</button></header>
        <label class="plan-edit-filter">Buscar referencia
          <input type="search" placeholder="Ítem, nombre técnico, referencia o SAP" autocomplete="off">
        </label>
        <div class="plan-edit-rows"></div>
        <p class="plan-edit-status" role="status"></p>
        <footer><button class="btn" type="button" data-action="close">Cancelar</button>
          <button class="btn primary" type="submit">Guardar cambios</button></footer>
      </form>
    </dialog>`;
  document.body.append(root);
  const menu = root.querySelector('[role="menu"]');
  const dialog = root.querySelector("dialog");
  const form = root.querySelector("form");
  const search = root.querySelector('input[type="search"]');
  const list = root.querySelector(".plan-edit-rows");
  const status = root.querySelector(".plan-edit-status");
  const save = form.querySelector('[type="submit"]');
  const toolbar = document.createElement("div");
  toolbar.className = "marker-edit-toolbar";
  toolbar.hidden = true;
  toolbar.innerHTML = '<span>Arrastra los marcadores seleccionados y guarda sus posiciones.</span><button class="btn primary" type="button" data-action="save">Guardar posiciones</button><button class="btn" type="button" data-action="cancel">Cancelar</button>';
  canvas.parentElement.before(toolbar);
  const batchButton = document.createElement("button");
  batchButton.type = "button";
  batchButton.className = "btn";
  batchButton.textContent = "Editar referencias";
  batchButton.hidden = !sync.canWrite;
  parts.before(batchButton);
  let target;
  let drafts = [];
  let editingRows = [];
  let move;
  let drag;
  let saving = false;
  let returnFocus;
  const selected = new Set();
  addEventListener("beforeunload", event => { if (move || dialog.open) { event.preventDefault(); event.returnValue = ""; } });
  const normalize = value => String(value ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const original = part => window.catalogReferenceOriginal(part);
  const isAvailable = () => sync.active && sync.canWrite && !options.isBusy();
  let selectionView = getView().id;
  const expected = (rows, type, key) => rows.find(row => row.tipo === type && row.clave === key)?.valor ?? null;
  const partIdentity = part => JSON.stringify(original(part));
  const viewParts = () => {
    const view = getView();
    const bom = view.bom || (view.id === "general" ? options.data.bom : undefined);
    const markerItems = new Set(view.callouts.flatMap(marker => [marker.item, ...(marker.variantItems || [])]));
    const known = [...(bom || []), ...Object.values(view.parts || options.data.parts || {})];
    const missing = [...markerItems].filter(item => !known.some(part => part.item === item)).map(item => ({item}));
    return [...new Map([...known, ...missing]
      .filter(part => part?.item && !part.viewIds && (bom || markerItems.has(part.item)))
      .map(part => [partIdentity(part), part])).values()];
  };

  function hideMenu() {
    menu.hidden = true;
  }
  function showMenu(event, marker, reference) {
    if (!isAvailable() || move || dialog.open || saving) return;
    event.preventDefault();
    target = { marker, reference };
    returnFocus = event.target.closest("button") || batchButton;
    const moveButton = menu.querySelector('[data-action="move"]');
    moveButton.disabled = !marker;
    moveButton.textContent = marker && selected.has(marker.key) && selected.size > 1
      ? `Mover ${selected.size} marcadores` : "Mover marcador";
    menu.hidden = false;
    menu.style.left = Math.max(4, Math.min(event.clientX, innerWidth - menu.offsetWidth - 8)) + "px";
    menu.style.top = Math.max(4, Math.min(event.clientY, innerHeight - menu.offsetHeight - 8)) + "px";
    menu.querySelector("button").focus();
  }
  marks.addEventListener("contextmenu", event => {
    const button = event.target.closest(".hotspot");
    const marker = getView().callouts.find(entry => entry.key === button?.dataset.key);
    if (marker) showMenu(event, marker);
  });
  parts.addEventListener("contextmenu", event => {
    const row = event.target.closest("[data-edit-reference]");
    if (!row) return;
    const reference = viewParts().find(part => partIdentity(part) === row.dataset.editReference);
    if (reference) showMenu(event, null, reference);
  });
  detail.addEventListener("contextmenu", event => {
    const entry = options.getSelected();
    if (!entry) return;
    const marker = getView().callouts.find(marker => marker.key === entry.key);
    showMenu(event, marker, entry.part || partFor(entry.item));
  });
  menu.onclick = event => {
    const action = event.target.closest("[data-action]")?.dataset.action;
    if (!action) return;
    hideMenu();
    if (action === "all") openReferences();
    if (action === "reference") {
      const marker = target.marker;
      const rows = target.reference ? [target.reference]
        : viewParts().filter(part => part.item === marker.item || marker.variantItems?.includes(part.item));
      openReferences(rows);
    }
    if (action === "move") startMove(target.marker);
  };
  document.addEventListener("pointerdown", event => {
    if (!menu.hidden && !menu.contains(event.target)) hideMenu();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !menu.hidden) {
      event.preventDefault();
      hideMenu();
      returnFocus?.focus();
    }
    if (!menu.hidden && ["ArrowDown", "ArrowUp"].includes(event.key)) {
      event.preventDefault();
      const buttons = [...menu.querySelectorAll("button:not(:disabled)")];
      const index = buttons.indexOf(document.activeElement);
      buttons[(index + (event.key === "ArrowDown" ? 1 : buttons.length - 1)) % buttons.length].focus();
    }
  });
  addEventListener("scroll", hideMenu, true);
  addEventListener("resize", hideMenu);
  batchButton.onclick = () => openReferences();

  function renderRows() {
    const query = normalize(search.value);
    list.innerHTML = drafts.map((draft, index) => ({ draft, index }))
      .filter(({ draft }) => !query || [draft.part.item, draft.part.reference, draft.part.sap, draft.name]
        .some(value => normalize(value).includes(query)))
      .map(({ draft, index }) => `<fieldset data-row="${index}">
        <legend>Ítem ${esc(draft.original.item)} · ${esc(draft.original.reference || draft.original.sap || "")}</legend>
        ${[
          ["item", "Ítem"], ["name", "Nombre técnico"], ["reference", "Referencia"], ["sap", "SAP"],
          ["quantity", "Cantidad en el conjunto"], ["description", "Descripción"],
        ].map(([field, label]) => `<label>${label}
          <input data-field="${field}" type="${field === "quantity" ? "number" : "text"}"
            ${field === "quantity" ? 'min="0" step="1"' : 'maxlength="500"'}
            ${field === "item" ? 'required pattern="[A-Za-z0-9._-]+"' : ""}
            value="${esc(field === "name" ? draft.name : draft.part[field] ?? "")}">
        </label>`).join("")}</fieldset>`).join("") || '<p>Sin coincidencias.</p>';
  }
  function openReferences(references = viewParts()) {
    if (!isAvailable() || move || saving) return;
    editingRows = structuredClone(getRows());
    drafts = references.map(part => ({
      original: structuredClone(original(part)),
      part: structuredClone(part),
      before: JSON.stringify(part),
      name: options.getName ? options.getName(part) : getNames()[pieceKey(part.item, getView(), part)] || "",
      previousName: options.getName ? options.getName(part) : getNames()[pieceKey(part.item, getView(), part)] || "",
      identityKey: pieceKey(part.item, getView(), part),
    }));
    if (!drafts.length) return;
    search.value = "";
    status.textContent = "";
    renderRows();
    dialog.showModal();
  }
  list.oninput = event => {
    const field = event.target.dataset.field;
    const draft = drafts[Number(event.target.closest("[data-row]")?.dataset.row)];
    if (!draft || !field) return;
    if (field === "name") draft.name = event.target.value;
    else if (field === "quantity") draft.part.quantity = event.target.value === "" ? null : event.target.valueAsNumber;
    else draft.part[field] = event.target.value.trim();
  };
  search.oninput = renderRows;
  root.querySelectorAll('[data-action="close"]').forEach(button => {
    button.onclick = () => { if (!saving) dialog.close(); };
  });
  dialog.addEventListener("cancel", event => { if (saving) event.preventDefault(); });

  form.onsubmit = async event => {
    event.preventDefault();
    if (saving || !sync.canWrite) return;
    saving = true;
    save.disabled = true;
    status.textContent = "Guardando cambios…";
    try {
      const changes = [];
      for (const draft of drafts) {
        if (!/^[A-Z0-9._-]+$/i.test(draft.part.item) ||
            (draft.part.quantity != null && (!Number.isSafeInteger(draft.part.quantity) || draft.part.quantity < 0))) {
          throw new Error("Revisa los ítems y las cantidades de las referencias editadas.");
        }
        const identityKey = draft.identityKey;
        if (JSON.stringify(draft.part) !== draft.before) {
          const payload = new TextEncoder().encode(JSON.stringify([getView().id, draft.original]));
          const digest = await crypto.subtle.digest("SHA-256", payload);
          const key = "ref:" + [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, "0")).join("");
          changes.push({
            tipo: "referencia", clave: key, expected: expected(editingRows, "referencia", key),
            valor: { viewId: getView().id, original: draft.original,
              part: { ...draft.part, _catalogIdentityKey: identityKey } },
          });
        }
        if (draft.name !== draft.previousName) {
          const sharedKey = options.nameKey?.(draft.part);
          const key = sharedKey || identityKey;
          changes.push({ tipo: "nombre", clave: key, valor: draft.name.trim(), global: Boolean(sharedKey),
            expected: expected(editingRows, "nombre", key) });
        }
      }
      if (changes.length) {
        const unique = new Map();
        for (const change of changes) {
          const id = change.tipo + ":" + change.clave;
          const previous = unique.get(id);
          if (previous && JSON.stringify(previous.valor) !== JSON.stringify(change.valor)) throw new Error("La misma referencia tiene dos nombres distintos en el lote. Asigna un único nombre al repuesto.");
          unique.set(id,change);
        }
        await sync.edit([...unique.values()]);
      }
      dialog.close();
      await refresh();
    } catch (error) {
      status.textContent = error.message || "No se pudieron guardar los cambios.";
      if (error.code === "40001") options.onConflict();
    } finally {
      saving = false;
      save.disabled = false;
    }
  };

  function paintSelection() {
    if (selectionView !== getView().id) { selected.clear(); selectionView = getView().id; }
    marks.querySelectorAll(".hotspot").forEach(button => {
      button.classList.toggle("is-batch-selected", selected.has(button.dataset.key));
      button.classList.toggle("is-repositioning", Boolean(move?.originals.has(button.dataset.key)));
    });
  }
  marks.addEventListener("click", event => {
    const button = event.target.closest(".hotspot");
    if (!button || (!move && !event.shiftKey) || !sync.canWrite) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!move) {
      if (selected.has(button.dataset.key)) selected.delete(button.dataset.key);
      else selected.add(button.dataset.key);
      paintSelection();
    }
  }, true);
  function startMove(marker) {
    if (!marker || !isAvailable()) return;
    if (!selected.has(marker.key)) {
      selected.clear();
      selected.add(marker.key);
    }
    move = {
      viewId: getView().id,
      rows: structuredClone(getRows()),
      originals: new Map(getView().callouts.filter(entry => selected.has(entry.key))
        .map(entry => [entry.key, structuredClone(entry)])),
    };
    toolbar.hidden = false;
    toolbar.querySelector("span").textContent = "Arrastra los marcadores seleccionados y guarda sus posiciones.";
    paintSelection();
  }
  marks.addEventListener("pointerdown", event => {
    const button = event.target.closest(".hotspot");
    if (!move || saving || event.button !== 0 || !move.originals.has(button?.dataset.key)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY,
      origins: new Map(getView().callouts.filter(entry => move.originals.has(entry.key))
        .map(entry => [entry.key, { x: entry.x, y: entry.y }])) };
    button.setPointerCapture(event.pointerId);
  }, true);
  marks.addEventListener("pointermove", event => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const values = [...drag.origins.values()];
    const dx = Math.max(-Math.min(...values.map(p => p.x)),
      Math.min(100 - Math.max(...values.map(p => p.x)), (event.clientX - drag.x) / rect.width * 100));
    const dy = Math.max(-Math.min(...values.map(p => p.y)),
      Math.min(100 - Math.max(...values.map(p => p.y)), (event.clientY - drag.y) / rect.height * 100));
    const nodes = new Map([...marks.querySelectorAll(".hotspot")].map(button => [button.dataset.key, button]));
    for (const marker of getView().callouts) {
      const position = drag.origins.get(marker.key);
      if (!position) continue;
      marker.x = Number((position.x + dx).toFixed(4));
      marker.y = Number((position.y + dy).toFixed(4));
      nodes.get(marker.key)?.style.setProperty("--x", marker.x + "%");
      nodes.get(marker.key)?.style.setProperty("--y", marker.y + "%");
    }
  });
  const endDrag = () => { drag = null; };
  marks.addEventListener("pointerup", endDrag);
  marks.addEventListener("pointercancel", endDrag);
  marks.addEventListener("lostpointercapture", endDrag);
  toolbar.onclick = async event => {
    const action = event.target.closest("[data-action]")?.dataset.action;
    if (!action || !move || saving) return;
    if (action === "cancel") {
      for (const marker of getView().callouts) {
        const before = move.originals.get(marker.key);
        if (before) Object.assign(marker, before);
      }
      move = null;
      selected.clear();
      toolbar.hidden = true;
      options.redraw();
      return;
    }
    saving = true;
    toolbar.querySelectorAll("button").forEach(button => { button.disabled = true; });
    try {
      const changes = getView().callouts.filter(marker => {
        const before = move.originals.get(marker.key);
        return before && (before.x !== marker.x || before.y !== marker.y);
      }).map(marker => ({
        tipo: "marcador", clave: marker.key, expected: expected(move.rows, "marcador", marker.key),
        valor: { viewId: move.viewId, callout: { ...marker },
          part: partFor(marker.item) || { item: marker.item } },
      }));
      if (changes.length) await sync.edit(changes);
      move = null;
      selected.clear();
      toolbar.hidden = true;
      await refresh();
    } catch (error) {
      toolbar.querySelector("span").textContent = error.message;
      if (error.code === "40001") options.onConflict();
    } finally {
      saving = false;
      toolbar.querySelectorAll("button").forEach(button => { button.disabled = false; });
    }
  };
  let held;
  marks.addEventListener("pointerdown", event => {
    if (event.pointerType !== "touch" || move) return;
    held = setTimeout(() => {
      const button = event.target.closest(".hotspot");
      const marker = getView().callouts.find(entry => entry.key === button?.dataset.key);
      if (marker) showMenu(event, marker);
    }, 600);
  });
  for (const event of ["pointermove", "pointerup", "pointercancel"]) {
    marks.addEventListener(event, () => clearTimeout(held));
  }
  return {
    get busy() { return dialog.open || Boolean(move) || saving; },
    get moving() { return Boolean(move); },
    paint: paintSelection,
    setPermissions() { batchButton.hidden = !sync.canWrite; },
  };
};
