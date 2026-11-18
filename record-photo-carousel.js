(function (global) {
  "use strict";

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const PHOTO_GROUPS = ".maintenance-image-list, .machine-log-photos, .ticket-detail-photos, .ticket-history-detail-photos, .inspection-photo-list";
  const PHOTO_ITEMS = "[data-enlarge-image], [data-history-image], [data-ticket-enlarge]";

  function create(options) {
    const root = options.root || document;
    const $ = id => root.getElementById(id);
    const overlay = $(options.overlayId);
    const frame = $(options.frameId);
    const originalImage = $(options.imageId);
    const downloadButton = $(options.downloadButtonId);
    const viewport = $(options.viewportId);
    const track = $(options.trackId);
    if (!overlay || !frame || !originalImage || !downloadButton || !viewport || !track) throw new Error("Faltan elementos del carrusel de fotografías.");

    let photos = [];
    let index = 0;
    let scale = 1;
    let offsetX = 0;
    let offsetY = 0;
    let startPoint = null;
    let pointerId = null;
    let activePointers = new Map();
    let gestureType = "";
    let pinchStart = null;
    let mouseStartPoint = null;
    let mousePanning = false;
    let lastTap = 0;
    let normalizeAfterTransition = false;

    function activePhysicalIndex() { return index + 1; }

    function activeImage() {
      return track.children[activePhysicalIndex()]?.querySelector("img") || null;
    }

    function positionTrack(animate = false, dragX = 0, physicalIndex = activePhysicalIndex()) {
      track.style.transition = animate ? "transform 230ms cubic-bezier(.2,.75,.25,1)" : "none";
      track.style.transform = `translate3d(${-physicalIndex * viewport.clientWidth + dragX}px, 0, 0)`;
    }

    function fitSlide(image) {
      if (!image?.naturalWidth || !image.naturalHeight) return null;
      const maxWidth = Math.min(window.innerWidth * 0.94, 1400);
      const maxHeight = Math.min(window.innerHeight * 0.92, 1000);
      const fit = Math.min(maxWidth / image.naturalWidth, maxHeight / image.naturalHeight);
      const size = {
        width: Math.max(1, Math.floor(image.naturalWidth * fit)),
        height: Math.max(1, Math.floor(image.naturalHeight * fit))
      };
      image.style.width = `${size.width}px`;
      image.style.height = `${size.height}px`;
      image.style.transformOrigin = "center center";
      image.style.transition = "transform 120ms ease-out";
      return size;
    }

    function sizeFrameToSlide(image) {
      const size = fitSlide(image);
      if (!size) return;
      frame.style.width = `${size.width}px`;
      frame.style.height = `${size.height}px`;
    }

    function fitImages() {
      [...track.children].forEach((slide, physicalIndex) => {
        const image = slide.querySelector("img");
        fitSlide(image);
        if (physicalIndex === activePhysicalIndex()) sizeFrameToSlide(image);
      });
      applyZoom();
    }

    function applyZoom() {
      const image = activeImage();
      if (!image) return;
      const maxX = Math.max(0, (frame.clientWidth || image.clientWidth) * (scale - 1) / 2);
      const maxY = Math.max(0, (frame.clientHeight || image.clientHeight) * (scale - 1) / 2);
      offsetX = clamp(offsetX, -maxX, maxX);
      offsetY = clamp(offsetY, -maxY, maxY);
      image.style.transform = `translate3d(${offsetX}px, ${offsetY}px, 0) scale(${scale})`;
      viewport.style.cursor = scale > 1 ? (mousePanning ? "grabbing" : "grab") : "grab";
    }

    function resetZoom() {
      scale = 1;
      offsetX = 0;
      offsetY = 0;
      applyZoom();
    }

    function setScale(nextScale, centerDeltaX = 0, centerDeltaY = 0) {
      scale = clamp(nextScale, 1, 4);
      if (scale === 1) { offsetX = 0; offsetY = 0; }
      else { offsetX += centerDeltaX; offsetY += centerDeltaY; }
      applyZoom();
    }

    function render() {
      track.replaceChildren();
      const items = [photos[photos.length - 1], ...photos, photos[0]];
      items.forEach((photo, physicalIndex) => {
        const slide = document.createElement("div");
        slide.className = "record-photo-carousel-slide";
        const isCurrent = physicalIndex === activePhysicalIndex();
        slide.setAttribute("aria-hidden", String(!isCurrent));
        const image = document.createElement("img");
        image.alt = photo.alt || "Fotografía adjunta al registro";
        image.draggable = false;
        image.addEventListener("load", () => {
          fitSlide(image);
          if (physicalIndex === activePhysicalIndex()) sizeFrameToSlide(image);
        }, { once: true });
        image.addEventListener("error", () => removeUnavailablePhoto(photo.src), { once: true });
        image.src = photo.src;
        slide.append(image);
        track.append(slide);
      });
      fitImages();
      positionTrack(false);
    }

    function openFromTrigger(trigger, src, alt) {
      const group = trigger?.closest?.(PHOTO_GROUPS);
      const groupItems = group ? [...group.querySelectorAll(PHOTO_ITEMS)].map(node => ({
        src: node.dataset.enlargeImage || node.dataset.historyImage || node.dataset.ticketEnlarge || node.currentSrc || node.src || "",
        alt: node.dataset.imageAlt || node.alt || alt || "Fotografía adjunta al registro"
      })).filter(photo => photo.src) : [];
      const source = src || trigger?.dataset?.enlargeImage || trigger?.dataset?.historyImage || trigger?.dataset?.ticketEnlarge || trigger?.currentSrc || trigger?.src || "";
      const items = groupItems.length ? groupItems : (source ? [{ src: source, alt: alt || trigger?.dataset?.imageAlt || trigger?.alt || "Fotografía" }] : []);
      if (!items.length) return false;
      const resolve = value => { try { return new URL(value, document.baseURI).href; } catch (error) { return value; } };
      const targetIndex = items.findIndex(photo => resolve(photo.src) === resolve(source));
      photos = items;
      index = Math.max(0, targetIndex);
      scale = 1;
      offsetX = 0;
      offsetY = 0;
      startPoint = null;
      pointerId = null;
      activePointers.clear();
      gestureType = "";
      pinchStart = null;
      mouseStartPoint = null;
      mousePanning = false;
      normalizeAfterTransition = false;
      originalImage.hidden = true;
      downloadButton.hidden = false;
      viewport.hidden = false;
      frame.classList.add("has-record-photo-carousel");
      overlay.hidden = false;
      render();
      return true;
    }

    function close() {
      photos = [];
      index = 0;
      scale = 1;
      offsetX = 0;
      offsetY = 0;
      startPoint = null;
      pointerId = null;
      activePointers.clear();
      gestureType = "";
      pinchStart = null;
      mouseStartPoint = null;
      mousePanning = false;
      normalizeAfterTransition = false;
      track.replaceChildren();
      track.style.transition = "none";
      track.style.transform = "translate3d(0, 0, 0)";
      frame.style.removeProperty("width");
      frame.style.removeProperty("height");
      viewport.style.cursor = "";
      viewport.hidden = true;
      downloadButton.hidden = true;
      originalImage.hidden = false;
      frame.classList.remove("has-record-photo-carousel");
    }

    function step(direction) {
      if (photos.length < 2) return;
      resetZoom();
      const physicalTarget = activePhysicalIndex() + direction;
      index = (index + direction + photos.length) % photos.length;
      normalizeAfterTransition = physicalTarget === 0 || physicalTarget === photos.length + 1;
      sizeFrameToSlide(track.children[physicalTarget]?.querySelector("img"));
      positionTrack(true, 0, physicalTarget);
      [...track.children].forEach((slide, physicalIndex) => slide.setAttribute("aria-hidden", String(physicalIndex !== activePhysicalIndex())));
    }

    function removeUnavailablePhoto(source) {
      const resolve = value => { try { return new URL(value, document.baseURI).href; } catch (error) { return value; } };
      const failed = resolve(source);
      if (!photos.some(photo => resolve(photo.src) === failed)) return;
      const currentSource = photos[index]?.src;
      photos = photos.filter(photo => resolve(photo.src) !== failed);
      if (!photos.length) { close(); overlay.hidden = true; return; }
      const currentIndex = photos.findIndex(photo => resolve(photo.src) === resolve(currentSource));
      index = currentIndex >= 0 ? currentIndex : 0;
      resetZoom();
      render();
    }

    const pointerPoint = event => ({ x: event.clientX, y: event.clientY });
    const distanceBetween = (first, second) => Math.hypot(first.x - second.x, first.y - second.y);
    const centerBetween = (first, second) => ({ x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 });

    viewport.addEventListener("pointerdown", event => {
      if (event.pointerType === "mouse" || photos.length === 0) return;
      viewport.setPointerCapture?.(event.pointerId);
      activePointers.set(event.pointerId, pointerPoint(event));
      if (activePointers.size >= 2) {
        const points = [...activePointers.values()].slice(0, 2);
        const center = centerBetween(points[0], points[1]);
        pinchStart = { distance: distanceBetween(points[0], points[1]), scale, center, x: offsetX, y: offsetY };
        gestureType = "pinch";
        startPoint = null;
      } else {
        pointerId = event.pointerId;
        startPoint = pointerPoint(event);
        gestureType = scale > 1 ? "pan" : "swipe";
      }
    });

    viewport.addEventListener("pointermove", event => {
      if (!activePointers.has(event.pointerId)) return;
      const point = pointerPoint(event);
      activePointers.set(event.pointerId, point);
      if (gestureType === "pinch" && activePointers.size >= 2 && pinchStart) {
        const points = [...activePointers.values()].slice(0, 2);
        const center = centerBetween(points[0], points[1]);
        const nextScale = pinchStart.scale * distanceBetween(points[0], points[1]) / Math.max(1, pinchStart.distance);
        scale = clamp(nextScale, 1, 4);
        offsetX = pinchStart.x + center.x - pinchStart.center.x;
        offsetY = pinchStart.y + center.y - pinchStart.center.y;
        event.preventDefault();
        applyZoom();
        return;
      }
      if (event.pointerId !== pointerId || !startPoint) return;
      const deltaX = point.x - startPoint.x;
      const deltaY = point.y - startPoint.y;
      if (gestureType === "pan") {
        offsetX += deltaX;
        offsetY += deltaY;
        startPoint = point;
        event.preventDefault();
        applyZoom();
      } else if (Math.abs(deltaX) > Math.abs(deltaY) * 0.8) {
        event.preventDefault();
        positionTrack(false, deltaX);
      }
    });

    function finishPointer(event) {
      if (!activePointers.has(event.pointerId)) return;
      const point = pointerPoint(event);
      const wasPinching = gestureType === "pinch" || activePointers.size > 1;
      const wasSwipe = gestureType === "swipe" && event.pointerId === pointerId && startPoint;
      const deltaX = wasSwipe ? point.x - startPoint.x : 0;
      const deltaY = wasSwipe ? point.y - startPoint.y : 0;
      activePointers.delete(event.pointerId);
      if (wasSwipe && Math.abs(deltaX) >= 48 && Math.abs(deltaX) > Math.abs(deltaY) * 1.15) step(deltaX < 0 ? 1 : -1);
      else if (wasSwipe) positionTrack(true);
      if (!wasPinching && wasSwipe && Math.abs(deltaX) < 10 && Math.abs(deltaY) < 10) {
        const now = Date.now();
        if (now - lastTap < 320) { setScale(scale > 1 ? 1 : 2.2); lastTap = 0; }
        else lastTap = now;
      }
      if (activePointers.size === 1 && wasPinching) {
        const [remainingId, remainingPoint] = [...activePointers.entries()][0];
        pointerId = remainingId;
        startPoint = remainingPoint;
        gestureType = scale > 1 ? "pan" : "ignore";
      } else if (activePointers.size === 0) {
        pointerId = null;
        startPoint = null;
        pinchStart = null;
        gestureType = "";
      }
    }

    viewport.addEventListener("pointerup", finishPointer);
    viewport.addEventListener("pointercancel", finishPointer);

    viewport.addEventListener("wheel", event => {
      if (overlay.hidden || viewport.hidden) return;
      event.preventDefault();
      const factor = event.deltaY < 0 ? 1.15 : 0.87;
      setScale(scale * factor);
    }, { passive: false });
    viewport.addEventListener("dblclick", event => {
      event.preventDefault();
      setScale(scale > 1 ? 1 : 2.2);
    });

    viewport.addEventListener("mousedown", event => {
      if (event.button !== 0 || photos.length === 0) return;
      mouseStartPoint = { x: event.clientX, y: event.clientY };
      mousePanning = scale > 1;
      event.preventDefault();
    });
    document.addEventListener("mousemove", event => {
      if (!mouseStartPoint || overlay.hidden || viewport.hidden) return;
      const point = { x: event.clientX, y: event.clientY };
      const deltaX = point.x - mouseStartPoint.x;
      const deltaY = point.y - mouseStartPoint.y;
      if (mousePanning || scale > 1) {
        mousePanning = true;
        offsetX += deltaX;
        offsetY += deltaY;
        mouseStartPoint = point;
        applyZoom();
      } else if (Math.abs(deltaX) > Math.abs(deltaY) * 0.8) positionTrack(false, deltaX);
    });
    document.addEventListener("mouseup", event => {
      if (!mouseStartPoint) return;
      const deltaX = event.clientX - mouseStartPoint.x;
      const deltaY = event.clientY - mouseStartPoint.y;
      if (mousePanning) applyZoom();
      else if (Math.abs(deltaX) >= 48 && Math.abs(deltaX) > Math.abs(deltaY) * 1.15) step(deltaX < 0 ? 1 : -1);
      else positionTrack(true);
      mouseStartPoint = null;
      mousePanning = false;
    });

    async function downloadCurrentPhoto() {
      const photoIndex = index;
      const photo = photos[photoIndex];
      if (!photo?.src) return;
      const extensionFor = (blob, source) => {
        const mimeExtension = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/heic": "heic", "image/heif": "heif" };
        const mime = (blob.type || "").split(";")[0].toLowerCase();
        if (mimeExtension[mime]) return mimeExtension[mime];
        try {
          const extension = new URL(source, document.baseURI).pathname.split(".").pop().toLowerCase();
          if (/^(jpe?g|png|webp|gif|heic|heif)$/.test(extension)) return extension === "jpeg" ? "jpg" : extension;
        } catch (error) { /* Use jpg as the safe image fallback. */ }
        return "jpg";
      };
      const triggerDownload = (href, filename) => {
        const link = document.createElement("a");
        link.href = href;
        link.download = filename;
        link.rel = "noopener";
        document.body.append(link);
        link.click();
        link.remove();
      };
      const filename = `fotografia-registro-${photoIndex + 1}.${extensionFor({ type: "" }, photo.src)}`;
      try {
        const response = await fetch(photo.src, { mode: "cors", credentials: "omit" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const blob = await response.blob();
        const downloadUrl = URL.createObjectURL(blob);
        triggerDownload(downloadUrl, `fotografia-registro-${photoIndex + 1}.${extensionFor(blob, photo.src)}`);
        window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 30000);
      } catch (error) {
        triggerDownload(photo.src, filename);
      }
    }

    downloadButton.addEventListener("click", downloadCurrentPhoto);
    track.addEventListener("transitionend", event => {
      if (event.target !== track || event.propertyName !== "transform" || !normalizeAfterTransition) return;
      normalizeAfterTransition = false;
      positionTrack(false);
    });
    window.addEventListener("resize", () => {
      if (overlay.hidden || viewport.hidden) return;
      fitImages();
      positionTrack(false);
    });

    return { openFromTrigger, close };
  }

  global.SmartFitRecordPhotoCarousel = { create };
})(window);
