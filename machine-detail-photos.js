(function (global) {
  "use strict";

  const pending = new Map();

  function buttons(images, escapeHtml) {
    return images.slice(0, 4).map((src, i) => {
      const url = escapeHtml(src);
      return `<button class="maintenance-image-thumb" type="button" data-enlarge-image="${url}" data-image-alt="Imagen adjunta al mantenimiento" aria-label="Ampliar imagen adjunta"><img src="${url}" alt="Imagen adjunta ${i + 1}" decoding="async"></button>`;
    }).join("");
  }

  function markup(key, entry, escapeHtml) {
    const images = entry.images || [];
    return `<div class="machine-log-photos" data-media-machine="${escapeHtml(key)}" data-media-entry="${escapeHtml(entry.id)}" ${images.length ? "" : "hidden"}>${buttons(images, escapeHtml)}</div>`;
  }

  function load(root, key, escapeHtml) {
    const galleries = () => [...root.querySelectorAll("[data-media-machine]")].filter(el => el.dataset.mediaMachine === key);
    for (const gallery of galleries()) {
      const id = gallery.dataset.mediaEntry;
      const legacyId = `${key}::maintenance::${id}`;
      if (pending.has(legacyId)) continue;
      const show = images => {
        const target = galleries().find(el => el.dataset.mediaEntry === id);
        if (!target || !images?.length) return;
        const existing = target.querySelectorAll("[data-enlarge-image]");
        if (existing.length === images.length && images.every((src, i) => src === existing[i].dataset.enlargeImage)) return;
        target.innerHTML = buttons(images, escapeHtml);
        target.hidden = false;
      };
      const request = global.SmartFitSupabaseData.loadMachineRecordMedia(key, id, show)
        .then(result => {
          show(result.images[legacyId]);
          if (result.warning) console.warn("No se pudieron actualizar las fotos del registro.", result.warning);
        }).catch(error => console.warn("No se pudieron cargar las fotos del registro.", error))
        .finally(() => pending.delete(legacyId));
      pending.set(legacyId, request);
    }
  }

  global.SmartFitMachinePhotos = { markup, load };
})(window);
