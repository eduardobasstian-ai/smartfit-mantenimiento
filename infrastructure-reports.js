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
    .infra-report-list{display:grid;gap:8px;min-width:0}
    .infra-daily{border:1px solid var(--border,#383b47);border-radius:9px;padding:12px;overflow-wrap:anywhere}
    .infra-daily label{display:flex;align-items:center;gap:8px;font-weight:700;cursor:pointer}
    .infra-daily small,.infra-daily summary{display:block;margin-top:6px;color:var(--muted,#aeb2bf)}
    .infra-daily summary{cursor:pointer;text-decoration:underline}
    .infra-daily li{margin:.6em 0}
    .infra-report-filter{display:grid;min-width:0;gap:6px;color:var(--muted,#aeb2bf);font-size:11px;font-weight:700}
    .infra-report-filter input,.infra-report-filter select{width:100%;min-width:0;min-height:38px;padding:0 10px;border:1px solid #383b47;border-radius:9px;background:#111319;color:var(--text,#f5f5f7);font:inherit;font-size:12px}
    .infra-report-summary{display:flex;min-width:0;width:100%;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin:0 0 8px}
    .infra-report-count{min-width:0;color:var(--muted,#aeb2bf);font-size:12px}
    .infra-report-actions{display:flex;gap:8px;flex-wrap:wrap}
    .infra-report-actions button{min-height:38px;padding:0 13px;border:1px solid #383b47;border-radius:10px;background:#20222a;color:var(--text,#f5f5f7);font:inherit;font-size:12px;font-weight:750}
    .infra-report-actions [data-infra-export=full]{background:var(--yellow,#ffb51b);border-color:var(--yellow,#ffb51b);color:#17130a}
    .infra-report-actions button:disabled{opacity:.48;cursor:not-allowed}
    .infra-report-table-wrap{width:100%;min-width:0;max-width:100%;overflow-x:auto;overflow-y:hidden;overscroll-behavior-x:contain;-webkit-overflow-scrolling:touch}
    .infra-report-table-wrap[hidden]{display:none!important}
    .infra-report-table{width:100%;min-width:1050px;border-collapse:collapse;table-layout:auto}
    .infra-report-table th,.infra-report-table td{padding:11px 10px;border-bottom:1px solid #30323c;text-align:left;vertical-align:middle}
    .infra-report-table th{color:#858895;font-size:10px;font-weight:800;letter-spacing:.55px;text-transform:uppercase;white-space:nowrap}
    .infra-report-table td{color:#e7e7eb;font-size:12px}
    .infra-report-table .infra-report-group td{padding:9px 10px;background:#20222a;color:var(--muted,#aeb2bf);font-size:11px;font-weight:750}
    .infra-report-group label{display:flex;align-items:center;gap:9px;cursor:pointer}
    .infra-report-sector-code{color:var(--yellow,#ffb51b);font-weight:850}
    .infra-report-event-name{font-weight:750}
    .infra-report-detail{display:block;max-width:280px;color:var(--muted,#aeb2bf);font-size:11px;line-height:1.45;overflow-wrap:anywhere}
    .infra-report-status{display:inline-flex;padding:5px 8px;border-radius:20px;background:#30333d;color:var(--text,#f5f5f7);font-size:10px;font-weight:800;white-space:nowrap}
    .infra-report-status[data-status="Preventivo"]{background:#3b321d;color:#f7d98a}
    .infra-report-status[data-status="Correctivo"]{background:#3a2025;color:#ffb5b9}
    .infra-report-status[data-status="Sin observación"]{background:#153b2d;color:#a7f3d0}
    .infra-report-checked{width:17px;height:17px;accent-color:var(--yellow,#ffb51b)}
    .infra-report-photos{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
    .infra-report-photos button{border:0;background:none;padding:0;cursor:zoom-in}
    .infra-report-photos img{display:block;width:44px;height:44px;border-radius:7px;object-fit:cover}
    .infra-report-load-photos{min-height:30px!important;padding:0 9px!important;font-size:10px!important}
    .infra-report-empty{padding:26px 12px;color:var(--muted,#aeb2bf);text-align:center;font-size:13px}
    .infra-report-pagination{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-top:12px}
    .infra-report-viewer{position:fixed;inset:0;z-index:10000;display:grid;place-items:center;background:#000d}
    .infra-report-viewer[hidden]{display:none}
    .infra-report-viewer-frame{position:relative;display:block;width:min(94vw,1100px);height:min(92dvh,850px);background:#111;border-radius:12px}
    .infra-report-viewer .infra-report-close,.infra-report-viewer .infra-report-download{position:fixed;z-index:10002;right:max(10px,env(safe-area-inset-right));width:38px;height:38px;display:grid;place-items:center;padding:0;border:1px solid #d1d3d8;border-radius:50%;background:#fff;color:#17191f;box-shadow:0 2px 12px #0008;cursor:pointer}
    .infra-report-viewer .infra-report-close{top:max(10px,env(safe-area-inset-top));font-size:23px;line-height:1}
    .infra-report-viewer .infra-report-download{top:calc(max(10px,env(safe-area-inset-top)) + 46px)}
    .infra-report-viewer .infra-report-close:hover,.infra-report-viewer .infra-report-download:hover{border-color:var(--yellow,#ffb51b);color:#8a5a00}
    .infra-report-viewer .record-photo-carousel-viewport{position:absolute;inset:0;width:100%;height:100%;overflow:hidden;touch-action:none}
    .infra-report-viewer .record-photo-carousel-track{display:flex;width:100%;height:100%}
    .infra-report-viewer .record-photo-carousel-slide{flex:0 0 100%;display:grid;place-items:center}
    .infra-report-viewer .record-photo-carousel-slide img{display:block;max-width:none;max-height:none;object-fit:contain}
    .infra-report-viewer-frame.has-record-photo-carousel{width:auto;height:auto;max-width:96vw;max-height:94dvh}
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
    const pageSizeValue = pageSize || (technicianOnly ? 2 : 8);
    const selected = new Set(), photoCache = new Map();
    let visits = [], page = 1;
    const isAdmin = Array.isArray(adminSites);
    const assignments = new Map((adminSites || []).map(site => [String(site.id), site.coordinator || "Sin asignar"]));
    const coordinator = visit => assignments.get(String(visit.site?.legacy_id)) || "Sin asignar";
    const filter = (key, label, all) => `<label class="infra-report-filter">${label}<select data-filter="${key}"><option value="*">${all}</option></select></label>`;
    const viewerId = `infraReportViewer-${Math.random().toString(36).slice(2, 8)}`;
    host.innerHTML = `<section class="infra-report" aria-label="${esc(heading)}">
      <div class="infra-report-toolbar" aria-label="Filtros de informes de infraestructura">
        ${isAdmin ? `<label class="infra-report-filter">Fecha<input data-filter="date" type="date"></label>${filter("site","Sede","Todas")}${filter("coordinator","Coordinador","Todos")}${filter("tech","Técnico","Todos")}` : filter("month","Mes","Todos los meses") + filter("year","Año","Todos los años")}
      </div>
      <div class="infra-report-summary"><span class="infra-report-count" data-infra-report-count>Cargando informes…</span><div class="infra-report-actions"><button type="button" data-infra-export="full" disabled>PDF Full</button><button type="button" data-infra-export="lite" disabled>PDF Lite</button><button type="button" data-infra-clear>Limpiar filtros</button></div></div>
      <div class="infra-report-list" data-infra-rows></div>
      <div class="infra-report-empty" data-infra-empty hidden>No hay informes que coincidan con los filtros.</div>
      <div class="infra-report-pagination" data-infra-pagination hidden><span data-infra-page-label></span><div class="infra-report-actions"><button type="button" data-infra-prev>← Anteriores</button><button type="button" data-infra-next>Siguientes →</button></div></div>
      <div class="infra-report-viewer" id="${viewerId}" hidden><div class="infra-report-viewer-frame"><button class="infra-report-close" type="button" aria-label="Cerrar fotografía" title="Cerrar fotografía">×</button><button class="infra-report-download record-photo-download" type="button" aria-label="Descargar fotografía" title="Descargar fotografía" hidden><svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v11m0 0 4-4m-4 4-4-4M5 17v3h14v-3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button><img alt="" hidden><div class="record-photo-carousel-viewport" hidden><div class="record-photo-carousel-track"></div></div></div></div>
    </section>`;

    const $ = selector => host.querySelector(selector);
    const value = key => $(`[data-filter="${key}"]`)?.value;
    const allRows = () => flatten(visits);
    const reportKey = visit => JSON.stringify([visit.site_id || visit.site?.legacy_id, visit.visit_date]);
    const selectedRows = () => allRows().filter(row => selected.has(reportKey(row.visit)));
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
      for (const visit of visits) {
        const day = visit.visit_date || "";
        if (isAdmin) {
          if (value("date") && day !== value("date")) continue;
          if (value("site") !== "*" && String(visit.site_id) !== value("site")) continue;
          if (value("coordinator") !== "*" && coordinator(visit) !== value("coordinator")) continue;
        } else if ((value("month") !== "*" && day.slice(5,7) !== value("month")) ||
                   (value("year") !== "*" && day.slice(0,4) !== value("year"))) continue;
        if (!visit.events?.length) continue;
        const key = reportKey(visit);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(visit);
      }
      return [...groups].filter(([,group]) => !isAdmin || value("tech") === "*" ||
        group.some(v => String(v.technician_id) === value("tech")));
    }
    function render() {
      const groups = dailyReports();
      const pages = Math.max(1, Math.ceil(groups.length / pageSizeValue));
      page = Math.min(page, pages);
      const visible = groups.slice((page-1)*pageSizeValue, page*pageSizeValue);
      const expanded = new Set([...host.querySelectorAll("details[open]")].map(el => el.dataset.report));
      $('[data-infra-report-count]').textContent = `${groups.length} informes · ${selected.size} seleccionados`;
      $('[data-infra-rows]').innerHTML = visible.map(([key,group]) => {
        const visit = group[0], rows = flatten(group);
        const names = [...new Set(group.map(v => v.technician_name).filter(Boolean))].join(", ");
        const detail = rows.map(row => {
          const cached = photoCache.get(row.key) || [];
          const photos = cached.map(p => `<button type="button" data-enlarge-image="${esc(p.url)}" data-image-alt="${esc(row.name)}"><img src="${esc(p.url)}" alt="${esc(row.name)}"></button>`).join("");
          const load = row.photos?.length && !cached.length ? `<button type="button" data-infra-load-photos="${esc(row.key)}">Ver fotos (${row.photos.length})</button>` : "";
          return `<li><strong>${esc(row.visit.sector_name)} · ${esc(row.name)}</strong> · ${esc(row.status)}<br>${esc(row.observations || "Sin observaciones")}<div class="infra-report-photos">${photos}${load}</div></li>`;
        }).join("");
        return `<article class="infra-daily"><label><input type="checkbox" class="infra-report-checked" data-infra-report-key="${esc(key)}" ${selected.has(key)?"checked":""}>${esc(dateText(visit.visit_date))} · ${esc(visit.site?.name || "Sede")}</label>
          ${isAdmin ? `<small>Coordinador: ${esc(coordinator(visit))} · Técnico: ${esc(names)}</small>` : ""}
          <details data-report="${esc(key)}" ${expanded.has(key)?"open":""}><summary>Ver detalle (${rows.length} eventos)</summary><ul>${detail}</ul></details></article>`;
      }).join("");
      $('[data-infra-empty]').hidden = groups.length > 0;
      $('[data-infra-pagination]').hidden = pages <= 1;
      $('[data-infra-page-label]').textContent = `Página ${page} de ${pages}`;
      $('[data-infra-prev]').disabled = page <= 1; $('[data-infra-next]').disabled = page >= pages;
      host.querySelectorAll('[data-infra-export]').forEach(button => { button.disabled = selected.size === 0; });
    }

    function openPdfPopup() {
      const popup = global.open("", "_blank");
      if (!popup) throw new Error("Permite las ventanas emergentes para generar el PDF.");
      popup.document.write("<!doctype html><title>Preparando informe</title><p style='font:16px Arial;padding:24px'>Preparando informe de infraestructura…</p>");
      return popup;
    }

    async function exportPdf(kind) {
      const rows = selectedRows();
      if (!rows.length) return;
      let popup;
      try {
        popup = openPdfPopup();
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
          body = rows.map((row,index) => {
            const v = row.visit;
            const pictures = (row.photos || []).map((p,i) =>
              `<figure>${urls[p.path] ? `<img src="${esc(urls[p.path])}" alt="Fotografía ${i+1}">` : "Fotografía no disponible"}<figcaption>Fotografía ${i+1}</figcaption></figure>`).join("");
            return `<article>${header("INFORME DE INFRAESTRUCTURA",`Registro ${index+1} de ${rows.length}`)}
              <h2>Datos del evento</h2><section class="fields">${field("Fecha",dateText(v.visit_date))}${field("Estado",row.status)}${field("Sede",v.site?.name)}${field("Técnico",v.technician_name)}${field("Sector",sector(v))}${isAdmin ? field("Coordinador",coordinator(v)) : ""}</section>
              <h2>Evento revisado</h2><p>${esc(row.name)}</p><h2>Observaciones</h2><p>${esc(row.observations || "Sin observaciones")}</p>
              <h2>Registro fotográfico</h2>${pictures ? `<section class="pictures">${pictures}</section>` : "<p>Sin fotografías adjuntas.</p>"}${footer}</article>`;
          }).join("");
        } else {
          const cells = rows.map(row => {
            const v = row.visit;
            return `<tr><td>${esc(dateText(v.visit_date))}</td><td>${esc(v.site?.name)}${isAdmin ? `<br>Coord.: ${esc(coordinator(v))}` : ""}</td><td>${esc(sector(v))}</td><td>${esc(v.technician_name)}</td><td>${esc(row.name)}</td><td>${esc(row.status)}</td><td>${esc(row.observations || "Sin observaciones")}</td></tr>`;
          }).join("");
          body = header("INFORME LITE DE INFRAESTRUCTURA", `${selected.size} informes · ${rows.length} eventos`) +
            `<table><colgroup>${[10,14,13,13,15,12,23].map(width=>`<col style="width:${width}%">`).join("")}</colgroup><thead><tr><th>Fecha</th><th>Sede</th><th>Sector</th><th>Técnico</th><th>Evento</th><th>Estado</th><th>Observaciones</th></tr></thead><tbody>${cells}</tbody></table>` + footer;
        }
        popup.document.open();
        popup.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Infraestructura · ${full?"Full":"Lite"}</title><style>
          @page{size:letter portrait;margin:8mm}*{box-sizing:border-box}html,body{margin:0;width:100%;font:10pt/1.35 Arial,sans-serif;color:#18202a}header{display:flex;align-items:center;justify-content:space-between;gap:6mm;border-bottom:2px solid #ffb51b;padding-bottom:3mm}header img{width:34mm;background:#000;padding:1.5mm;border-radius:1mm;print-color-adjust:exact;-webkit-print-color-adjust:exact}header div{text-align:right}h1{font-size:16pt;margin:0}small{font-size:8.5pt}h2{font-size:10pt;border-bottom:1px solid #bbb;padding-bottom:1mm;margin:4mm 0 2mm}article{display:flex;flex-direction:column;min-height:262mm}article+article{break-before:page}.fields,.pictures{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:2mm 5mm}p,td{white-space:pre-wrap;overflow-wrap:anywhere}p{margin:0}figure{margin:0;text-align:center;break-inside:avoid}figure img{display:block;width:100%;height:57mm;object-fit:contain;border:1px solid #ddd}figcaption,footer{font-size:8pt}footer{text-align:center;border-top:1px solid #bbb;padding-top:2mm;margin-top:4mm}article footer{margin-top:auto}table{width:100%;border-collapse:collapse;table-layout:fixed;margin-top:3mm;font-size:8.5pt}th,td{padding:1.5mm;border:1px solid #bbb;text-align:left;vertical-align:top}thead{display:table-header-group}tr{break-inside:avoid}
        </style></head><body>${body}<script>window.addEventListener('load',()=>window.print());<\/script></body></html>`);
        popup.document.close();
      } catch (error) { popup?.close(); global.alert(error.message || "No se pudo generar el informe."); }
    }

    let carousel = null;
    const overlay = $(`#${viewerId}`), frame = overlay.querySelector(".infra-report-viewer-frame");
    frame.id = `${viewerId}-frame`;
    overlay.querySelector("img").id = `${viewerId}-image`;
    overlay.querySelector(".infra-report-close").id = `${viewerId}-close`;
    overlay.querySelector(".infra-report-download").id = `${viewerId}-download`;
    overlay.querySelector(".record-photo-carousel-viewport").id = `${viewerId}-viewport`;
    overlay.querySelector(".record-photo-carousel-track").id = `${viewerId}-track`;
    try {
      carousel = global.SmartFitRecordPhotoCarousel?.create({ root:document, overlayId:viewerId, frameId:frame.id, imageId:`${viewerId}-image`, downloadButtonId:`${viewerId}-download`, viewportId:`${viewerId}-viewport`, trackId:`${viewerId}-track` });
    } catch (error) { console.warn("No se pudo inicializar el visor de fotografías de infraestructura.", error); }
    overlay.querySelector(".infra-report-close").addEventListener("click", () => { carousel?.close(); overlay.hidden = true; });

    host.addEventListener("click", async event => {
      const toggle = event.target.closest("[data-infra-report-key]");
      if (toggle) {
        if (toggle.checked) selected.add(toggle.dataset.infraReportKey);
        else selected.delete(toggle.dataset.infraReportKey);
        render(); return;
      }
      const loadPhotos = event.target.closest("[data-infra-load-photos]");
      if (loadPhotos) {
        const row = allRows().find(item => item.key === loadPhotos.dataset.infraLoadPhotos); if (!row) return;
        try {
          const photoPaths = (row.photos || []).map(photo => photo.path).filter(Boolean);
          const signed = await global.SmartFitSupabaseData.getInfrastructurePhotoUrls(photoPaths);
          photoCache.set(row.key, (row.photos || []).filter(photo => signed[photo.path]).map(photo => ({ path:photo.path, url:signed[photo.path] })));
          render();
        } catch (error) { global.alert(error.message || "No se pudieron abrir las fotografías."); }
        return;
      }
      const photo = event.target.closest("[data-enlarge-image]");
      if (photo && carousel) { event.stopPropagation(); carousel.openFromTrigger(photo, photo.dataset.enlargeImage, photo.dataset.imageAlt); return; }
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
    async function refresh() {
      const rows = await global.SmartFitSupabaseData.listInfrastructureVisits({siteLegacyId, technicianOnly});
      visits = Array.isArray(rows) ? rows : [];
      selected.clear(); page = 1; updateFilters(); render(); return visits;
    }
    const ready = refresh().catch(error => {
      $('[data-infra-report-count]').textContent = "No se pudieron cargar los informes. " + (error.message || "");
      return [];
    });
    return { ready, refresh };
  }

  global.SmartFitInfrastructureReports = { mount };
})(window);
