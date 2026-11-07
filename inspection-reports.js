(function (global) {
  "use strict";
  const esc = value => String(value ?? "—").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  const dateText = value => {
    if (!value) return "—";
    const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
    return match ? `${match[3]}-${match[2]}-${match[1]}` : esc(value);
  };
  const issuedText = () => new Intl.DateTimeFormat("es-CL", { dateStyle: "long", timeStyle: "short" }).format(new Date());

  async function exportInspectionReport(records, { lite = false, generatedBy = "Usuario", getPhotoUrls } = {}) {
    const entries = Array.isArray(records) ? records : [];
    if (!entries.length) { global.alert("No hay inspecciones para generar el informe con los filtros seleccionados."); return; }
    const reportWindow = global.open("", "_blank");
    if (!reportWindow) { global.alert("El navegador bloqueó la ventana del informe. Permite las ventanas emergentes e inténtalo nuevamente."); return; }
    reportWindow.document.write("<!doctype html><title>Preparando informe</title><p style=\"font:16px Arial;padding:24px\">Preparando informe de inspecciones…</p>");
    let signedUrls = {};
    if (!lite) {
      try {
        const paths = [...new Set(entries.flatMap(row => (Array.isArray(row.photos) ? row.photos : []).map(photo => photo?.path).filter(Boolean)))];
        signedUrls = paths.length && getPhotoUrls ? await getPhotoUrls(paths) : {};
      } catch (error) {
        reportWindow.close();
        global.alert("No se pudieron cargar las fotografías de inspección desde Supabase. Comprueba la conexión y vuelve a generar el PDF.");
        return;
      }
    }
    const logo = new URL("IMG/logo-header.png", global.location.href).href;
    const emitted = issuedText();
    if (lite) {
      const rows = entries.map((row, index) => `<tr><td>${index + 1}</td><td>${esc(row.site_name)}</td><td>${esc(row.fixed_asset || "—")}</td><td>${esc(row.brand_name || "—")}</td><td>${esc(row.equipment_name || "Equipo")}${row.equipment_model ? ` · ${esc(row.equipment_model)}` : ""}</td><td>${dateText(row.occurred_at || row.created_at)}</td><td>${esc(row.inspection_number || "—")}</td><td>${esc(row.status || "Pendiente")}</td><td>${esc([row.finding, row.observations].filter(Boolean).join(" · ") || "Sin detalle")}</td></tr>`).join("");
      reportWindow.document.open();
      reportWindow.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Informe Lite de inspecciones</title><style>
        @page{size:letter landscape;margin:12mm;@bottom-right{content:"Página " counter(page) " de " counter(pages);font:8pt Arial,sans-serif;color:#555}}*{box-sizing:border-box}body{margin:0;color:#171923;font:9pt Arial,sans-serif}.header{display:flex;align-items:center;gap:20px;border-bottom:3px solid #ffb51b;padding:0 0 10px;margin-bottom:14px}.header img{width:120px;height:auto;background:#000;padding:4px 8px;border-radius:4px}.header-copy{flex:1;text-align:right}.header h1{font-size:19pt;margin:0 0 6px}.header p{margin:3px 0;color:#555}.summary{display:flex;gap:10px;margin:10px 0 14px}.summary div{flex:1;padding:8px 10px;border:1px solid #cfd1d8;border-radius:7px}.summary b{display:block;font-size:8pt;color:#555}.summary strong{display:block;margin-top:3px;font-size:13pt}table{width:100%;border-collapse:collapse;table-layout:fixed}col.number{width:4%}col.site{width:13%}col.asset{width:9%}col.brand{width:10%}col.equipment{width:15%}col.date{width:10%}col.folio{width:12%}col.status{width:10%}col.finding{width:17%}thead{display:table-header-group}th,td{padding:6px 7px;border:1px solid #d8dae0;text-align:justify;vertical-align:top;overflow-wrap:anywhere;word-break:normal}th{background:#f0f1f4;font-weight:700;font-size:8pt;text-align:center}td{font-size:8pt;line-height:1.4}td:first-child{text-align:center;white-space:nowrap}tr{break-inside:avoid}footer{margin-top:12px;border-top:1px solid #d8dae0;padding-top:6px;text-align:center;color:#555;font-size:8pt}@media print{*{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
        </style></head><body><header class="header"><img src="${esc(logo)}" alt="Smart Fit"><div class="header-copy"><h1>INFORME LITE</h1><p>Generado por: <b>${esc(generatedBy)}</b></p><p>Fecha y hora: ${esc(emitted)}</p></div></header><div class="summary"><div><b>Inspecciones incluidas</b><strong>${entries.length.toLocaleString("es-CL")}</strong></div></div><table><colgroup><col class="number"><col class="site"><col class="asset"><col class="brand"><col class="equipment"><col class="date"><col class="folio"><col class="status"><col class="finding"></colgroup><thead><tr><th>N.º</th><th>Sede</th><th>Activo fijo</th><th>Marca</th><th>Equipo</th><th>Fecha inspección</th><th>N.º inspección</th><th>Estado</th><th>Hallazgo / observaciones</th></tr></thead><tbody>${rows}</tbody></table><footer>Informe de inspecciones generado desde Smart Fit.</footer><script>window.addEventListener('load',()=>window.opener?.SmartFitPdfReport?.attach(window));<\/script></body></html>`);
      reportWindow.document.close();
      return;
    }
    const title = lite ? "INFORME LITE DE INSPECCIONES" : "INFORME FULL DE INSPECCIONES";
    const pages = entries.map((row, index) => {
      const state = row.status || "Pendiente";
      const folio = row.inspection_number || "Folio no disponible";
      const fields = `<div class="grid">
        <p><b>N.º inspección:</b> ${esc(folio)}</p><p><b>Fecha:</b> ${dateText(row.occurred_at || row.created_at)}</p>
        <p><b>Sede:</b> ${esc(row.site_name)}</p><p><b>Estado:</b> ${esc(state)}</p>
        <p><b>Activo fijo:</b> ${esc(row.fixed_asset || "N/A")}</p><p><b>Equipo:</b> ${esc(row.equipment_name)}${row.equipment_model ? ` · ${esc(row.equipment_model)}` : ""}</p>
        <p><b>Marca:</b> ${esc(row.brand_name)}</p><p><b>Técnico asignado:</b> ${esc(row.technician_name)}</p>
        <p><b>Supervisor:</b> ${esc(row.supervisor_name)}</p><p><b>Registrado por:</b> ${esc(row.registered_by_name)}</p>
        <p class="wide"><b>Hallazgo / revisión:</b> ${esc(row.finding)}</p>
        <p class="wide"><b>Observaciones:</b> ${esc(row.observations || "Sin observaciones")}</p>
        ${state === "Ejecutado" ? `<p class="wide"><b>Corrección:</b> ${esc(row.correction || "Registrada")}</p>` : ""}
      </div>`;
      const photoFigures = !lite ? (Array.isArray(row.photos) ? row.photos : []).map((photo, photoIndex) => {
        const src = signedUrls[photo?.path];
        return src ? `<figure><img src="${esc(src)}" alt="Fotografía ${photoIndex + 1}"><figcaption>Fotografía ${photoIndex + 1}</figcaption></figure>` : "";
      }).join("") : "";
      const photos = !lite ? `<section><h2>Registro fotográfico</h2>${photoFigures ? `<div class="photos">${photoFigures}</div>` : `<p class="muted">Sin fotografías adjuntas.</p>`}</section>` : "";
      return `<article class="page"><header><img src="${esc(logo)}" alt="Smart Fit"><div><h1>${title}</h1><p>Fecha y hora de emisión: ${esc(emitted)} · Registro ${index + 1} de ${entries.length}</p><p>Generado por: <b>${esc(generatedBy)}</b></p></div></header><section><h2>Datos de inspección</h2>${fields}</section>${photos}<footer>se genera el informe para lo que se estime conveniente.</footer></article>`;
    }).join("");
    reportWindow.document.open();
    reportWindow.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${title}</title><style>
      @page{size:letter;margin:14mm}*{box-sizing:border-box}body{margin:0;color:#171923;font:10pt Arial,sans-serif}.page{min-height:250mm;display:flex;flex-direction:column;page-break-after:always;break-after:page}.page:last-child{page-break-after:auto;break-after:auto}header{display:flex;align-items:center;gap:18px;border-bottom:3px solid #ffb51b;padding-bottom:10px}header img{width:125px;height:auto;object-fit:contain;background:#000!important;padding:4px 8px;border-radius:4px}header div{flex:1;text-align:right}h1{font-size:18pt;margin:0 0 6px}header p{margin:3px 0;color:#555}section{margin-top:14px}h2{font-size:11pt;margin:0 0 8px;padding-bottom:5px;border-bottom:1px solid #cfd1d8}.grid{display:grid;grid-template-columns:1fr 1fr;gap:7px 18px}.grid p{margin:0;line-height:1.4;text-align:justify;overflow-wrap:anywhere;white-space:pre-wrap}.wide{grid-column:1/-1}.photos{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.photos figure{margin:0;text-align:center}.photos img{width:100%;height:65mm;object-fit:contain;border:1px solid #d8dae0}.photos figcaption{font-size:8pt;color:#555;margin-top:4px}.muted{color:#555}footer{margin-top:auto;padding-top:10px;border-top:1px solid #cfd1d8;text-align:center;font-size:8pt;color:#555}@media print{*{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
    </style></head><body>${pages}<script>window.addEventListener('load',()=>{const imgs=[...document.images];Promise.all(imgs.map(img=>img.decode?.().catch(()=>{})||Promise.resolve())).then(()=>window.opener?.SmartFitPdfReport?.attach(window));});<\/script></body></html>`);
    reportWindow.document.close();
  }
  global.SmartFitInspectionReports = { export: exportInspectionReport };
})(window);
