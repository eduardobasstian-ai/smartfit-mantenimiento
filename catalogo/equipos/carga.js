(() => {
  const measurements = [];
  let reporting;
  function report() {
    reporting = null;
    if (!window.Sentry?.getClient?.()) return;
    for (const { name, start, end } of measurements.splice(0)) {
      const span = window.Sentry.startInactiveSpan({ name, op: 'ui.catalogo', forceTransaction: true,
        startTime: (performance.timeOrigin + start) / 1000 });
      span.end((performance.timeOrigin + end) / 1000);
    }
  }
  window.catalogMeasure = (name, start) => {
    if (!Number.isFinite(start)) return;
    const end = performance.now();
    performance.measure(name, { start, end });
    if (performance.getEntriesByName(name).length > 100) performance.clearMeasures(name);
    if (measurements.length < 20) measurements.push({ name, start, end });
    if (!reporting) reporting = setTimeout(report, 3000);
  };
  const pending = new Map();
  window.catalogLoadScript = name => {
    if (pending.has(name)) return pending.get(name);
    const promise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'equipos/' + name + '?v=' + (name === 'plano.js' ? '20261126-copiar-sap-1' : '20261125-perf1');
      script.onload = () => { script.remove(); resolve(); };
      script.onerror = () => { script.remove(); reject(new Error('No se pudo cargar la vista. Vuelve a intentarlo.')); };
      document.head.append(script);
    }).catch(error => { pending.delete(name); throw error; });
    pending.set(name, promise);
    return promise;
  };
  window.openCatalogPlan = async () => {
    const started = performance.now();
    await Promise.all(['fotos.js', 'catalogo-cambios.js', 'catalogo-edicion.js'].map(window.catalogLoadScript));
    await window.catalogLoadScript('plano.js');
    const refresh = await window.openCatalogPlan();
    window.catalogMeasure('Catálogo · abrir plano', started);
    return refresh;
  };
})();
