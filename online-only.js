(function () {
  "use strict";

  var overlay;
  var message;
  var retryButton;
  var checking = false;
  var checkTimer;

  function buildOverlay() {
    if (overlay) return;

    var style = document.createElement("style");
    style.textContent = [
      "#smartfit-online-guard{position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;padding:24px;background:rgba(16,17,22,.98);color:#f5f6f8;font:15px/1.5 Arial,sans-serif}",
      "#smartfit-online-guard[hidden]{display:none}",
      "#smartfit-online-guard .smartfit-online-card{width:min(100%,460px);padding:28px;background:#191b22;border:1px solid #343743;border-radius:16px;text-align:center;box-shadow:0 18px 60px #0008}",
      "#smartfit-online-guard h1{margin:0 0 10px;font-size:22px}",
      "#smartfit-online-guard p{margin:0;color:#b9c0ce}",
      "#smartfit-online-guard button{margin-top:22px;padding:12px 20px;border:0;border-radius:10px;background:#ffb51b;color:#171717;font:700 15px Arial,sans-serif;cursor:pointer}",
      "#smartfit-online-guard button:disabled{opacity:.65;cursor:wait}"
    ].join("");
    document.head.appendChild(style);

    overlay = document.createElement("div");
    overlay.id = "smartfit-online-guard";
    overlay.setAttribute("role", "alertdialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", "smartfit-online-title");
    overlay.innerHTML = '<div class="smartfit-online-card"><h1 id="smartfit-online-title">Se requiere conexión a internet</h1><p id="smartfit-online-message">Verificando conexión…</p><button type="button">Reintentar</button></div>';
    document.documentElement.appendChild(overlay);
    message = overlay.querySelector("#smartfit-online-message");
    retryButton = overlay.querySelector("button");
    retryButton.addEventListener("click", function () {
      checkConnection(true);
    });
  }

  function show(text) {
    buildOverlay();
    message.textContent = text;
    overlay.hidden = false;
    document.documentElement.setAttribute("data-smartfit-online", "blocked");
  }

  function hide() {
    buildOverlay();
    overlay.hidden = true;
    document.documentElement.removeAttribute("data-smartfit-online");
  }

  async function checkConnection(showProgress) {
    if (checking) return;
    checking = true;
    buildOverlay();
    if (showProgress) retryButton.disabled = true;

    if (!navigator.onLine) {
      show("Conéctate a internet y vuelve a intentarlo.");
      retryButton.disabled = false;
      checking = false;
      return;
    }

    // Las comprobaciones periódicas se mantienen silenciosas cuando todo funciona.
    if (showProgress) show("Verificando conexión a internet…");
    try {
      var response = await fetch(new URL("./?online-check=" + Date.now(), window.location.href), {
        method: "GET",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "X-SmartFit-Online-Check": "1" }
      });
      if (!response.ok) throw new Error("Network check failed");
      hide();
    } catch (_error) {
      show("No hay conexión con el sitio. Conéctate a internet para usar SmartFit Mantenimiento.");
    } finally {
      retryButton.disabled = false;
      checking = false;
    }
  }

  buildOverlay();
  show("Verificando conexión a internet…");
  window.addEventListener("offline", function () {
    show("Conéctate a internet para continuar usando SmartFit Mantenimiento.");
  });
  window.addEventListener("online", function () {
    checkConnection(true);
  });
  window.addEventListener("focus", function () {
    checkConnection(false);
  });
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) checkConnection();
  });
  checkConnection(true);
  checkTimer = window.setInterval(function () {
    checkConnection(false);
  }, 30000);
  window.addEventListener("pagehide", function () {
    window.clearInterval(checkTimer);
  }, { once: true });
})();
