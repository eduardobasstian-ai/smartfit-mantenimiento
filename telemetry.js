(() => {
  "use strict";
  const base = new URL(".", document.currentScript.src);
  const page = location.pathname.includes("/catalogo/") ? "catalogo" :
    (location.pathname.split("/").pop() || "index.html").replace(/\.html$/, "");
  const surface = /Android.*; wv\)/.test(navigator.userAgent) || window.SmartFitApp ? "android-webview" : "navegador";
  const queue = [];
  let sdk;
  function whenReady(action) {
    if (sdk) action(sdk);
    else if (queue.length < 15) queue.push(action);
  }
  function report(error) {
    whenReady(client => client.captureException(error instanceof Error ? error : new Error("Unhandled rejection")));
  }
  window.addEventListener("error", event => { if (event.error) report(event.error); });
  window.addEventListener("unhandledrejection", event => report(event.reason));
  function measure(name, start, end) {
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return;
    whenReady(client => {
      const span = client.startInactiveSpan({name, op: "ui.load", forceTransaction: true,
        startTime: (performance.timeOrigin + start) / 1000});
      span.end((performance.timeOrigin + end) / 1000);
    });
  }
  window.addEventListener("smartfit:first-maintenance-thumbnail", e => {
    measure("Mantención · primera miniatura", e.detail, performance.now());
  });
  function initialize() {
    const script = document.createElement("script");
    script.src = new URL("vendor/sentry-browser-tracing-11.16.0.min.js", base).href;
    script.onload = () => {
      const client = window.Sentry;
      client.init({
        dsn: "https://bbd9c78199f3411a1c23bf6ba3505fb3@o4512467577995264.ingest.us.sentry.io/4512467616137216",
        environment: "production", defaultIntegrations: false, integrations: [],
        sendDefaultPii: false, maxBreadcrumbs: 0, tracesSampleRate: 0.1,
        tracePropagationTargets: [],
        initialScope: {tags: {pantalla: page, superficie: surface}},
        beforeSend(event) {
          delete event.request;
          delete event.user;
          delete event.extra;
          delete event.message;
          for (const ex of event.exception?.values || []) {
            ex.value = "Error de aplicación";
            if (!/^[a-zA-Z]{1,48}Error$|^Error$/.test(ex.type)) ex.type = "Error";
            for (const frame of ex.stacktrace?.frames || []) {
              try {
                const url = new URL(frame.filename, location.href);
                frame.filename = url.origin === location.origin ? url.pathname : "externo";
              } catch { frame.filename = "desconocido"; }
              delete frame.vars;
            }
          }
          return event;
        },
      });
      sdk = client;
      queue.splice(0).forEach(action => action(client));
      const nav = performance.getEntriesByType("navigation")[0];
      if (nav?.loadEventEnd) measure("Carga · " + page, 0, nav.loadEventEnd);
    };
    document.head.append(script);
  }
  const schedule = () => {
    if (window.requestIdleCallback) window.requestIdleCallback(initialize, {timeout: 2000});
    else setTimeout(initialize, 0);
  };
  if (document.readyState === "complete") schedule();
  else window.addEventListener("load", schedule, {once: true});
})();
