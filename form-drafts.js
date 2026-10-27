(function (global) {
  "use strict";

  var DATABASE = "smartfit-form-drafts";
  var STORE = "drafts";
  var PREFIX = "smartfit.form-draft.v1.";
  var databasePromise;
  var restoredForms = new WeakSet();

  function storageKey(key) { return PREFIX + encodeURIComponent(String(key)); }

  function fieldsFor(form) {
    var fields = {};
    form.querySelectorAll("input,textarea,select").forEach(function (field) {
      if (!field.id && !field.name) return;
      if (["password", "file", "submit", "button", "reset"].includes((field.type || "").toLowerCase())) return;
      if (field.disabled || field.type === "hidden") return;
      var name = field.name || field.id;
      if (field.type === "checkbox") fields[name] = field.checked;
      else if (field.type === "radio") {
        if (field.checked) fields[name] = field.value;
      } else fields[name] = field.value;
    });
    return fields;
  }

  function saveFields(key, fields) {
    try { localStorage.setItem(storageKey(key), JSON.stringify({ fields: fields, savedAt: Date.now() })); }
    catch (error) { console.warn("No se pudo guardar el borrador del formulario.", error); }
  }

  function readFields(key) {
    try {
      var saved = JSON.parse(localStorage.getItem(storageKey(key)) || "null");
      return saved && saved.fields && typeof saved.fields === "object" ? saved.fields : null;
    } catch (_error) { return null; }
  }

  function applyFields(form, fields) {
    if (!fields) return;
    form.querySelectorAll("input,textarea,select").forEach(function (field) {
      var name = field.name || field.id;
      if (!name || !(name in fields) || ["password", "file", "submit", "button", "reset", "hidden"].includes((field.type || "").toLowerCase())) return;
      if (field.type === "checkbox") field.checked = Boolean(fields[name]);
      else if (field.type === "radio") field.checked = field.value === fields[name];
      else field.value = fields[name];
    });
  }

  function openDatabase() {
    if (!global.indexedDB) return Promise.reject(new Error("IndexedDB no está disponible."));
    if (databasePromise) return databasePromise;
    databasePromise = new Promise(function (resolve, reject) {
      var request = global.indexedDB.open(DATABASE, 1);
      request.onupgradeneeded = function () {
        if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
      };
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error || new Error("No se pudo abrir el almacenamiento local.")); };
      request.onblocked = function () { reject(new Error("El almacenamiento local está ocupado.")); };
    }).catch(function (error) { databasePromise = null; throw error; });
    return databasePromise;
  }

  async function saveImages(key, images) {
    var imageKey = storageKey(key) + ".images";
    var values = Array.isArray(images) ? images.slice(0, 4) : [];
    try {
      var database = await openDatabase();
      await new Promise(function (resolve, reject) {
        var transaction = database.transaction(STORE, "readwrite");
        var store = transaction.objectStore(STORE);
        store.put(values, imageKey);
        transaction.oncomplete = resolve;
        transaction.onerror = function () { reject(transaction.error || new Error("No se pudieron conservar las fotos.")); };
        transaction.onabort = function () { reject(transaction.error || new Error("Se canceló el guardado de las fotos.")); };
      });
    } catch (error) { console.warn("No se pudieron conservar las fotos del borrador.", error); }
  }

  async function readImages(key) {
    try {
      var database = await openDatabase();
      return await new Promise(function (resolve, reject) {
        var request = database.transaction(STORE, "readonly").objectStore(STORE).get(storageKey(key) + ".images");
        request.onsuccess = function () { resolve(Array.isArray(request.result) ? request.result.slice(0, 4) : null); };
        request.onerror = function () { reject(request.error || new Error("No se pudieron recuperar las fotos.")); };
      });
    } catch (_error) { return []; }
  }

  async function clear(key) {
    try { localStorage.removeItem(storageKey(key)); } catch (_error) {}
    try {
      var database = await openDatabase();
      await new Promise(function (resolve) {
        var transaction = database.transaction(STORE, "readwrite");
        transaction.objectStore(STORE).delete(storageKey(key) + ".images");
        transaction.oncomplete = resolve;
        transaction.onerror = resolve;
        transaction.onabort = resolve;
      });
    } catch (_error) {}
  }

  function restoreImageMarkup(form, images) {
    var list = form.querySelector(".maintenance-image-list");
    if (!list || !Array.isArray(images)) return;
    var removeAttribute = form.id === "supervisorRaiseTicketForm" ? "data-remove-supervisor-ticket-image" : "data-remove-maintenance-image";
    list.replaceChildren();
    images.forEach(function (source, index) {
      var wrapper = document.createElement("div");
      wrapper.className = "maintenance-image-thumb-wrap";
      var previewButton = document.createElement("button");
      previewButton.type = "button";
      previewButton.className = "maintenance-image-thumb";
      previewButton.dataset.enlargeImage = source;
      previewButton.dataset.imageAlt = "Imagen adjunta al borrador";
      previewButton.setAttribute("aria-label", "Ampliar imagen adjunta");
      var image = document.createElement("img");
      image.src = source;
      image.alt = "Imagen adjunta " + (index + 1);
      image.loading = "lazy";
      previewButton.appendChild(image);
      var removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.className = "maintenance-image-remove";
      removeButton.textContent = "×";
      removeButton.setAttribute("aria-label", "Eliminar imagen " + (index + 1));
      removeButton.setAttribute(removeAttribute, String(index));
      wrapper.append(previewButton, removeButton);
      list.appendChild(wrapper);
    });
    var countButton = form.querySelector("[data-toggle-maintenance-image-menu], [data-toggle-supervisor-ticket-image-menu]");
    if (countButton) countButton.textContent = "Agregar imágenes (" + images.length + "/4)";
  }

  async function restoreForm(form) {
    if (restoredForms.has(form)) return;
    var key = form.dataset.smartfitDraftKey;
    if (!key) return;
    restoredForms.add(form);
    var fields = readFields(key);
    applyFields(form, fields);
    var images = await readImages(key);
    if (!form.isConnected || form.dataset.smartfitDraftKey !== key) return;
    if (images) restoreImageMarkup(form, images);
    if (fields || images) {
      global.dispatchEvent(new CustomEvent("smartfit:form-draft-restored", {
        detail: { key: key, form: form, fields: fields || {}, images: images }
      }));
    }
  }

  function restoreWithin(root) {
    if (root instanceof HTMLFormElement) restoreForm(root);
    if (root.querySelectorAll) root.querySelectorAll("form[data-smartfit-draft-key]").forEach(restoreForm);
  }

  document.addEventListener("input", function (event) {
    var form = event.target.closest && event.target.closest("form[data-smartfit-draft-key]");
    if (form) saveFields(form.dataset.smartfitDraftKey, fieldsFor(form));
  }, true);
  document.addEventListener("change", function (event) {
    var form = event.target.closest && event.target.closest("form[data-smartfit-draft-key]");
    if (form) saveFields(form.dataset.smartfitDraftKey, fieldsFor(form));
  }, true);
  document.addEventListener("smartfit:form-draft-save-images", function (event) {
    var detail = event.detail || {};
    if (detail.key) saveImages(detail.key, detail.images);
  });
  document.addEventListener("smartfit:form-draft-clear", function (event) {
    var key = event.detail && event.detail.key;
    if (key) clear(key);
  });

  var observer = new MutationObserver(function (mutations) {
    mutations.forEach(function (mutation) {
      mutation.addedNodes.forEach(function (node) {
        if (node.nodeType === Node.ELEMENT_NODE) restoreWithin(node);
      });
    });
  });

  global.SmartFitFormDrafts = {
    readFields: readFields,
    saveFields: saveFields,
    saveImages: saveImages,
    readImages: readImages,
    clear: clear
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      restoreWithin(document);
      observer.observe(document.documentElement, { childList: true, subtree: true });
    }, { once: true });
  } else {
    restoreWithin(document);
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }
})(window);
