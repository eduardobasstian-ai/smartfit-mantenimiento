(function (global) {
  "use strict";

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  function create(options) {
    const $ = id => document.getElementById(id);
    const overlay = $(options.overlayId);
    const frame = $(options.frameId);
    const viewport = $(options.viewportId);
    const track = $(options.trackId);
    const closeButton = $(options.closeId);
    const zoomButton = $(options.zoomId);
    const previousButton = $(options.previousId);
    const nextButton = $(options.nextId);
    const counter = $(options.counterId);
    if (!overlay || !frame || !viewport || !track || !closeButton || !zoomButton || !previousButton || !nextButton || !counter) {
      throw new Error("Faltan elementos del visor de imágenes.");
    }

    let gallery = [];
    let index = 0;
    let zoom = 1;
    let basePointer = null;
    let panPointer = null;
    let pinch = null;
    let pointers = new Map();
    let gestureWasPinch = false;

    function activeSlide() {
      return track.children[index] || null;
    }

    function activeImage() {
      return activeSlide()?.querySelector("img") || null;
    }

    function positionTrack(animate = false, dragX = 0) {
      track.style.transition = animate ? "transform 230ms cubic-bezier(.2,.75,.25,1)" : "none";
      track.style.transform = `translate3d(${-index * viewport.clientWidth + dragX}px, 0, 0)`;
    }

    function fitSlide(slide, image, scale) {
      if (!image.naturalWidth || !image.naturalHeight) return;
      const maxWidth = Math.min(viewport.clientWidth * 0.94, 1400);
      const maxHeight = viewport.clientHeight * 0.94;
      const baseScale = Math.min(maxWidth / image.naturalWidth, maxHeight / image.naturalHeight);
      image.style.width = `${Math.max(1, Math.floor(image.naturalWidth * baseScale * scale))}px`;
      image.style.height = `${Math.max(1, Math.floor(image.naturalHeight * baseScale * scale))}px`;
      const enlarged = scale > 1.01;
      slide.classList.toggle("is-zoomed", enlarged);
      image.classList.toggle("is-zoomed", enlarged);
      if (!enlarged) {
        slide.scrollLeft = 0;
        slide.scrollTop = 0;
      }
    }

    function fitImages() {
      [...track.children].forEach((slide, slideIndex) => {
        const image = slide.querySelector("img");
        if (image) fitSlide(slide, image, slideIndex === index ? zoom : 1);
      });
    }

    function updateControls() {
      const multiple = gallery.length > 1;
      previousButton.hidden = !multiple;
      nextButton.hidden = !multiple;
      counter.hidden = !multiple;
      previousButton.disabled = !multiple || index === 0 || zoom > 1.01;
      nextButton.disabled = !multiple || index === gallery.length - 1 || zoom > 1.01;
      counter.textContent = multiple ? `${index + 1} / ${gallery.length}` : "";
      zoomButton.textContent = zoom > 1.01 ? "−" : "+";
      zoomButton.setAttribute("aria-label", zoom > 1.01 ? "Reducir imagen" : "Ampliar imagen");
    }

    function render() {
      track.replaceChildren();
      gallery.forEach((item, slideIndex) => {
        const slide = document.createElement("div");
        slide.className = "image-gallery-slide";
        slide.setAttribute("aria-hidden", slideIndex === index ? "false" : "true");
        const image = document.createElement("img");
        image.alt = item.alt || "Imagen";
        image.draggable = false;
        image.addEventListener("load", () => {
          if (track.children[slideIndex] === slide) fitSlide(slide, image, slideIndex === index ? zoom : 1);
        }, { once: true });
        image.src = item.src;
        slide.append(image);
        track.append(slide);
      });
      fitImages();
      positionTrack(false);
      updateControls();
    }

    function open(items, initialIndex = 0) {
      gallery = (Array.isArray(items) ? items : []).filter(item => item && item.src);
      if (!gallery.length) return;
      index = clamp(Number(initialIndex) || 0, 0, gallery.length - 1);
      zoom = 1;
      basePointer = null;
      panPointer = null;
      pinch = null;
      pointers.clear();
      gestureWasPinch = false;
      overlay.hidden = false;
      render();
      closeButton.focus();
    }

    function openFromTrigger(trigger, src, alt) {
      const group = trigger?.closest?.(".machine-log-photos, .maintenance-image-list, .ticket-detail-photos, .ticket-history-detail-photos, .ticket-photos, [data-image-gallery]");
      const selector = "[data-enlarge-image], [data-history-image], [data-ticket-enlarge]";
      const nodes = group ? [...group.querySelectorAll(selector)] : trigger ? [trigger] : [];
      const items = nodes.map(node => ({
        src: node.dataset.enlargeImage || node.dataset.historyImage || node.dataset.ticketEnlarge || node.currentSrc || node.src || "",
        alt: node.dataset.imageAlt || node.alt || alt || "Imagen"
      })).filter(item => item.src);
      const activeSrc = src || trigger?.dataset?.enlargeImage || trigger?.dataset?.historyImage || trigger?.dataset?.ticketEnlarge || trigger?.currentSrc || trigger?.src;
      const activeIndex = Math.max(0, items.findIndex(item => item.src === activeSrc));
      open(items.length ? items : [{ src: activeSrc, alt }], activeIndex);
    }

    function close() {
      overlay.hidden = true;
      track.replaceChildren();
      gallery = [];
      index = 0;
      zoom = 1;
      basePointer = null;
      panPointer = null;
      pinch = null;
      pointers.clear();
      gestureWasPinch = false;
      track.style.transition = "none";
      track.style.transform = "translate3d(0, 0, 0)";
    }

    function step(direction) {
      if (gallery.length < 2 || zoom > 1.01) return;
      const nextIndex = clamp(index + direction, 0, gallery.length - 1);
      if (nextIndex === index) return;
      index = nextIndex;
      positionTrack(true);
      updateControls();
      [...track.children].forEach((slide, slideIndex) => slide.setAttribute("aria-hidden", slideIndex === index ? "false" : "true"));
    }

    function setZoomAt(nextZoom, focalPoint = null) {
      zoom = clamp(nextZoom, 1, 4);
      const slide = activeSlide();
      const image = activeImage();
      if (!slide || !image) return;
      fitSlide(slide, image, zoom);
      if (zoom > 1.01 && focalPoint) {
        const slideRect = slide.getBoundingClientRect();
        const imageRect = image.getBoundingClientRect();
        const targetX = slideRect.left + slide.clientLeft + focalPoint.localX;
        const targetY = slideRect.top + slide.clientTop + focalPoint.localY;
        slide.scrollLeft += imageRect.left + focalPoint.anchorX * imageRect.width - targetX;
        slide.scrollTop += imageRect.top + focalPoint.anchorY * imageRect.height - targetY;
      }
      updateControls();
    }

    function focalGeometry(points) {
      const image = activeImage();
      const slide = activeSlide();
      const imageRect = image.getBoundingClientRect();
      const slideRect = slide.getBoundingClientRect();
      const x = (points[0].x + points[1].x) / 2;
      const y = (points[0].y + points[1].y) / 2;
      return {
        distance: Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y),
        anchorX: clamp((x - imageRect.left) / Math.max(1, imageRect.width), 0, 1),
        anchorY: clamp((y - imageRect.top) / Math.max(1, imageRect.height), 0, 1),
        localX: x - slideRect.left - slide.clientLeft,
        localY: y - slideRect.top - slide.clientTop
      };
    }

    function zoomFromPinch(points) {
      const geometry = focalGeometry(points);
      setZoomAt(pinch.zoom * geometry.distance / pinch.distance, {
        anchorX: pinch.anchorX,
        anchorY: pinch.anchorY,
        localX: geometry.localX,
        localY: geometry.localY
      });
    }

    function toggleZoom() {
      setZoomAt(zoom > 1.01 ? 1 : 2);
      if (zoom > 1.01) {
        const slide = activeSlide();
        slide.scrollLeft = Math.max(0, (slide.scrollWidth - slide.clientWidth) / 2);
        slide.scrollTop = Math.max(0, (slide.scrollHeight - slide.clientHeight) / 2);
      }
    }

    function point(event) { return { x: event.clientX, y: event.clientY }; }

    viewport.addEventListener("pointerdown", event => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      event.preventDefault();
      viewport.setPointerCapture?.(event.pointerId);
      pointers.set(event.pointerId, point(event));
      if (pointers.size === 1) {
        if (zoom > 1.01) panPointer = point(event);
        else basePointer = point(event);
        gestureWasPinch = false;
      } else if (pointers.size === 2) {
        const points = [...pointers.values()];
        pinch = Object.assign(focalGeometry(points), { zoom });
        gestureWasPinch = true;
        basePointer = null;
        panPointer = null;
      }
    });

    viewport.addEventListener("pointermove", event => {
      if (!pointers.has(event.pointerId)) return;
      const previousPoint = pointers.get(event.pointerId);
      pointers.set(event.pointerId, point(event));
      if (pointers.size >= 2 && pinch?.distance) {
        event.preventDefault();
        zoomFromPinch([...pointers.values()]);
        return;
      }
      if (zoom > 1.01 && pointers.size === 1) {
        event.preventDefault();
        const slide = activeSlide();
        slide.scrollLeft -= event.clientX - (panPointer || previousPoint).x;
        slide.scrollTop -= event.clientY - (panPointer || previousPoint).y;
        panPointer = point(event);
        return;
      }
      if (basePointer && gallery.length > 1) {
        const dx = event.clientX - basePointer.x;
        positionTrack(false, dx);
      }
    });

    function finishPointer(event) {
      if (!pointers.has(event.pointerId)) return;
      pointers.delete(event.pointerId);
      if (gestureWasPinch) {
        pinch = null;
        basePointer = null;
        panPointer = pointers.size ? [...pointers.values()][0] : null;
        if (!pointers.size) gestureWasPinch = false;
        return;
      }
      if (basePointer && zoom <= 1.01) {
        const dx = event.clientX - basePointer.x;
        const dy = event.clientY - basePointer.y;
        if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.2) step(dx < 0 ? 1 : -1);
        else positionTrack(true);
      }
      basePointer = null;
      panPointer = null;
    }

    viewport.addEventListener("pointerup", finishPointer);
    viewport.addEventListener("pointercancel", finishPointer);
    closeButton.addEventListener("click", close);
    zoomButton.addEventListener("click", toggleZoom);
    previousButton.addEventListener("click", () => step(-1));
    nextButton.addEventListener("click", () => step(1));
    overlay.addEventListener("click", event => { if (event.target === overlay) close(); });
    window.addEventListener("resize", () => {
      if (overlay.hidden) return;
      fitImages();
      positionTrack(false);
    });
    document.addEventListener("keydown", event => {
      if (overlay.hidden) return;
      if (event.key === "Escape") close();
      else if (event.key === "ArrowLeft" && zoom <= 1.01) step(-1);
      else if (event.key === "ArrowRight" && zoom <= 1.01) step(1);
    });

    return { open, openFromTrigger, close };
  }

  global.SmartFitImageGallery = { create };
})(window);
