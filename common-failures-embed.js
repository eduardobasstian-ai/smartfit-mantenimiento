(() => {
  "use strict";

  const mounted = new WeakSet();

  function findById(root, id) {
    return [...root.querySelectorAll("[id]")].find(element => element.id === id) || null;
  }

  function scopedDocument(root, host) {
    return {
      getElementById: id => findById(root, id),
      querySelector: selector => root.querySelector(selector),
      querySelectorAll: selector => root.querySelectorAll(selector),
      createElement: tagName => host.ownerDocument.createElement(tagName),
      addEventListener: (type, listener, options) => {
        if (type === "storage" || type === "smartfit:common-failures-preview-updated") {
          window.addEventListener(type, listener, options);
          return;
        }
        root.addEventListener(type, listener, options);
      },
      body: { classList: host.classList },
      readyState: "complete"
    };
  }

  function scopedWindow() {
    return new Proxy(window, {
      get(target, property) {
        if (property === "addEventListener") {
          return (type, listener, options) => {
            if (type === "load") {
              listener(new Event("load"));
              return;
            }
            target.addEventListener(type, listener, options);
          };
        }
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      }
    });
  }

  function embeddedStyles(parsed) {
    const source = [...parsed.querySelectorAll("head style")].map(style => style.textContent).join("\n");
    return source
      .replace(/:root\s*\{/g, ":host {")
      .replace(/body\.embedded/g, ":host(.embedded)")
      .replace(/body\s*\{/g, ":host {") + "\n.cf-embed-error{padding:18px;border:1px solid #743b45;border-radius:11px;background:#3b2028;color:#ffc0c6;font:14px/1.5 system-ui,sans-serif}";
  }

  async function mount(host) {
    if (mounted.has(host)) return;
    mounted.add(host);
    const sourceUrl = host.dataset.commonFailuresSrc;
    const root = host.shadowRoot || host.attachShadow({ mode: "open" });
    host.classList.add("embedded");
    host.setAttribute("aria-busy", "true");
    try {
      const response = await fetch(sourceUrl, { credentials: "same-origin", cache: "no-cache" });
      if (!response.ok) throw new Error(`No se pudo abrir el módulo (${response.status}).`);
      const parsed = new DOMParser().parseFromString(await response.text(), "text/html");
      const style = host.ownerDocument.createElement("style");
      style.textContent = embeddedStyles(parsed);
      root.replaceChildren(style, ...[...parsed.body.childNodes]
        .filter(node => !(node.nodeType === 1 && node.tagName === "SCRIPT"))
        .map(node => host.ownerDocument.importNode(node, true)));
      const appScript = [...parsed.body.querySelectorAll("script")].find(script => script.textContent.includes("loadRemoteKnowledge"));
      if (!appScript) throw new Error("No se encontró el inicializador de Gestión de contenido.");
      const localDocument = scopedDocument(root, host);
      const localLocation = new URL(sourceUrl, window.location.href);
      Function("document", "location", "window", appScript.textContent).call(window, localDocument, localLocation, scopedWindow());
      host.removeAttribute("aria-busy");
    } catch (error) {
      root.replaceChildren();
      const message = host.ownerDocument.createElement("div");
      message.className = "cf-embed-error";
      message.textContent = `No se pudo mostrar Gestión de contenido: ${error.message}`;
      root.append(message);
      host.removeAttribute("aria-busy");
      console.error("Error al montar Gestión de contenido.", error);
    }
  }

  function scan(node = document) {
    if (node.matches?.("[data-common-failures-src]")) mount(node);
    node.querySelectorAll?.("[data-common-failures-src]").forEach(mount);
  }

  window.SmartFitCommonFailuresEmbed = { mount };
  scan();
  new MutationObserver(records => records.forEach(record => record.addedNodes.forEach(node => {
    if (node.nodeType === 1) scan(node);
  }))).observe(document.documentElement, { childList: true, subtree: true });
})();
