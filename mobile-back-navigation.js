(function (global) {
  "use strict";

  function clone(value) {
    return JSON.parse(JSON.stringify(value || {}));
  }

  function equal(first, second) {
    return JSON.stringify(first) === JSON.stringify(second);
  }

  function start(options) {
    if (!options || typeof options.capture !== "function" || typeof options.restore !== "function") return false;
    const page = String(options.page || location.pathname);
    const entries = [];
    let activeIndex = 0;
    let restoring = false;
    let captureTimer = 0;
    const initial = clone(options.capture());
    initial.overlay = visibleOverlay();
    const first = { smartfitMobileBack: page, key: 0, snapshot: initial };
    entries.push(first);
    try { history.replaceState(first, "", location.href); }
    catch (error) { return false; }
    // El estado duplicado sirve como barrera al llegar a la vista inicial:
    // Atrás no devuelve al formulario de acceso ni termina la sesión.
    try { history.pushState(first, "", location.href); } catch (error) {}

    function visibleOverlay() {
      const dialogs = [...document.querySelectorAll('[aria-modal="true"]')];
      for (let index = dialogs.length - 1; index >= 0; index -= 1) {
        const dialog = dialogs[index];
        if (dialog.hidden || dialog.closest("[hidden]")) continue;
        const camera = dialog.querySelector("[data-camera-cancel]");
        if (camera) return "__camera__";
        let root = dialog;
        while (root.parentElement && root.parentElement !== document.body && !root.id) root = root.parentElement;
        return root.id || dialog.id || "__dialog__";
      }
      return "";
    }

    function captureCurrent() {
      const state = clone(options.capture());
      state.overlay = visibleOverlay();
      return state;
    }

    function closeOverlay(id) {
      if (!id) return;
      if (id === "__camera__" || id === "__dialog__") {
        const cancel = [...document.querySelectorAll('[aria-modal="true"] [data-camera-cancel]')].find(button => !button.closest("[hidden]"));
        if (cancel) { cancel.click(); return; }
      }
      const root = document.getElementById(id);
      if (!root) return;
      const closeButton = root.querySelector('[data-camera-cancel], [id^="close"], .modal-close, .ticket-modal-close, .ticket-history-modal-close, .image-lightbox-close, .lightbox-close');
      if (closeButton) closeButton.click();
      else root.hidden = true;
    }

    function restoreSnapshot(snapshot) {
      restoring = true;
      try {
        const currentOverlay = visibleOverlay();
        if (currentOverlay && currentOverlay !== snapshot.overlay) {
          closeOverlay(currentOverlay);
        }
        options.restore(clone(snapshot));
        if (snapshot.overlay && snapshot.overlay !== "__camera__" && snapshot.overlay !== "__dialog__") {
          const root = document.getElementById(snapshot.overlay);
          if (root) root.hidden = false;
        }
      } catch (error) {
        console.warn("No se pudo restaurar la ventana anterior.", error);
      } finally {
        setTimeout(() => { restoring = false; }, 40);
      }
    }

    function scheduleCapture() {
      if (restoring) return;
      clearTimeout(captureTimer);
      captureTimer = setTimeout(() => {
        if (restoring) return;
        const next = captureCurrent();
        const current = entries[activeIndex]?.snapshot;
        if (equal(current, next)) return;

        let previousIndex = -1;
        for (let index = activeIndex - 1; index >= 0; index -= 1) {
          if (equal(entries[index].snapshot, next)) { previousIndex = index; break; }
        }
        if (previousIndex >= 0) {
          history.go(previousIndex - activeIndex);
          return;
        }

        entries.splice(activeIndex + 1);
        const nextIndex = activeIndex + 1;
        const state = { smartfitMobileBack: page, key: nextIndex, snapshot: next };
        entries.push(state);
        activeIndex = nextIndex;
        try { history.pushState(state, "", location.href); }
        catch (error) {
          entries.pop();
          activeIndex -= 1;
        }
      }, 0);
    }

    document.addEventListener("click", scheduleCapture);
    if (global.MutationObserver && document.body) {
      const overlayObserver = new MutationObserver(scheduleCapture);
      overlayObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden"] });
    }

    global.addEventListener("popstate", event => {
      const state = event.state;
      if (!state || state.smartfitMobileBack !== page) return;
      const index = entries.findIndex(entry => entry.key === state.key);
      if (index >= 0) activeIndex = index;
      restoreSnapshot(state.snapshot || entries[activeIndex].snapshot);
      if (activeIndex === 0) {
        const root = entries[0];
        try { history.pushState(root, "", location.href); } catch (error) {}
      }
    });

    return true;
  }

  global.SmartFitMobileBack = { start };
})(window);
