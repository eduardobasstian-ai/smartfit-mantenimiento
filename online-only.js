(function (global) {
  "use strict";

  var overlay;
  var message;
  var retryButton;
  var checking = false;
  var checkTimer;
  var failedChecks = 0;
  var appLocked = false;
  var inertState = new Map();
  var connectionCheckUrl = "https://acmcksmiqrfrxopceies.supabase.co/auth/v1/health";
  var publishableKey = "sb_publishable_uWaLgff_Xc03iC68QpUUuQ_QkmCLLGy";

  function setAppLocked(locked) {
    appLocked = locked;
    if (document.body) {
      Array.from(document.body.children).forEach(function (child) {
        if (child === overlay) return;
        if (locked) {
          if (!inertState.has(child)) inertState.set(child, child.inert);
          child.inert = true;
        } else if (inertState.has(child)) {
          child.inert = inertState.get(child);
          inertState.delete(child);
        }
      });
    }
    document.documentElement.toggleAttribute("data-smartfit-offline", locked);
  }

  function buildOverlay() {
    if (overlay) return;

    var style = document.createElement("style");
    style.textContent = [
      "#smartfit-online-guard{position:fixed;z-index:2147483647;top:14px;left:50%;transform:translateX(-50%);width:min(calc(100% - 28px),540px);display:flex;align-items:center;gap:12px;padding:12px 16px;border:1px solid #5a4925;border-radius:13px;background:#2c261a;color:#f5f6f8;font:14px/1.45 Arial,sans-serif;box-shadow:0 12px 35px #0005;opacity:1;transition:opacity .2s ease,transform .2s ease}",
      "#smartfit-online-guard[hidden]{display:none}",
      "#smartfit-online-guard .smartfit-offline-icon{width:18px;height:18px;flex:0 0 18px;color:#ffb51b}",
      "#smartfit-online-guard strong{color:#ffbd32}",
      "#smartfit-online-guard span{min-width:0}",
      "#smartfit-online-retry{flex:0 0 auto;min-height:36px;padding:0 12px;border:1px solid #80621f;border-radius:9px;background:#ffb51b;color:#171717;font-weight:700}",
      "#smartfit-online-retry:disabled{opacity:.6}",
      "html[data-smartfit-offline] body{user-select:none}",
      "@media(max-width:480px){#smartfit-online-guard{top:10px;width:calc(100% - 20px);padding:11px 13px;font-size:13px}}"
    ].join("");
    document.head.appendChild(style);

    overlay = document.createElement("div");
    overlay.id = "smartfit-online-guard";
    overlay.setAttribute("role", "status");
    overlay.setAttribute("aria-live", "polite");
    overlay.innerHTML = '<svg class="smartfit-offline-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6.5 18.2h10.2a4.3 4.3 0 0 0 .5-8.6A6.2 6.2 0 0 0 5.7 8.4a4.9 4.9 0 0 0 .8 9.8Z"/><path d="m4 4 16 16"/></svg><span id="smartfit-online-message"><strong>No tienes conexión</strong></span><button id="smartfit-online-retry" type="button">↻ Reintentar</button>';
    document.documentElement.appendChild(overlay);
    message = overlay.querySelector("#smartfit-online-message");
    retryButton = overlay.querySelector("#smartfit-online-retry");
    retryButton.addEventListener("click", async function () {
      retryButton.disabled = true;
      retryButton.textContent = "Conectando…";
      try {
        var result = await (global.SmartFitRefreshCurrentView || reconnectAndRefresh)();
        if (!result.ok) {
          message.innerHTML = "<strong>Sin conexión con el servidor.</strong> Tus registros siguen guardados en este dispositivo.";
          overlay.hidden = false;
        }
      } catch (error) {
        console.warn("No se pudieron actualizar los datos al reconectar.", error);
        message.innerHTML = "<strong>Conexión limitada.</strong> Tus registros siguen guardados en este dispositivo; vuelve a intentar.";
        overlay.hidden = false;
      } finally {
        retryButton.disabled = false;
        retryButton.textContent = "↻ Reintentar";
      }
    });
  }

  function show() {
    buildOverlay();
    if (!overlay.hidden) return;
    overlay.hidden = false;
    setAppLocked(true);
  }

  function hide() {
    buildOverlay();
    overlay.hidden = true;
    setAppLocked(false);
  }

  async function checkConnection(forceMessage, options) {
    var silent = options?.silent === true;
    if (checking) return false;
    checking = true;
    buildOverlay();

    if (!navigator.onLine) {
      failedChecks = Math.max(failedChecks, 2);
      if (!silent) show();
      checking = false;
      return false;
    }

    var controller = new AbortController();
    var timeout = window.setTimeout(function () { controller.abort(); }, 8000);
    try {
      var response = await fetch(connectionCheckUrl + "?check=" + Date.now(), {
        method: "GET",
        cache: "no-store",
        mode: "cors",
        headers: { apikey: publishableKey },
        signal: controller.signal
      });
      if (!response.ok) throw new Error("Network check failed");
      failedChecks = 0;
      if (options?.deferRecovery !== true && appLocked) {
        window.setTimeout(function () {
          if (appLocked && !retryButton.disabled) retryButton.click();
        }, 0);
      }
      return true;
    } catch (_error) {
      failedChecks += 1;
      if (!silent && (forceMessage || failedChecks >= 1)) show();
      return false;
    } finally {
      window.clearTimeout(timeout);
      checking = false;
    }
  }

  async function reconnectAndRefresh(options) {
    options = options || {};
    while (checking) await new Promise(function (resolve) { window.setTimeout(resolve, 120); });
    if (!await checkConnection(true, { silent: options.silent === true, deferRecovery: true })) return { ok: false };
    var data = global.SmartFitSupabaseData;
    if (!data) {
      hide();
      return { ok: true, refreshed: false };
    }
    try {
      try { await data.retryPending?.(); }
      catch (error) { console.warn("Quedaron datos locales pendientes; se reintentará su envío.", error); }
      var result = await data.hydrate?.();
      if (result && !result.skipped) {
        data.startRealtimeSync?.();
        if (options.dispatchUpdate !== false) {
          global.dispatchEvent(new CustomEvent("smartfit:supabase-data-hydrated", {
            detail: { tables: ["sites", "brands", "equipment", "tickets", "maintenance_events", "mileage_records", "maintenance_event_tickets", "inspection_records", "profiles", "site_assignments", "admin_user_access", "audit_log"] }
          }));
        }
      }
      hide();
      return { ok: true, refreshed: Boolean(result && !result.skipped) };
    } catch (error) {
      console.warn("La conexión respondió, pero no se pudieron actualizar los datos.", error);
      failedChecks = Math.max(failedChecks, 1);
      show();
      return { ok: false, error: error };
    }
  }

  buildOverlay();
  overlay.hidden = true;
  document.addEventListener("DOMContentLoaded", function () {
    if (appLocked) setAppLocked(true);
  }, { once: true });
  window.addEventListener("offline", function () {
    show();
  });
  window.addEventListener("online", function () {
    checkConnection();
  });
  window.addEventListener("focus", function () {
    checkConnection();
  });
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) checkConnection();
  });
  checkConnection();
  checkTimer = window.setInterval(function () {
    checkConnection();
  }, 60000);
  window.addEventListener("pagehide", function () {
    window.clearInterval(checkTimer);
  }, { once: true });
  global.SmartFitOnlineGuard = { checkConnection: checkConnection, reconnectAndRefresh: reconnectAndRefresh };
})(window);
