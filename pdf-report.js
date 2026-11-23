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
      @media print{
        @page{margin:5mm!important}
        html,body{height:auto!important;min-height:0!important}
        body{margin:0!important;padding:0!important}
        table{margin:0!important}
        thead{display:table-header-group}
        tr{break-inside:auto!important;page-break-inside:auto!important}
        th,td{padding:3px 4px!important}
        footer{margin-top:5mm!important}
        .report-page,.page,.sheet{height:auto!important;min-height:0!important;margin-top:0!important;margin-bottom:3mm!important;padding-top:0!important;padding-bottom:2mm!important}
        .sheet{display:block!important}
        .sheet+.sheet{break-before:auto!important;page-break-before:auto!important}
        .sheet article{flex:none!important;padding:2mm 0!important}
      }
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
        const message = "No se pudo abrir la impresión. Intenta nuevamente desde este informe.";
        try {
          if (reportWindow.opener && !reportWindow.opener.closed) reportWindow.opener.alert(message);
          else reportWindow.alert(message);
        } catch (alertError) {
          reportWindow.alert(message);
        }
      }
    });

    closeButton.addEventListener("click", () => {
      restoreMainWindow(reportWindow);
      reportWindow.close();
    });
  }

  window.SmartFitPdfReport = Object.freeze({ attach });
})();
