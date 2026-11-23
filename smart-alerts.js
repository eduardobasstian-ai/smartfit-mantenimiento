(function (global) {
  "use strict";

  if (!global || global.__smartFitAlertsInstalled) return;
  global.__smartFitAlertsInstalled = true;

  var pendingMessages = [];
  var dialog;
  var messageElement;
  var isShowing = false;

  function createDialog() {
    if (dialog || !global.document || !global.document.body) return;

    var style = global.document.createElement("style");
    style.textContent = [
      "#smartfit-message-dialog{width:min(420px,calc(100vw - 32px));max-width:100%;padding:0;border:1px solid #414450;border-radius:16px;background:#191b22;color:#f5f5f7;box-shadow:0 24px 90px #0009;font:inherit}",
      "#smartfit-message-dialog::backdrop{background:rgba(5,6,9,.72);backdrop-filter:blur(2px)}",
      "#smartfit-message-dialog .smartfit-message-title{margin:0;padding:18px 20px;border-bottom:1px solid #343743;color:#ffb51b;text-align:center;font-size:17px;font-weight:800}",
      "#smartfit-message-dialog .smartfit-message-body{max-height:min(55vh,420px);overflow:auto;padding:20px;color:#e8e9ed;font-size:14px;line-height:1.55;white-space:pre-wrap;overflow-wrap:anywhere}",
      "#smartfit-message-dialog .smartfit-message-actions{display:flex;justify-content:center;padding:0 20px 18px}",
      "#smartfit-message-dialog .smartfit-message-accept{min-width:112px;min-height:42px;padding:0 18px;border:1px solid #ffb51b;border-radius:10px;background:#ffb51b;color:#171717;font:inherit;font-weight:800;cursor:pointer}",
      "#smartfit-message-dialog .smartfit-message-accept:focus-visible{outline:3px solid #fff;outline-offset:3px}",
      "@media(max-width:480px){#smartfit-message-dialog{border-radius:14px}#smartfit-message-dialog .smartfit-message-title{font-size:16px}#smartfit-message-dialog .smartfit-message-body{font-size:13px}}"
    ].join("");
    global.document.head.appendChild(style);

    dialog = global.document.createElement("dialog");
    dialog.id = "smartfit-message-dialog";
    dialog.setAttribute("aria-labelledby", "smartfit-message-title");
    dialog.setAttribute("aria-describedby", "smartfit-message-body");
    dialog.innerHTML = '<h2 class="smartfit-message-title" id="smartfit-message-title">Atención Mensaje:</h2><div class="smartfit-message-body" id="smartfit-message-body"></div><div class="smartfit-message-actions"><button class="smartfit-message-accept" type="button">Aceptar</button></div>';
    messageElement = dialog.querySelector("#smartfit-message-body");
    dialog.querySelector(".smartfit-message-accept").addEventListener("click", function () {
      if (dialog.open) dialog.close();
    });
    dialog.addEventListener("close", function () {
      isShowing = false;
      showNext();
    });
    global.document.body.appendChild(dialog);
  }

  function showNext() {
    if (isShowing || !pendingMessages.length) return;
    createDialog();
    if (!dialog) return;
    messageElement.textContent = pendingMessages.shift();
    isShowing = true;
    dialog.showModal();
    dialog.querySelector(".smartfit-message-accept").focus();
  }

  global.alert = function (message) {
    pendingMessages.push(String(message == null ? "" : message));
    showNext();
  };
})(window);
