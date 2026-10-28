(function () {
  "use strict";

  const esc = value => String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[character]));
  const column = index => {
    let value = index + 1, label = "";
    while (value) { const remainder = (value - 1) % 26; label = String.fromCharCode(65 + remainder) + label; value = Math.floor((value - 1) / 26); }
    return label;
  };
  const groupRows = rows => {
    const brands = new Map(), models = new Map();
    rows.forEach(row => {
      const brand = row.brandName || "Sin marca", model = row.model || "Sin modelo";
      brands.set(brand, (brands.get(brand) || 0) + 1);
      const key = `${brand}|||${model}`;
      models.set(key, (models.get(key) || 0) + 1);
    });
    return {
      brands: [...brands.entries()].sort((a, b) => a[0].localeCompare(b[0], "es")),
      models: [...models.entries()].map(([key, count]) => ({ brand: key.split("|||")[0], model: key.split("|||")[1], count })).sort((a, b) => a.brand.localeCompare(b.brand, "es") || a.model.localeCompare(b.model, "es"))
    };
  };

  function exportPdf(data) {
    const rows = Array.isArray(data.rows) ? data.rows : [];
    const groups = groupRows(rows);
    const now = new Date();
    const exportedAt = new Intl.DateTimeFormat("es-CL", { dateStyle: "long", timeStyle: "short" }).format(now);
    const reportWindow = window.open("", "_blank");
    if (!reportWindow) { window.alert("El navegador bloqueó el informe. Permite las ventanas emergentes e inténtalo nuevamente."); return; }
    const logo = new URL("IMG/logo-header.png", window.location.href).href;
    const byBrand = groups.brands.map(([brand, count]) => `<tr><td>${esc(brand)}</td><td>${count}</td></tr>`).join("") || '<tr><td colspan="2">Sin equipos</td></tr>';
    const byModel = groups.models.map(item => `<tr><td>${esc(item.brand)}</td><td>${esc(item.model)}</td><td>${item.count}</td></tr>`).join("") || '<tr><td colspan="3">Sin equipos</td></tr>';
    const detail = rows.map(row => `<tr><td>${esc(row.siteName)}</td><td>${esc(row.brandName)}</td><td>${esc(row.equipmentName)}</td><td>${esc(row.model)}</td><td>${esc(row.activeFixed === "" || row.activeFixed == null ? "—" : row.activeFixed)}</td><td>${esc(row.category)}</td></tr>`).join("") || '<tr><td colspan="6" class="empty">No hay equipos que coincidan con los filtros.</td></tr>';
    reportWindow.document.open();
    reportWindow.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Inventario Smart Fit</title><style>
      @page{size:letter landscape;margin:12mm;@bottom-right{content:"Página " counter(page) " de " counter(pages);font:8pt Arial,sans-serif;color:#555}}*{box-sizing:border-box}body{margin:0;color:#171923;font:9pt Arial,sans-serif}.header{display:flex;align-items:center;gap:20px;border-bottom:3px solid #ffb51b;padding:0 0 10px}.header img{width:120px;height:auto;background:#000;padding:4px 8px;border-radius:4px}.header-copy{flex:1;text-align:right}.header h1{font-size:19pt;margin:0 0 6px}.header p{margin:3px 0;color:#555}.section{margin-top:14px}.section h2{font-size:11pt;margin:0 0 7px;padding-bottom:4px;border-bottom:1px solid #cfd1d8}.meta{display:grid;grid-template-columns:repeat(4,1fr);gap:6px 18px}.meta p{margin:0;line-height:1.4}.stats{display:flex;gap:10px;margin:10px 0}.stat{flex:1;padding:9px;border:1px solid #cfd1d8;border-radius:7px}.stat b{display:block;font-size:8pt;color:#555}.stat strong{display:block;margin-top:3px;font-size:15pt}table{width:100%;border-collapse:collapse}th,td{padding:6px 7px;border:1px solid #d8dae0;text-align:left;vertical-align:top}th{background:#f0f1f4;font-weight:700}.summary-grid{display:grid;grid-template-columns:1fr 1.6fr;gap:14px}.empty{text-align:center;color:#666}thead{display:table-header-group}tr{break-inside:avoid}footer{margin-top:14px;border-top:1px solid #d8dae0;padding-top:6px;text-align:center;color:#555;font-size:8pt}@media print{*{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
      </style></head><body><header class="header"><img src="${esc(logo)}" alt="Smart Fit"><div class="header-copy"><h1>INVENTARIO GENERAL</h1><p>Exportado por: <b>${esc(data.exportedBy || "Usuario")}</b></p><p>Fecha y hora: ${esc(exportedAt)}</p></div></header>
      <section class="section"><h2>Alcance del informe</h2><div class="meta"><p><b>Sedes:</b> ${esc(data.siteFilter || "Sedes asignadas")}</p><p><b>Marca:</b> ${esc(data.brandFilter || "Todas las marcas")}</p><p><b>Categoría:</b> ${esc(data.categoryFilter || "Todas las categorías")}</p><p><b>Búsqueda:</b> ${esc(data.search || "Sin búsqueda")}</p></div><div class="stats"><div class="stat"><b>Total global en sedes asignadas</b><strong>${Number(data.globalCount) || 0}</strong></div><div class="stat"><b>Equipos incluidos</b><strong>${rows.length}</strong></div><div class="stat"><b>Marcas incluidas</b><strong>${groups.brands.length}</strong></div><div class="stat"><b>Modelos incluidos</b><strong>${groups.models.length}</strong></div></div></section>
      <section class="section"><h2>Resumen por marca y modelo</h2><div class="summary-grid"><table><thead><tr><th>Marca</th><th>Equipos</th></tr></thead><tbody>${byBrand}</tbody></table><table><thead><tr><th>Marca</th><th>Modelo</th><th>Equipos</th></tr></thead><tbody>${byModel}</tbody></table></div></section>
      <section class="section"><h2>Detalle del inventario (${rows.length} equipos)</h2><table><thead><tr><th>Sede</th><th>Marca</th><th>Equipo</th><th>Modelo</th><th>Activo fijo</th><th>Categoría</th></tr></thead><tbody>${detail}</tbody></table></section><footer>Informe generado desde el panel de Smart Fit.</footer><script>window.addEventListener('load',()=>setTimeout(()=>window.print(),250));<\/script></body></html>`);
    reportWindow.document.close();
  }

  function sheetXml(rows, widths, filter = false, freeze = false) {
    const maxColumns = Math.max(1, ...rows.map(row => row.length));
    const cols = `<cols>${widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join("")}</cols>`;
    const sheetData = rows.map((row, r) => `<row r="${r + 1}">${row.map((cell, c) => {
      const object = cell && typeof cell === "object" && Object.hasOwn(cell, "value") ? cell : { value: cell };
      const ref = `${column(c)}${r + 1}`;
      return object.type === "number" ? `<c r="${ref}" s="${object.style || 0}"><v>${Number(object.value) || 0}</v></c>` : `<c r="${ref}" s="${object.style || 0}" t="inlineStr"><is><t xml:space="preserve">${esc(object.value)}</t></is></c>`;
    }).join("")}</row>`).join("");
    const endCell = `${column(maxColumns - 1)}${rows.length}`;
    const pane = freeze && rows.length > 1 ? '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/>' : "";
    const autoFilter = filter && rows.length > 1 ? `<autoFilter ref="A1:${column(rows[0].length - 1)}${rows.length}"/>` : "";
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${endCell}"/><sheetViews><sheetView workbookViewId="0">${pane}</sheetView></sheetViews>${cols}<sheetData>${sheetData}</sheetData>${autoFilter}</worksheet>`;
  }

  function zip(files) {
    const encoder = new TextEncoder(), table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; }
    const crc32 = bytes => { let c = 0xffffffff; for (const byte of bytes) c = table[(c ^ byte) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
    const locals = [], centrals = []; let offset = 0;
    files.forEach(file => {
      const name = encoder.encode(file.name), data = encoder.encode(file.content), crc = crc32(data);
      const local = new Uint8Array(30 + name.length + data.length), lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0x0800, true); lv.setUint32(14, crc, true); lv.setUint32(18, data.length, true); lv.setUint32(22, data.length, true); lv.setUint16(26, name.length, true); local.set(name, 30); local.set(data, 30 + name.length); locals.push(local);
      const central = new Uint8Array(46 + name.length), cv = new DataView(central.buffer);
      cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x0800, true); cv.setUint32(16, crc, true); cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true); cv.setUint16(28, name.length, true); cv.setUint32(42, offset, true); central.set(name, 46); centrals.push(central); offset += local.length;
    });
    const centralSize = centrals.reduce((sum, part) => sum + part.length, 0), end = new Uint8Array(22), ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true); ev.setUint32(12, centralSize, true); ev.setUint32(16, offset, true);
    return new Blob([...locals, ...centrals, end], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  }

  function exportExcel(data) {
    const rows = Array.isArray(data.rows) ? data.rows : [], groups = groupRows(rows);
    const issued = new Intl.DateTimeFormat("es-CL", { dateStyle: "long", timeStyle: "short" }).format(new Date());
    const summary = [
      [{ value: "INFORME DE INVENTARIO", style: 1 }], ["Exportado por", data.exportedBy || "Usuario"], ["Fecha y hora", issued],
      ["Sedes", data.siteFilter || "Sedes asignadas"], ["Marca", data.brandFilter || "Todas las marcas"], ["Categoría", data.categoryFilter || "Todas las categorías"], ["Búsqueda", data.search || "Sin búsqueda"], [],
      [{ value: "INDICADORES", style: 1 }], ["Total global en sedes asignadas", { value: Number(data.globalCount) || 0, type: "number" }], ["Equipos incluidos", { value: rows.length, type: "number" }], ["Marcas incluidas", { value: groups.brands.length, type: "number" }], ["Modelos incluidos", { value: groups.models.length, type: "number" }], [],
      [{ value: "CANTIDAD POR MARCA", style: 1 }], [{ value: "Marca", style: 2 }, { value: "Equipos", style: 2 }],
      ...groups.brands.map(([name, count]) => [name, { value: count, type: "number" }]), [],
      [{ value: "CANTIDAD POR MARCA Y MODELO", style: 1 }], [{ value: "Marca", style: 2 }, { value: "Modelo", style: 2 }, { value: "Equipos", style: 2 }],
      ...groups.models.map(item => [item.brand, item.model, { value: item.count, type: "number" }])
    ];
    const detail = [["Sede", "Marca", "Equipo", "Modelo", "Activo fijo", "Categoría"].map(value => ({ value, style: 2 })), ...rows.map(row => [row.siteName, row.brandName, row.equipmentName, row.model, row.activeFixed === "" || row.activeFixed == null ? "—" : String(row.activeFixed), row.category])];
    const files = [
      { name: "[Content_Types].xml", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>` },
      { name: "_rels/.rels", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
      { name: "xl/workbook.xml", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Resumen" sheetId="1" r:id="rId1"/><sheet name="Inventario" sheetId="2" r:id="rId2"/></sheets></workbook>` },
      { name: "xl/_rels/workbook.xml.rels", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
      { name: "xl/styles.xml", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Arial"/></font><font><b/><sz val="12"/><color rgb="FFFFB51B"/><name val="Arial"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF22252E"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="1" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="1" borderId="0" xfId="0"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>` },
      { name: "xl/worksheets/sheet1.xml", content: sheetXml(summary, [36, 28, 20], false, false) },
      { name: "xl/worksheets/sheet2.xml", content: sheetXml(detail, [30, 24, 34, 18, 18, 24], true, true) }
    ];
    const blob = zip(files), stamp = nowStamp();
    const url = URL.createObjectURL(blob), link = document.createElement("a");
    link.href = url; link.download = `inventario-smartfit-${stamp}.xlsx`; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function nowStamp() { return new Date().toISOString().slice(0, 16).replace(/[-T:]/g, ""); }
  window.SmartFitInventoryExport = { exportPdf, exportExcel };
})();
