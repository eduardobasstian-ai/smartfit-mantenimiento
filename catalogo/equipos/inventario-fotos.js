window.createCatalogInventoryPhotos = () => {
  const cache = new Map();
  const pending = new Map();
  const queue = [];
  let active = 0;
  let generation = 0;
  let sources = new Map();
  let fullUrl;
  const preview = document.getElementById('photoPreviewDialog');
  const previewImage = document.getElementById('photoPreviewImage');

  function trimOriginals() {
    const originals = [...cache.values()].filter(entry => entry.blob).sort((a, b) => b.used - a.used);
    let bytes = 0;
    originals.forEach((entry, index) => {
      bytes += entry.blob.size;
      if (index >= 32 || bytes > 32 * 1024 * 1024) entry.blob = null;
    });
  }
  async function thumbnail(blob) {
    let bitmap;
    let sourceUrl;
    try {
      if (window.createImageBitmap) bitmap = await createImageBitmap(blob);
      else {
        const img = new Image();
        sourceUrl = URL.createObjectURL(blob);
        img.src = sourceUrl;
        await img.decode();
        bitmap = img;
      }
      const width = bitmap.width || bitmap.naturalWidth;
      const height = bitmap.height || bitmap.naturalHeight;
      const scale = Math.min(1, 144 / Math.max(width, height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      return await new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Sin miniatura')), 'image/webp', 0.86));
    } finally {
      bitmap?.close?.();
      if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    }
  }
  async function load(id, source) {
    const existing = cache.get(id);
    if (existing) return existing;
    if (pending.has(id)) return pending.get(id);
    const started = generation;
    const task = (async () => {
      const blob = await window.CatalogSync.forModel(source.modelId).readPhoto(source.key, source.version);
      if (!blob || started !== generation) return null;
      const small = await thumbnail(blob);
      if (started !== generation) return null;
      const entry = { blob, thumbnail: URL.createObjectURL(small), used: Date.now() };
      cache.set(id, entry);
      trimOriginals();
      return entry;
    })().finally(() => { if (pending.get(id) === task) pending.delete(id); });
    pending.set(id, task);
    return task;
  }
  function paint(button, entry) {
    if (!button.isConnected || !entry) return;
    const image = document.createElement('img');
    image.src = entry.thumbnail;
    image.alt = '';
    image.width = 56;
    image.height = 56;
    image.decoding = 'async';
    button.replaceChildren(image);
    button.disabled = false;
    button.setAttribute('aria-label', 'Ampliar foto de ' + button.dataset.photoLabel);
  }
  function pump() {
    while (active < 3 && queue.length) {
      const { button, id, source, revision } = queue.shift();
      if (!button.isConnected || revision !== generation) continue;
      active++;
      load(id, source).then(entry => {
        if (revision === generation) paint(button, entry);
      }).catch(() => {}).finally(() => { active--; pump(); });
    }
  }
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      observer.unobserve(entry.target);
      const id = entry.target.dataset.inventoryPhoto;
      const source = sources.get(id);
      if (source) queue.push({ button: entry.target, id, source, revision: generation });
    }
    pump();
  }, { rootMargin: '120px' });

  function clear() {
    generation++;
    queue.length = 0;
    observer.disconnect();
    cache.forEach(entry => URL.revokeObjectURL(entry.thumbnail));
    cache.clear();
    pending.clear();
    sources.clear();
    if (previewImage.hasAttribute('data-inventory-photo')) preview.close();
  }
  preview.addEventListener('close', () => {
    if (!previewImage.hasAttribute('data-inventory-photo')) return;
    previewImage.removeAttribute('src');
    previewImage.removeAttribute('data-inventory-photo');
    if (fullUrl) URL.revokeObjectURL(fullUrl);
    fullUrl = null;
  });
  window.addEventListener('catalog-session-ready', clear);
  window.addEventListener('pagehide', event => { if (!event.persisted) clear(); });
  const retryVisible = () => {
    if (document.hidden || document.getElementById('inventoryView').hidden) return;
    for (const button of document.querySelectorAll('#inventoryList [data-inventory-photo]')) {
      if (!button.querySelector('img') && sources.has(button.dataset.inventoryPhoto)) observer.observe(button);
    }
  };
  window.addEventListener('online', retryVisible);
  window.addEventListener('focus', retryVisible);
  return {
    watch(list, nextSources) {
      observer.disconnect();
      queue.length = 0;
      sources = nextSources;
      for (const button of list.querySelectorAll('[data-inventory-photo]')) {
        const entry = cache.get(button.dataset.inventoryPhoto);
        if (entry) paint(button, entry);
        else observer.observe(button);
      }
    },
    async open(button) {
      const id = button.dataset.inventoryPhoto;
      const source = sources.get(id);
      const revision = generation;
      if (!source) return;
      button.setAttribute('aria-busy', 'true');
      try {
        const entry = await load(id, source);
        if (!entry) return;
        const blob = entry.blob || await window.CatalogSync.forModel(source.modelId).readPhoto(source.key, source.version);
        if (!blob || revision !== generation || !button.isConnected) return;
        entry.blob = blob;
        entry.used = Date.now();
        trimOriginals();
        if (fullUrl) URL.revokeObjectURL(fullUrl);
        fullUrl = URL.createObjectURL(blob);
        previewImage.src = fullUrl;
        previewImage.alt = button.dataset.photoLabel;
        previewImage.setAttribute('data-inventory-photo', '');
        preview.setAttribute('aria-label', 'Fotografía de ' + button.dataset.photoLabel);
        if (!preview.open) preview.showModal();
      } catch { /* La fila conserva su miniatura y permite reintentar. */ }
      finally { button.removeAttribute('aria-busy'); }
    },
  };
};
