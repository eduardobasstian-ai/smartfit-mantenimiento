(function (global) {
  "use strict";

  const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[char]));
  const dateText = value => {
    const date = new Date(`${String(value || "").slice(0, 10)}T12:00:00`);
    return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("es-CL", { dateStyle:"short" }).format(date);
  };
  const normalize = value => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es");
  const monthName = value => new Intl.DateTimeFormat("es-CL", { month:"long" }).format(new Date(2000, Number(value) - 1, 1));

  const styles = `
    .infra-report{width:100%;min-width:0;max-width:100%;overflow:hidden;color:var(--text,#f5f5f7)}
    .infra-report-toolbar{display:grid;width:100%;min-width:0;grid-template-columns:repeat(6,minmax(0,1fr));gap:10px;margin:8px 0 14px}
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
    @media(max-width:900px){.infra-report-toolbar{grid-template-columns:repeat(3,minmax(0,1fr))}}
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

  function mount({ host, siteLegacyId="", technicianOnly=false, heading="Informes de infraestructura", pageSize=null } = {}) {
    if (!host || !global.SmartFitSupabaseData) throw new Error("No está disponible el panel de informes de infraestructura.");
    if (host.parentNode) { const fresh = host.cloneNode(false); host.parentNode.replaceChild(fresh, host); host = fresh; }
    addStyles();
    const pageSizeValue = pageSize || (technicianOnly ? 2 : 8);
    const selected = new Set(), photoCache = new Map();
    let visits = [], page = 1;
    const viewerId = `infraReportViewer-${Math.random().toString(36).slice(2, 8)}`;
    host.innerHTML = `<section class="infra-report" aria-label="${esc(heading)}">
      <div class="infra-report-toolbar" aria-label="Filtros de informes de infraestructura">
        <label class="infra-report-filter">Desde<input data-infra-from type="date" aria-label="Desde fecha"></label>
        <label class="infra-report-filter">Hasta<input data-infra-to type="date" aria-label="Hasta fecha"></label>
        <label class="infra-report-filter">Técnico<select data-infra-technician><option value="*">Todos</option></select></label>
        <label class="infra-report-filter">Sede<select data-infra-site><option value="*">Todas</option></select></label>
        <label class="infra-report-filter">Estado<select data-infra-status><option value="*">Todos</option><option>Preventivo</option><option>Correctivo</option><option>Sin observación</option></select></label>
        <label class="infra-report-filter">Buscar<input data-infra-search type="search" placeholder="Sector o evento..." aria-label="Buscar sector o evento"></label>
        <label class="infra-report-filter">Mes<select data-infra-month><option value="*">Todos los meses</option></select></label>
        <label class="infra-report-filter">Año<select data-infra-year><option value="*">Todos los años</option></select></label>
      </div>
      <div class="infra-report-summary"><span class="infra-report-count" data-infra-report-count>Cargando informes…</span><div class="infra-report-actions"><button type="button" data-infra-export="full" disabled>PDF Full</button><button type="button" data-infra-export="lite" disabled>PDF Lite</button><button type="button" data-infra-clear>Limpiar filtros</button></div></div>
      <div class="infra-report-table-wrap" data-infra-table-wrap hidden><table class="infra-report-table"><thead><tr><th aria-label="Seleccionar"></th><th>Fecha</th><th>Sede</th><th>Sector</th><th>Evento</th><th>Estado</th><th>Técnico</th><th>Detalle</th><th>Fotografías</th></tr></thead><tbody data-infra-rows></tbody></table></div>
      <div class="infra-report-empty" data-infra-empty hidden>No hay informes que coincidan con los filtros.</div>
      <div class="infra-report-pagination" data-infra-pagination hidden><span data-infra-page-label></span><div class="infra-report-actions"><button type="button" data-infra-prev>← Anteriores</button><button type="button" data-infra-next>Siguientes →</button></div></div>
      <div class="infra-report-viewer" id="${viewerId}" hidden><div class="infra-report-viewer-frame"><button class="infra-report-close" type="button" aria-label="Cerrar fotografía" title="Cerrar fotografía">×</button><button class="infra-report-download record-photo-download" type="button" aria-label="Descargar fotografía" title="Descargar fotografía" hidden><svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v11m0 0 4-4m-4 4-4-4M5 17v3h14v-3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button><img alt="" hidden><div class="record-photo-carousel-viewport" hidden><div class="record-photo-carousel-track"></div></div></div></div>
    </section>`;

    const $ = selector => host.querySelector(selector);
    const month = $('[data-infra-month]'), year = $('[data-infra-year]'), technician = $('[data-infra-technician]'), site = $('[data-infra-site]'), status = $('[data-infra-status]');
    const setOptions = (select, values, allLabel, formatter = value => value) => {
      const current = select.value || "*";
      select.innerHTML = `<option value="*">${allLabel}</option>${values.map(value => `<option value="${esc(value)}">${esc(formatter(value))}</option>`).join("")}`;
      select.value = values.includes(current) ? current : "*";
    };
    const filteredVisits = () => {
      const from = $('[data-infra-from]').value, to = $('[data-infra-to]').value;
      const monthValue = month.value, yearValue = year.value, techValue = technician.value, siteValue = site.value, statusValue = status.value;
      const query = normalize($('[data-infra-search]').value.trim());
      return visits.filter(visit => {
        const date = String(visit.visit_date || "").slice(0, 10);
        if (from && date < from || to && date > to) return false;
        if (monthValue !== "*" && date.slice(5, 7) !== monthValue) return false;
        if (yearValue !== "*" && date.slice(0, 4) !== yearValue) return false;
        if (techValue !== "*" && String(visit.technician_id) !== techValue) return false;
        if (siteValue !== "*" && String(visit.site?.legacy_id ?? visit.site_id) !== siteValue) return false;
        const events = Array.isArray(visit.events) ? visit.events : [];
        const matchedEvents = events.filter(item => (!statusValue || statusValue === "*" || item.status === statusValue) && (!query || normalize([visit.sector_number, visit.sector_name, visit.technician_name, visit.site?.name, item.name, item.observations].join(" ")).includes(query)));
        if (!matchedEvents.length) return false;
        visit._filteredEvents = matchedEvents;
        return true;
      });
    };
    const allRows = () => flatten(visits);
    const selectedRows = () => { const byKey = new Map(allRows().map(row => [row.key, row])); return [...selected].map(key => byKey.get(key)).filter(Boolean); };

    function render() {
      const filtered = filteredVisits();
      const months = [...new Set(visits.map(row => String(row.visit_date || "").slice(5, 7)).filter(value => /^\d{2}$/.test(value)))].sort((a,b) => Number(b)-Number(a));
      const years = [...new Set(visits.map(row => String(row.visit_date || "").slice(0, 4)).filter(value => /^\d{4}$/.test(value)))].sort((a,b) => Number(b)-Number(a));
      const techs = [...new Map(visits.map(row => [String(row.technician_id), { id:String(row.technician_id), name:row.technician_name }])).values()].sort((a,b) => a.name.localeCompare(b.name,"es"));
      const sites = [...new Map(visits.map(row => [String(row.site?.legacy_id ?? row.site_id), { id:String(row.site?.legacy_id ?? row.site_id), name:row.site?.name || "Sede" }])).values()].sort((a,b) => a.name.localeCompare(b.name,"es"));
      setOptions(month, months, "Todos los meses", monthName); setOptions(year, years, "Todos los años");
      setOptions(technician, techs.map(row => row.id), "Todos", value => techs.find(row => row.id === value)?.name || value);
      setOptions(site, sites.map(row => row.id), "Todas", value => sites.find(row => row.id === value)?.name || value);

      const pageCount = Math.max(1, Math.ceil(filtered.length / pageSizeValue)); page = Math.min(page, pageCount);
      const visible = filtered.slice((page - 1) * pageSizeValue, page * pageSizeValue);
      const eventCount = visible.reduce((total, row) => total + row._filteredEvents.length, 0);
      $('[data-infra-report-count]').textContent = `${filtered.length} ${filtered.length === 1 ? "visita" : "visitas"} · ${eventCount} eventos · ${selected.size} seleccionados`;
      $('[data-infra-rows]').innerHTML = visible.map(visit => {
        const events = visit._filteredEvents;
        const allSelected = events.length > 0 && events.every(item => selected.has(`${visit.id}:${visit.events.indexOf(item)}`));
        const group = `<tr class="infra-report-group"><td colspan="9"><label><input class="infra-report-checked" type="checkbox" data-infra-select-visit="${esc(visit.id)}" ${allSelected ? "checked" : ""} aria-label="Seleccionar todos los eventos de esta visita"><span><span class="infra-report-sector-code">Sector ${esc(String(visit.sector_number).padStart(2,"0"))}</span> · ${esc(visit.sector_name)} · ${esc(dateText(visit.visit_date))} · ${esc(visit.site?.name || "Sede")} · ${esc(visit.technician_name)}</span></label></td></tr>`;
        return group + events.map(item => {
          const eventIndex = visit.events.indexOf(item), key = `${visit.id}:${eventIndex}`, photos = Array.isArray(item.photos) ? item.photos : [], cached = photoCache.get(key) || [];
          const photoContent = cached.map(photo => `<button type="button" data-enlarge-image="${esc(photo.url)}" data-image-alt="${esc(item.name)}"><img src="${esc(photo.url)}" alt="Fotografía de ${esc(item.name)}" loading="lazy"></button>`).join("");
          const photoControl = photos.length && !cached.length ? `<button class="infra-report-load-photos" type="button" data-infra-load-photos="${esc(key)}">Ver fotos (${photos.length})</button>` : photoContent;
          return `<tr><td><input class="infra-report-checked" type="checkbox" data-infra-select-event="${esc(key)}" ${selected.has(key) ? "checked" : ""} aria-label="Seleccionar evento ${esc(item.name)}"></td><td>${esc(dateText(visit.visit_date))}</td><td>${esc(visit.site?.name || "Sede")}</td><td><span class="infra-report-sector-code">${esc(String(visit.sector_number).padStart(2,"0"))}</span> · ${esc(visit.sector_name)}</td><td><span class="infra-report-event-name">${esc(item.name)}</span></td><td><span class="infra-report-status" data-status="${esc(item.status)}">${esc(item.status)}</span></td><td>${esc(visit.technician_name)}</td><td><span class="infra-report-detail">${esc(item.observations || "Sin observaciones")}</span></td><td><div class="infra-report-photos">${photoControl || (photos.length ? "" : "—")}</div></td></tr>`;
        }).join("");
      }).join("");
      $('[data-infra-empty]').hidden = eventCount > 0;
      $('[data-infra-table-wrap]').hidden = eventCount === 0;
      $('[data-infra-pagination]').hidden = filtered.length <= pageSizeValue;
      $('[data-infra-page-label]').textContent = `Página ${page} de ${pageCount}`;
      $('[data-infra-prev]').disabled = page <= 1; $('[data-infra-next]').disabled = page >= pageCount;
      host.querySelectorAll('[data-infra-export]').forEach(button => { button.disabled = selected.size === 0; });
    }

    function openPdfPopup() {
      const popup = global.open("", "_blank");
      if (!popup) throw new Error("Permite las ventanas emergentes para generar el PDF.");
      popup.document.write("<!doctype html><title>Preparando informe</title><p style='font:16px Arial;padding:24px'>Preparando informe de infraestructura…</p>");
      popup.document.close();
      return popup;
    }

    async function exportPdf(kind) {
      const rows = selectedRows(); if (!rows.length) return;
      const popup = openPdfPopup();
      try {
        const paths = kind === "full" ? rows.flatMap(row => (row.photos || []).map(photo => photo.path).filter(Boolean)) : [];
        const urls = paths.length ? await global.SmartFitSupabaseData.getInfrastructurePhotoUrls(paths) : {};
        const created = new Intl.DateTimeFormat("es-CL", { dateStyle:"medium", timeStyle:"short" }).format(new Date());
        const body = rows.map((row, index) => {
          const visit = row.visit, photos = kind === "full" ? (row.photos || []).map(photo => urls[photo.path]).filter(Boolean) : [];
          return `<tr><td>${index + 1}</td><td>${esc(dateText(visit.visit_date))}</td><td>${esc(visit.site?.name || "Sede")}</td><td>${esc(String(visit.sector_number).padStart(2,"0"))} · ${esc(visit.sector_name)}</td><td>${esc(visit.technician_name)}</td><td><strong>${esc(row.name)}</strong><br>${esc(row.observations || "Sin observaciones")}</td><td>${esc(row.status)}</td><td>${photos.map(src => `<img src="${esc(src)}" alt="Fotografía del evento">`).join("") || "—"}</td></tr>`;
        }).join("");
        popup.document.open();
        popup.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Informe de infraestructura ${kind === "lite" ? "Lite" : "Full"}</title><style>@page{size:letter landscape;margin:12mm}*{box-sizing:border-box}body{font:9pt Arial,sans-serif;color:#171923}.head{border-bottom:3px solid #ffb51b;padding-bottom:10px;margin-bottom:14px}.head h1{margin:0 0 4px;font-size:18pt}.head p{margin:0;color:#555}table{width:100%;border-collapse:collapse;table-layout:fixed}th,td{padding:6px;border:1px solid #d8dae0;text-align:left;vertical-align:top;overflow-wrap:anywhere}th{background:#f0f1f4}td img{width:56px;height:56px;object-fit:cover;margin:2px;border-radius:4px}footer{margin-top:12px;border-top:1px solid #ddd;padding-top:6px;text-align:center;color:#666;font-size:8pt}</style></head><body><header class="head"><h1>INFORME DE INFRAESTRUCTURA · ${kind === "lite" ? "LITE" : "FULL"}</h1><p>${rows.length} eventos · ${esc(created)}</p></header><table><thead><tr><th>N.º</th><th>Fecha</th><th>Sede</th><th>Código / sector</th><th>Técnico</th><th>Evento / detalle</th><th>Asignación</th><th>Fotografías</th></tr></thead><tbody>${body}</tbody></table><footer>${kind === "lite" ? "PDF Lite: fotografías omitidas para reducir el peso." : "PDF Full: incluye las fotografías adjuntas."}</footer><script>window.addEventListener('load',()=>{const imgs=[...document.images];Promise.all(imgs.map(img=>img.decode?.().catch(()=>{})||Promise.resolve())).then(()=>window.print())});<\/script></body></html>`);
        popup.document.close();
      } catch (error) { popup.close(); global.alert(error.message || "No se pudo generar el informe."); }
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
      const visitToggle = event.target.closest("[data-infra-select-visit]");
      if (visitToggle) {
        const visit = visits.find(row => String(row.id) === visitToggle.dataset.infraSelectVisit);
        (visit?.events || []).forEach((_, index) => visitToggle.checked ? selected.add(`${visit.id}:${index}`) : selected.delete(`${visit.id}:${index}`));
        render(); return;
      }
      const eventToggle = event.target.closest("[data-infra-select-event]");
      if (eventToggle) { eventToggle.checked ? selected.add(eventToggle.dataset.infraSelectEvent) : selected.delete(eventToggle.dataset.infraSelectEvent); render(); return; }
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
        host.querySelectorAll("[data-infra-from],[data-infra-to],[data-infra-search]").forEach(input => { input.value = ""; });
        [month, year, technician, site, status].forEach(select => { select.value = "*"; });
        page = 1; render(); return;
      }
      if (event.target.closest("[data-infra-prev]")) { page = Math.max(1, page - 1); render(); return; }
      if (event.target.closest("[data-infra-next]")) { page += 1; render(); }
    });
    host.addEventListener("change", event => {
      if (event.target.matches("[data-infra-month],[data-infra-year],[data-infra-from],[data-infra-to],[data-infra-technician],[data-infra-site],[data-infra-status]")) { page = 1; render(); }
    });
    host.addEventListener("input", event => { if (event.target.matches("[data-infra-search]")) { page = 1; render(); } });

    const ready = global.SmartFitSupabaseData.listInfrastructureVisits({ siteLegacyId, technicianOnly })
      .then(rows => { visits = Array.isArray(rows) ? rows : []; render(); return visits; })
      .catch(error => { $('[data-infra-rows]').innerHTML = `<tr><td colspan="9" class="infra-report-empty">No se pudieron cargar los informes. ${esc(error.message || "")}</td></tr>`; $('[data-infra-report-count]').textContent = "Error de carga"; $('[data-infra-table-wrap]').hidden = false; return []; });
    return { ready, refresh:async () => { visits = await global.SmartFitSupabaseData.listInfrastructureVisits({ siteLegacyId, technicianOnly }); page = 1; render(); return visits; } };
  }

  global.SmartFitInfrastructureReports = { mount };
})(window);
