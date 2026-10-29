(function () {
  "use strict";

  function restoreMainWindow(reportWindow) {
    try {
      if (reportWindow.opener && !reportWindow.opener.closed) reportWindow.opener.focus();
    } catch (error) {
      // Some browsers restrict focus changes after printing; closing the report remains available.
    }
  }

  function attach(reportWindow) {
    if (!reportWindow || reportWindow.__smartFitPdfControlsReady) return;
    reportWindow.__smartFitPdfControlsReady = true;

    const document = reportWindow.document;
    const style = document.createElement("style");
    style.textContent = `
      .smartfit-pdf-toolbar{position:sticky;top:0;z-index:9999;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 16px;margin:-8px -8px 18px;background:#17191f;color:#f7f8fb;border-bottom:1px solid #383b45;font:14px Arial,sans-serif}
      .smartfit-pdf-toolbar p{margin:0;color:#d5d8e0}
      .smartfit-pdf-toolbar-actions{display:flex;gap:8px}
      .smartfit-pdf-toolbar button{border:1px solid #444854;border-radius:7px;padding:9px 14px;background:#22252d;color:#f7f8fb;font:600 14px Arial,sans-serif;cursor:pointer}
      .smartfit-pdf-toolbar button.primary{background:#ffb51b;border-color:#ffb51b;color:#17191f}
      .smartfit-pdf-toolbar button:disabled{opacity:.65;cursor:wait}
      @media print{.smartfit-pdf-toolbar{display:none!important}}
      @media(max-width:560px){.smartfit-pdf-toolbar{align-items:flex-start;flex-direction:column}.smartfit-pdf-toolbar-actions{width:100%}.smartfit-pdf-toolbar button{flex:1}}
    `;
    document.head.appendChild(style);

    const toolbar = document.createElement("div");
    toolbar.className = "smartfit-pdf-toolbar";
    toolbar.innerHTML = `<p>Informe listo. Puedes imprimir o guardar como PDF.</p><div class="smartfit-pdf-toolbar-actions"><button class="primary" type="button" data-pdf-print>Imprimir / Guardar PDF</button><button type="button" data-pdf-close>Cerrar informe</button></div>`;
    document.body.insertBefore(toolbar, document.body.firstChild);

    const printButton = toolbar.querySelector("[data-pdf-print]");
    const closeButton = toolbar.querySelector("[data-pdf-close]");
    let printing = false;

    const finishPrint = () => {
      if (!printing) return;
      printing = false;
      printButton.disabled = false;
      printButton.textContent = "Imprimir / Guardar PDF";
      restoreMainWindow(reportWindow);
    };

    reportWindow.addEventListener("afterprint", finishPrint);
    reportWindow.addEventListener("pagehide", () => restoreMainWindow(reportWindow), { once: true });

    printButton.addEventListener("click", async () => {
      if (printing) return;
      printing = true;
      printButton.disabled = true;
      printButton.textContent = "Preparando informe…";
      const imageReady = Promise.all([...document.images].map(image =>
        typeof image.decode === "function" ? image.decode().catch(() => undefined) : Promise.resolve()
      ));
      await Promise.race([imageReady, new Promise(resolve => setTimeout(resolve, 5000))]);
      printButton.textContent = "Imprimiendo…";
      try {
        reportWindow.focus();
        reportWindow.print();
      } catch (error) {
        finishPrint();
        reportWindow.alert("No se pudo abrir la impresión. Intenta nuevamente desde este informe.");
      }
    });

    closeButton.addEventListener("click", () => {
      restoreMainWindow(reportWindow);
      reportWindow.close();
    });
  }

  window.SmartFitPdfReport = Object.freeze({ attach });
})();
