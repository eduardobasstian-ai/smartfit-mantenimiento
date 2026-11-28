window.createCatalogOrders = () => {
  const $ = id => document.getElementById(id);
  const site = $('ordersSite'), technician = $('ordersTechnician');
  const controls = [...$('ordersFilters').querySelectorAll('input,select,button')];
  const exports = [...document.querySelectorAll('.orders-export button')];
  let context, loading, loadedAt = 0, revision = 0;
  function options(select, label, rows) {
    select.replaceChildren(new Option(label, ''), ...rows.map(row => new Option(row.name, row.id)));
  }
  function technicians() {
    const selected = technician.value;
    options(technician, 'Todos los técnicos', context.technicians.filter(row => !site.value || row.siteIds.includes(site.value)));
    if ([...technician.options].some(option => option.value === selected)) technician.value = selected;
  }
  function clear() {
    revision++; loading = null; context = null;
    $('ordersFilters').reset();
    options(site, 'Sedes autorizadas', []); options(technician, 'Técnicos autorizados', []);
    controls.forEach(control => { control.disabled = true; });
    exports.forEach(button => { button.disabled = true; });
    $('ordersScope').textContent = 'Verificando acceso a Pedidos…';
  }
  async function refresh() {
    if ((context && Date.now()-loadedAt < 60000) || loading) return loading;
    if (context) clear();
    const current = revision;
    loading = (async () => {
      try {
        const result = await window.CatalogSync.readOrdersContext();
        if (current !== revision) return;
        context = result;
        loadedAt = Date.now();
        options(site, result.allSites ? 'Todas las sedes' : 'Todas mis sedes', result.sites);
        technicians();
        controls.forEach(control => { control.disabled = false; });
        $('ordersScope').textContent = result.role === 'supervisor'
          ? 'Solo pedidos de tus sedes y técnicos asignados.'
          : result.role === 'bodega' ? 'Bodega · Consulta de pedidos de todas las sedes y técnicos.'
          : 'Administrador · Pedidos de todas las sedes y técnicos.';
      } catch (_) {
        if (current === revision) $('ordersScope').textContent = 'No se pudo verificar el acceso a Pedidos. Vuelve a entrar a esta sección para reintentar.';
      } finally { if (current === revision) loading = null; }
    })();
    return loading;
  }
  site.addEventListener('change', () => { if (context) technicians(); });
  $('ordersFilters').addEventListener('reset', () => { if (context) queueMicrotask(technicians); });
  for (const event of ['catalog-session-ready','catalog-session-ended']) window.addEventListener(event, () => {
    clear(); if (event === 'catalog-session-ready' && !$('savedPartsView').hidden) refresh();
  });
  clear();
  return refresh;
};
