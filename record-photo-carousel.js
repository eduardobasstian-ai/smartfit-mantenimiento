(function (global) {
  "use strict";

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const PHOTO_GROUPS = ".maintenance-image-list, .machine-log-photos, .ticket-detail-photos, .ticket-history-detail-photos";
  const PHOTO_ITEMS = "[data-enlarge-image], [data-history-image], [data-ticket-enlarge]";

  function create(options) {
    const $ = id => document.getElementById(id);
    const overlay = $(options.overlayId);
    const frame = $(options.frameId);
    const originalImage = $(options.imageId);
    const downloadButton = $(options.downloadButtonId);
    const viewport = $(options.viewportId);
    const track = $(options.trackId);
    if (!overlay || !frame || !originalImage || !downloadButton || !viewport || !track) throw new Error("Faltan elementos del carrusel de fotografías.");

    let photos = [];
    let index = 0;
    let startPoint = null;
    let pointerId = null;
    let mouseStartPoint = null;
    let normalizeAfterTransition = false;

    function activePhysicalIndex() { return index + 1; }

    function positionTrack(animate = false, dragX = 0, physicalIndex = activePhysicalIndex()) {
      track.style.transition = animate ? "transform 230ms cubic-bezier(.2,.75,.25,1)" : "none";
      track.style.transform = `translate3d(${-physicalIndex * viewport.clientWidth + dragX}px, 0, 0)`;
    }

    function fitSlide(slide, image) {
      if (!image.naturalWidth || !image.naturalHeight) return null;
      const maxWidth = Math.min(window.innerWidth * 0.94, 1400);
      const maxHeight = Math.min(window.innerHeight * 0.92, 1000);
      const scale = Math.min(maxWidth / image.naturalWidth, maxHeight / image.naturalHeight);
      const size = {
        width: Math.max(1, Math.floor(image.naturalWidth * scale)),
        height: Math.max(1, Math.floor(image.naturalHeight * scale))
      };
      image.style.width = `${size.width}px`;
      image.style.height = `${size.height}px`;
      return size;
    }

    function sizeFrameToSlide(slide) {
      const image = slide?.querySelector("img");
      if (!image?.naturalWidth || !image.naturalHeight) return;
      const size = fitSlide(slide, image);
      if (!size) return;
      frame.style.width = `${size.width}px`;
      frame.style.height = `${size.height}px`;
    }

    function fitImages() {
      [...track.children].forEach((slide, physicalIndex) => {
        const image = slide.querySelector("img");
        if (!image) return;
        fitSlide(slide, image);
        if (physicalIndex === activePhysicalIndex()) sizeFrameToSlide(slide);
      });
    }

    function render() {
      track.replaceChildren();
      const items = [photos[photos.length - 1], ...photos, photos[0]];
      items.forEach((photo, physicalIndex) => {
        const slide = document.createElement("div");
        slide.className = "record-photo-carousel-slide";
        slide.setAttribute("aria-hidden", physicalIndex === activePhysicalIndex() ? "false" : "true");
        const image = document.createElement("img");
        image.alt = photo.alt || "Fotografía adjunta al registro";
        image.draggable = false;
        image.addEventListener("load", () => {
          fitSlide(slide, image);
          if (physicalIndex === activePhysicalIndex()) sizeFrameToSlide(slide);
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
      if (!group) return false;
      const items = [...group.querySelectorAll(PHOTO_ITEMS)].map(node => ({
        src: node.dataset.enlargeImage || node.dataset.historyImage || node.dataset.ticketEnlarge || node.currentSrc || node.src || "",
        alt: node.dataset.imageAlt || node.alt || alt || "Fotografía adjunta al registro"
      })).filter(photo => photo.src);
      if (items.length < 2) return false;

      const resolve = value => { try { return new URL(value, document.baseURI).href; } catch (error) { return value; } };
      const targetSrc = src || trigger.dataset.enlargeImage || trigger.dataset.historyImage || trigger.dataset.ticketEnlarge || trigger.currentSrc || trigger.src;
      const targetIndex = items.findIndex(photo => resolve(photo.src) === resolve(targetSrc));
      photos = items;
      index = Math.max(0, targetIndex);
      startPoint = null;
      pointerId = null;
      mouseStartPoint = null;
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
      startPoint = null;
      pointerId = null;
      mouseStartPoint = null;
      normalizeAfterTransition = false;
      track.replaceChildren();
      track.style.transition = "none";
      track.style.transform = "translate3d(0, 0, 0)";
      frame.style.removeProperty("width");
      frame.style.removeProperty("height");
      viewport.hidden = true;
      downloadButton.hidden = true;
      originalImage.hidden = false;
      frame.classList.remove("has-record-photo-carousel");
    }

    function step(direction) {
      if (photos.length < 2) return;
      const physicalTarget = activePhysicalIndex() + direction;
      index = (index + direction + photos.length) % photos.length;
      normalizeAfterTransition = physicalTarget === 0 || physicalTarget === photos.length + 1;
      sizeFrameToSlide(track.children[physicalTarget]);
      positionTrack(true, 0, physicalTarget);
      [...track.children].forEach((slide, physicalIndex) => slide.setAttribute("aria-hidden", physicalIndex === activePhysicalIndex() ? "false" : "true"));
    }

    function removeUnavailablePhoto(source) {
      const resolve = value => { try { return new URL(value, document.baseURI).href; } catch (error) { return value; } };
      const failed = resolve(source);
      if (!photos.some(photo => resolve(photo.src) === failed)) return;
      const currentSource = photos[index]?.src;
      photos = photos.filter(photo => resolve(photo.src) !== failed);
      if (!photos.length) {
        close();
        overlay.hidden = true;
        return;
      }
      const currentIndex = photos.findIndex(photo => resolve(photo.src) === resolve(currentSource));
      index = currentIndex >= 0 ? currentIndex : 0;
      render();
    }

    viewport.addEventListener("pointerdown", event => {
      // El ratón se atiende con eventos mouse dedicados más abajo. Esto evita
      // que dos flujos de eventos compitan durante el mismo arrastre.
      if (event.pointerType === "mouse") return;
      if (pointerId !== null) return;
      pointerId = event.pointerId;
      startPoint = { x: event.clientX, y: event.clientY };
      viewport.setPointerCapture?.(event.pointerId);
    });

    viewport.addEventListener("pointermove", event => {
      if (event.pointerId !== pointerId || !startPoint) return;
      const deltaX = event.clientX - startPoint.x;
      const deltaY = event.clientY - startPoint.y;
      if (Math.abs(deltaX) > Math.abs(deltaY) * 0.8) {
        event.preventDefault();
        positionTrack(false, deltaX);
      }
    });

    function finishSwipe(event) {
      if (event.pointerId !== pointerId || !startPoint) return;
      const deltaX = event.clientX - startPoint.x;
      const deltaY = event.clientY - startPoint.y;
      if (Math.abs(deltaX) >= 48 && Math.abs(deltaX) > Math.abs(deltaY) * 1.15) step(deltaX < 0 ? 1 : -1);
      else positionTrack(true);
      startPoint = null;
      pointerId = null;
    }

    viewport.addEventListener("pointerup", finishSwipe);
    viewport.addEventListener("pointercancel", finishSwipe);

    // Arrastre explícito de mouse para PC. Se escucha el movimiento y la
    // liberación en document para no perder el gesto si el cursor sale del visor.
    viewport.addEventListener("mousedown", event => {
      if (event.button !== 0 || photos.length < 2) return;
      mouseStartPoint = { x: event.clientX, y: event.clientY };
      event.preventDefault();
    });
    document.addEventListener("mousemove", event => {
      if (!mouseStartPoint || overlay.hidden || viewport.hidden) return;
      const deltaX = event.clientX - mouseStartPoint.x;
      const deltaY = event.clientY - mouseStartPoint.y;
      if (Math.abs(deltaX) > Math.abs(deltaY) * 0.8) {
        event.preventDefault();
        positionTrack(false, deltaX);
      }
    });
    document.addEventListener("mouseup", event => {
      if (!mouseStartPoint) return;
      const deltaX = event.clientX - mouseStartPoint.x;
      const deltaY = event.clientY - mouseStartPoint.y;
      if (Math.abs(deltaX) >= 48 && Math.abs(deltaX) > Math.abs(deltaY) * 1.15) step(deltaX < 0 ? 1 : -1);
      else positionTrack(true);
      mouseStartPoint = null;
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
        // If the image is same-origin or a data URL, the browser can still
        // download it directly even when fetching a blob is unavailable.
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
