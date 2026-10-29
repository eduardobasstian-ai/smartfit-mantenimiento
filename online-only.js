(function () {
  "use strict";

  var overlay;
  var message;
  var retryButton;
  var checking = false;
  var checkTimer;
  var failedChecks = 0;
  var appLocked = false;
  var connectionCheckUrl = "https://acmcksmiqrfrxopceies.supabase.co/auth/v1/health";
  var publishableKey = "sb_publishable_uWaLgff_Xc03iC68QpUUuQ_QkmCLLGy";

  function setAppLocked(locked) {
    appLocked = locked;
    if (document.body) document.body.inert = locked;
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
      "html[data-smartfit-offline] body{user-select:none}",
      "@media(max-width:480px){#smartfit-online-guard{top:10px;width:calc(100% - 20px);padding:11px 13px;font-size:13px}}"
    ].join("");
    document.head.appendChild(style);

    overlay = document.createElement("div");
    overlay.id = "smartfit-online-guard";
    overlay.setAttribute("role", "status");
    overlay.setAttribute("aria-live", "polite");
    overlay.innerHTML = '<svg class="smartfit-offline-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6.5 18.2h10.2a4.3 4.3 0 0 0 .5-8.6A6.2 6.2 0 0 0 5.7 8.4a4.9 4.9 0 0 0 .8 9.8Z"/><path d="m4 4 16 16"/></svg><span id="smartfit-online-message"><strong>No tienes conexión</strong></span>';
    document.documentElement.appendChild(overlay);
    message = overlay.querySelector("#smartfit-online-message");
  }

  function show() {
    buildOverlay();
    if (!overlay.hidden) return;
    overlay.hidden = false;
    setAppLocked(true);
  }

  function hide() {
    buildOverlay();
    var connectionWasBlocked = appLocked;
    overlay.hidden = true;
    setAppLocked(false);
    if (connectionWasBlocked && global.SmartFitSupabaseData?.retryPending) {
      global.SmartFitSupabaseData.retryPending().catch(function (error) {
        console.warn("Quedaron registros locales pendientes de sincronizar.", error);
      });
    }
  }

  async function checkConnection() {
    if (checking) return;
    checking = true;
    buildOverlay();

    if (!navigator.onLine) {
      failedChecks = Math.max(failedChecks, 2);
      show();
      checking = false;
      return;
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
      hide();
    } catch (_error) {
      failedChecks += 1;
      // Una respuesta fallida aislada puede ser temporal; confirma antes de bloquear.
      if (failedChecks >= 2) show();
    } finally {
      window.clearTimeout(timeout);
      checking = false;
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
})();
