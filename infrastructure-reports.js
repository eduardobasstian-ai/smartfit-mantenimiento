(function (global) {
  "use strict";

  const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[char]));
  const dateText = value => {
    const date = new Date(`${String(value || "").slice(0, 10)}T12:00:00`);
    return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("es-CL", { dateStyle:"short" }).format(date);
  };
  const monthName = value => new Intl.DateTimeFormat("es-CL", { month:"long" }).format(new Date(2000, Number(value) - 1, 1));

  const styles = `
    .infra-report{width:100%;min-width:0;max-width:100%;overflow:hidden;color:var(--text,#f5f5f7)}
    .infra-report-toolbar{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,150px),1fr));gap:10px;margin:8px 0 14px}
    .infra-report-filter{display:grid;min-width:0;gap:6px;color:var(--muted,#aeb2bf);font-size:11px;font-weight:700}
    .infra-report-filter input,.infra-report-filter select{width:100%;min-width:0;min-height:38px;padding:0 10px;border:1px solid #383b47;border-radius:9px;background:#111319;color:var(--text,#f5f5f7);font:inherit;font-size:12px}
    .infra-report-summary{display:flex;min-width:0;width:100%;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin:0 0 8px}
    .infra-report-count{min-width:0;color:var(--muted,#aeb2bf);font-size:12px}
    .infra-loading:not([hidden]){display:grid;gap:8px;margin:10px 0;animation:infra-appear .15s .2s backwards}
    .infra-loading i{height:28px;border-radius:5px;background:var(--border,#343743);opacity:.55}
    @keyframes infra-appear{from{opacity:0}to{opacity:1}}
    @media(prefers-reduced-motion:reduce){.infra-loading:not([hidden]){animation:none}}
    .infra-report-actions{display:flex;gap:8px;flex-wrap:wrap}
    .infra-report-actions button{min-height:38px;padding:0 13px;border:1px solid #383b47;border-radius:10px;background:#20222a;color:var(--text,#f5f5f7);font:inherit;font-size:12px;font-weight:750}
    .infra-report-actions [data-infra-export=full]{background:var(--yellow,#ffb51b);border-color:var(--yellow,#ffb51b);color:#17130a}
    .infra-report-actions button:disabled{opacity:.48;cursor:not-allowed}
    .infra-report-table-wrap{width:100%;min-width:0;max-width:100%;overflow-x:auto;overflow-y:hidden;overscroll-behavior-x:contain;-webkit-overflow-scrolling:touch}
    .infra-report-table-wrap[hidden]{display:none!important}
    .infra-report-table{width:100%;min-width:0;border-collapse:collapse;table-layout:auto}
    .infra-report-table th,.infra-report-table td{padding:11px 10px;border-bottom:1px solid #30323c;text-align:left;vertical-align:middle}
    .infra-report-table th{color:#858895;font-size:10px;font-weight:800;letter-spacing:.55px;text-transform:uppercase;overflow-wrap:anywhere}
    .infra-report-table td{color:var(--text,#e7e7eb);font-size:13px;overflow-wrap:anywhere}
    .infra-report-table td:first-child{width:34px}
    .infra-report-checked{width:17px;height:17px;accent-color:var(--yellow,#ffb51b)}
    .infra-report-empty{padding:26px 12px;color:var(--muted,#aeb2bf);text-align:center;font-size:13px}
    .infra-report-pagination{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-top:12px}
    @media(max-width:600px){.infra-report-toolbar{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.infra-report-summary{align-items:stretch}.infra-report-actions{width:100%}.infra-report-actions button{flex:1}.infra-report-pagination{flex-wrap:wrap}}
  `;

  function addStyles() {
    if (document.getElementById("infrastructureReportStyle")) return;
    const style = document.createElement("style");
    style.id = "infrastructureReportStyle";
    style.textContent = styles;
    document.head.append(style);
  }

  function flatten(visits) {
    return visits.flatMap(visit => (Array.isArray(visit.events) ? visit.events : []).map((item, index) => ({ ...item, visit, index, key:`${visit.id}:${index}` })));
  }

  function mount({ host, siteLegacyId="", technicianOnly=false, adminSites=null, heading="Informes de infraestructura", pageSize=null } = {}) {
    if (!host || !global.SmartFitSupabaseData) throw new Error("No está disponible el panel de informes de infraestructura.");
    if (host.parentNode) { const fresh = host.cloneNode(false); host.parentNode.replaceChild(fresh, host); host = fresh; }
    addStyles();
    const pageSizeValue = technicianOnly ? 3 : (pageSize || 8);
    const selected = new Set();
    let visits = [], page = 1;
    const isAdmin = Array.isArray(adminSites);
    const assignments = new Map((adminSites || global.AdminStore?.listSites() || []).map(site => [String(site.id), site.coordinator || "Sin asignar"]));
    const coordinator = visit => assignments.get(String(visit.site?.legacy_id)) || "Sin asignar";
    const filter = (key, label, all) => `<label class="infra-report-filter">${label}<select data-filter="${key}"><option value="*">${all}</option></select></label>`;
    host.innerHTML = `<section class="infra-report" aria-label="${esc(heading)}">
      <div class="infra-report-toolbar" aria-label="Filtros de informes de infraestructura">
        ${isAdmin ? `<label class="infra-report-filter">Fecha<input data-filter="date" type="date"></label>${filter("site","Sede","Todas")}${filter("coordinator","Coordinador","Todos")}${filter("tech","Técnico","Todos")}` : filter("month","Mes","Todos los meses") + filter("year","Año","Todos los años")}
      </div>
      <div class="infra-report-summary"><span class="infra-report-count" data-infra-report-count>Cargando informes…</span><div class="infra-report-actions"><button type="button" data-infra-export="full" disabled>PDF Full</button><button type="button" data-infra-export="lite" disabled>PDF Lite</button><button type="button" data-infra-clear>Limpiar filtros</button></div></div>
      <div class="infra-loading" aria-hidden="true"><i></i><i></i><i></i></div>
      <div class="infra-report-table-wrap" data-infra-table hidden>
        <table class="infra-report-table" aria-label="Informes diarios de infraestructura"><thead><tr>
          <th scope="col" aria-label="Seleccionar informe diario">✓</th><th scope="col">Fecha</th>${technicianOnly ? "" : '<th scope="col">Sede</th><th scope="col">Técnico</th><th scope="col">Coordinador</th>'}
        </tr></thead><tbody data-infra-rows></tbody></table>
      </div>
      <div class="infra-report-empty" data-infra-empty hidden>No hay informes que coincidan con los filtros.</div>
      <div class="infra-report-pagination" data-infra-pagination hidden><span data-infra-page-label></span><div class="infra-report-actions"><button type="button" data-infra-prev>← Anteriores</button><button type="button" data-infra-next>Siguientes →</button></div></div>
    </section>`;

    const $ = selector => host.querySelector(selector);
    const value = key => $(`[data-filter="${key}"]`)?.value;
    const reportKey = visit => JSON.stringify([visit.site_id || visit.site?.legacy_id, visit.visit_date]);
    function options(key, entries, label) {
      const el = $(`[data-filter="${key}"]`);
      if (!el) return;
      const previous = el.value;
      const choices = new Map(entries);
      el.innerHTML = `<option value="*">${label}</option>` + [...choices].map(([id,name]) =>
        `<option value="${esc(id)}">${esc(name)}</option>`).join("");
      el.value = choices.has(previous) ? previous : "*";
    }
    function updateFilters() {
      const dates = visits.map(v => String(v.visit_date));
      options("month", [...new Set(dates.map(d => d.slice(5,7)).filter(Boolean))].sort().map(m => [m, monthName(m)]), "Todos los meses");
      options("year", dates.map(d => d.slice(0,4)).sort().reverse().map(y => [y,y]), "Todos los años");
      options("site", visits.map(v => [String(v.site_id), v.site?.name || "Sede"]), "Todas");
      options("coordinator", visits.map(v => [coordinator(v), coordinator(v)]), "Todos");
      options("tech", visits.map(v => [String(v.technician_id), v.technician_name || "Sin nombre"]), "Todos");
    }
    function dailyReports() {
      const groups = new Map();
      const date = value("date"), site = value("site"), coord = value("coordinator"), tech = value("tech");
      const month = value("month"), year = value("year");
      for (const visit of visits) {
        const day = visit.visit_date || "";
        if (isAdmin) {
          if (date && day !== date) continue;
          if (site !== "*" && String(visit.site_id) !== site) continue;
          if (coord !== "*" && coordinator(visit) !== coord) continue;
        } else if ((month !== "*" && day.slice(5,7) !== month) ||
                   (year !== "*" && day.slice(0,4) !== year)) continue;
        const key = reportKey(visit);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(visit);
      }
      return [...groups].filter(([,group]) => !isAdmin || tech === "*" ||
        group.some(v => String(v.technician_id) === tech));
    }
    let groupCount = 0;
    function updateSelection() {
      $('[data-infra-report-count]').textContent = `${groupCount} informes · ${selected.size} seleccionados`;
      host.querySelectorAll('[data-infra-export]').forEach(button => { button.disabled = selected.size === 0; });
    }
    function render() {
      const groups = dailyReports();
      groupCount = groups.length;
      const pages = Math.max(1, Math.ceil(groups.length / pageSizeValue));
      page = Math.min(page, pages);
      const visible = groups.slice((page-1)*pageSizeValue, page*pageSizeValue);
      updateSelection();
      $('[data-infra-rows]').innerHTML = visible.map(([key,group]) => {
        const visit = group[0];
        const day = esc(dateText(visit.visit_date)), site = esc(visit.site?.name || "Sede");
        const names = [...new Set(group.map(row => row.technician_name).filter(Boolean))].join(", ");
        return `<tr><td><input type="checkbox" class="infra-report-checked" data-infra-report-key="${esc(key)}" aria-label="Seleccionar informe completo del ${day} · ${site}" ${selected.has(key) ? "checked" : ""}></td>
          <td>${day}</td>${technicianOnly ? "" : `<td>${site}</td><td>${esc(names || "—")}</td><td>${esc(coordinator(visit))}</td>`}</tr>`;
      }).join("");
      $('[data-infra-table]').hidden = groups.length === 0;
      $('[data-infra-empty]').hidden = groups.length > 0;
      $('[data-infra-pagination]').hidden = pages <= 1;
      $('[data-infra-page-label]').textContent = `Página ${page} de ${pages}`;
      $('[data-infra-prev]').disabled = page <= 1; $('[data-infra-next]').disabled = page >= pages;
    }

    function openPdfPopup() {
      const popup = global.open("", "_blank");
      if (!popup) throw new Error("Permite las ventanas emergentes para generar el PDF.");
      popup.document.write("<!doctype html><title>Preparando informe</title><p style='font:16px Arial;padding:24px'>Preparando informe de infraestructura…</p>");
      return popup;
    }

    async function exportPdf(kind) {
      const keys = [...new Set(visits.map(reportKey).filter(key => selected.has(key)))];
      if (!keys.length) return;
      let popup;
      try {
        popup = openPdfPopup();
        const details = await global.SmartFitSupabaseData.listInfrastructureVisits({
          siteLegacyId, technicianOnly, reportDays: keys.map(key => JSON.parse(key))
        });
        const byDay = new Map(keys.map(key => [key, []]));
        for (const visit of details) {
          if (visit.events?.length) byDay.get(reportKey(visit))?.push(visit);
        }
        if (keys.some(key => !byDay.get(key).length)) {
          throw new Error("Algún informe seleccionado ya no está disponible. Actualiza el listado antes de exportar.");
        }
        const rows = flatten(keys.flatMap(key => byDay.get(key)));
        const full = kind === "full";
        const paths = full ? [...new Set(rows.flatMap(row => (row.photos || []).map(p => p.path).filter(Boolean)))] : [];
        const urls = paths.length ? await global.SmartFitSupabaseData.getInfrastructurePhotoUrls(paths) : {};
        const issued = new Intl.DateTimeFormat("es-CL", {dateStyle:"long"}).format(new Date());
        const logo = esc(new URL("IMG/logo-header.png", global.location.href).href);
        const header = (title, subtitle) => `<header><img src="${logo}" alt="Smart Fit"><div><h1>${title}</h1><small>Fecha de emisión: ${issued} · ${subtitle}</small></div></header>`;
        const footer = "<footer>Se genera el informe para lo que se estime conveniente.</footer>";
        const field = (label, text) => `<div><b>${label}:</b> ${esc(text || "—")}</div>`;
        const sector = v => [v.sector_number, v.sector_name].filter(x => x != null && x !== "").join(" · ");
        let body;
        if (full) {
          const records = rows.map((row,index) => {
            const v = row.visit;
            const pictures = (row.photos || []).map((p,i) =>
              `<figure>${urls[p.path] ? `<img src="${esc(urls[p.path])}" alt="Fotografía ${i+1}">` : "Fotografía no disponible"}<figcaption>Fotografía ${i+1}</figcaption></figure>`).join("");
            return `<article><div class="record-title"><h2>${esc(row.name)}</h2><b>Registro ${index+1} de ${rows.length}</b></div>
              <section class="fields">${field("Fecha",dateText(v.visit_date))}${field("Estado",row.status)}${field("Sede",v.site?.name)}${field("Técnico",v.technician_name)}${field("Sector",sector(v))}${field("Coordinador",coordinator(v))}</section>
              <h3>Observaciones</h3><p>${esc(row.observations || "Sin observaciones")}</p>
              <h3>Registro fotográfico</h3>${pictures ? `<section class="pictures">${pictures}</section>` : "<p>Sin fotografías adjuntas.</p>"}</article>`;
          });
          body = header("INFORME DE INFRAESTRUCTURA", `${keys.length} informes · ${rows.length} eventos`) + records.join("") + footer;
        } else {
          const cells = rows.map(row => {
            const v = row.visit;
            return `<tr><td>${esc(dateText(v.visit_date))}</td><td>${esc(v.site?.name)}</td><td>${esc(sector(v))}</td><td>${esc(v.technician_name)}</td><td>${esc(row.name)}</td><td>${esc(row.status)}</td><td>${esc(row.observations || "Sin observaciones")}</td></tr>`;
          }).join("");
          body = header("INFORME LITE DE INFRAESTRUCTURA", `${keys.length} informes · ${rows.length} eventos`) +
            `<table><colgroup>${[10,14,13,13,15,12,23].map(width=>`<col style="width:${width}%">`).join("")}</colgroup><thead><tr><th>Fecha</th><th>Sede</th><th>Sector</th><th>Técnico</th><th>Evento</th><th>Estado</th><th>Observaciones</th></tr></thead><tbody>${cells}</tbody></table>` + footer;
        }
        popup.document.open();
        popup.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Infraestructura · ${full?"Full":"Lite"}</title><style>
          @page{size:letter portrait;margin:8mm}*{box-sizing:border-box}html,body{margin:0;width:100%;font:10pt/1.35 Arial,sans-serif;color:#18202a}header{display:flex;align-items:center;justify-content:space-between;gap:6mm;border-bottom:2px solid #ffb51b;padding-bottom:3mm}header img{width:34mm;background:#000;padding:1.5mm;border-radius:1mm;print-color-adjust:exact;-webkit-print-color-adjust:exact}header div{text-align:right}h1{font-size:16pt;margin:0}small{font-size:8.5pt}h2{font-size:10pt;border-bottom:1px solid #bbb;padding-bottom:1mm;margin:4mm 0 2mm}.fields,.pictures{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:2mm 5mm}p,td{white-space:pre-wrap;overflow-wrap:anywhere}p{margin:0}figure{margin:0;text-align:center;break-inside:avoid}figure img{display:block;width:100%;height:39mm;object-fit:contain;border:1px solid #ddd}figcaption,footer{font-size:8pt}footer{text-align:center;border-top:1px solid #bbb;padding-top:2mm;margin-top:4mm}
          article{padding:2mm 0;overflow-wrap:anywhere}
          article+article{border-top:1px solid #99a1aa}
          .record-title{display:flex;align-items:baseline;justify-content:space-between;gap:4mm;margin-bottom:2mm}
          .record-title h2{border:0;padding:0;margin:0;font-size:12pt}
          .record-title b{white-space:nowrap;font-size:8pt}
          article .fields{gap:1mm 4mm}
          article h3{font-size:9pt;margin:2mm 0 1mm;border-bottom:1px solid #ccd0d4}
          table{width:100%;border-collapse:collapse;table-layout:fixed;margin-top:3mm;font-size:8.5pt}th,td{padding:1.5mm;border:1px solid #bbb;text-align:left;vertical-align:top}thead{display:table-header-group}tr{break-inside:avoid}
        </style></head><body>${body}<script>window.addEventListener('load',()=>{window.opener?.SmartFitPdfReport?.attach(window);window.print()});<\/script></body></html>`);
        popup.document.close();
      } catch (error) { popup?.close(); global.alert(error.message || "No se pudo generar el informe."); }
    }

    host.addEventListener("click", async event => {
      const toggle = event.target.closest("[data-infra-report-key]");
      if (toggle) {
        if (toggle.checked) selected.add(toggle.dataset.infraReportKey);
        else selected.delete(toggle.dataset.infraReportKey);
        updateSelection(); return;
      }
      const exportButton = event.target.closest("[data-infra-export]");
      if (exportButton) { await exportPdf(exportButton.dataset.infraExport); return; }
      if (event.target.closest("[data-infra-clear]")) {
        host.querySelectorAll("[data-filter]").forEach(el => { el.value = el.type === "date" ? "" : "*"; });
        selected.clear();
        page = 1; render(); return;
      }
      if (event.target.closest("[data-infra-prev]")) { page = Math.max(1, page - 1); render(); return; }
      if (event.target.closest("[data-infra-next]")) { page += 1; render(); }
    });
    host.addEventListener("change", event => {
      if (event.target.matches("[data-filter]")) { selected.clear(); page = 1; render(); }
    });
    async function loadVisits() {
      if (technicianOnly && !String(siteLegacyId ?? "").trim()) throw new Error("Selecciona una sede para ver sus informes.");
      const rows = await global.SmartFitSupabaseData.listInfrastructureVisits({siteLegacyId, technicianOnly, summaryOnly:true});
      visits = Array.isArray(rows) ? rows : [];
      selected.clear(); page = 1; updateFilters(); render(); return visits;
    }
    let pendingRead;
    function refresh() {
      if (!pendingRead) pendingRead = loadVisits().finally(() => {
        pendingRead = null;
        $(".infra-loading").hidden = true;
      });
      return pendingRead;
    }
    const ready = refresh().catch(error => {
      $('[data-infra-report-count]').textContent = "No se pudieron cargar los informes. " + (error.message || "");
      return [];
    });
    return { ready, refresh };
  }

  global.SmartFitInfrastructureReports = { mount };
})(window);
