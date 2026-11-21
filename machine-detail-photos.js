(function (global) {
  "use strict";

  const pending = new Map();
  const previews = new Map();
  const previewBudget = 8 * 1024 * 1024;
  let cacheSize = 0;
  const roots = new WeakMap();

  function rememberPreview(image) {
    const original = image.closest("[data-enlarge-image]")?.dataset.enlargeImage;
    if (!original?.startsWith("data:image/") || image.getAttribute("src") !== original ||
        previews.has(original) || Math.max(image.naturalWidth, image.naturalHeight) <= 160) return;
    const scale = 160 / Math.max(image.naturalWidth, image.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const preview = canvas.toDataURL("image/webp", 0.82);
    const size = original.length + preview.length;
    if (preview.length >= original.length || size > previewBudget) return;
    while (cacheSize + size > previewBudget) {
      const oldest = previews.keys().next().value;
      cacheSize -= oldest.length + previews.get(oldest).length;
      previews.delete(oldest);
    }
    previews.set(original, preview);
    cacheSize += size;
  }

  function buttons(images, escapeHtml) {
    return images.slice(0, 4).map((src, i) => {
      const url = escapeHtml(src);
      const preview = previews.get(src);
      return `<button class="maintenance-image-thumb" type="button" data-enlarge-image="${url}" data-image-alt="Imagen adjunta al mantenimiento" aria-label="Ampliar imagen adjunta"><img src="${preview ? escapeHtml(preview) : url}" alt="Imagen adjunta ${i + 1}" loading="lazy" decoding="async"></button>`;
    }).join("");
  }

  function markup(key, entry, escapeHtml) {
    const images = entry.images || [];
    return `<div class="machine-log-photos" data-media-machine="${escapeHtml(key)}" data-media-entry="${escapeHtml(entry.id)}" ${images.length ? "" : "hidden"}>${buttons(images, escapeHtml)}</div>`;
  }

  function load(root, key, escapeHtml, refresh = true) {
    let state = roots.get(root);
    if (!state) {
      state = { key, checked: new Set() };
      roots.set(root, state);
      root.addEventListener("load", event => {
        const image = event.target;
        if (image.matches?.(".machine-log-photos[data-media-machine] img")) {
          if (state.firstRead != null && image.closest("[data-media-machine]").dataset.mediaMachine === state.key) {
            global.dispatchEvent(new CustomEvent("smartfit:first-maintenance-thumbnail", { detail: state.firstRead }));
            state.firstRead = null;
          }
          rememberPreview(image);
        }
      }, true);
    }
    state.observer?.disconnect();
    if (state.key !== key || refresh) {
      state.checked.clear();
      state.firstRead = null;
      state.startedTiming = false;
    }
    state.key = key;
    const galleries = new Map();
    for (const gallery of root.querySelectorAll("[data-media-machine]")) {
      if (gallery.dataset.mediaMachine === key) galleries.set(gallery.dataset.mediaEntry, gallery);
    }

    function read(id) {
      if (!state.startedTiming) {
        state.startedTiming = true;
        state.firstRead = performance.now();
      }
      const legacyId = `${key}::maintenance::${id}`;
      const show = images => {
        const target = galleries.get(id);
        if (!target?.isConnected || !images?.length) return;
        const existing = target.querySelectorAll("[data-enlarge-image]");
        if (existing.length === images.length && images.every((src, i) => src === existing[i].dataset.enlargeImage)) return;
        target.innerHTML = buttons(images, escapeHtml);
        target.hidden = false;
      };
      let request = pending.get(legacyId);
      if (!request) {
        request = global.SmartFitSupabaseData.loadMachineRecordMedia(key, id, show)
          .finally(() => pending.delete(legacyId));
        pending.set(legacyId, request);
      }
      request.then(result => {
        show(result.images[legacyId]);
        if (result.warning) console.warn("No se pudieron actualizar las fotos del registro.", result.warning);
        else if (galleries.get(id)?.isConnected) state.checked.add(id);
      }).catch(error => console.warn("No se pudieron cargar las fotos del registro.", error));
    }

    const targets = new Map();
    for (const [id, gallery] of galleries) {
      if (!state.checked.has(id)) targets.set(gallery.closest(".machine-log-entry") || gallery, id);
    }
    if (!targets.size) return;
    if (!global.IntersectionObserver) {
      targets.forEach(read);
      return;
    }
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting || !entry.target.isConnected) continue;
        observer.unobserve(entry.target);
        read(targets.get(entry.target));
      }
    }, { rootMargin: "180px 0px" });
    state.observer = observer;
    targets.forEach((id, target) => observer.observe(target));
  }

  global.SmartFitMachinePhotos = { markup, load };
})(window);
