(() => {
  "use strict";

  // Marcas de equipos del directorio de Mantención (admin-store.js).
  const brands = [
    ["matrix", "Matrix", "marcas/matrix/Matrix_Logo.jpg"],
    ["booty-builder", "Booty Builder", "marcas/booty_builder/Bb_Logo.png"],
    ["shua", "Shua", "marcas/shua/Shua_Logo.avif"],
    ["lifefitness", "Life Fitness", "marcas/life_fitness/LifeFitness_Logo_BlancoNegro.png"],
    ["hammer-strength", "Hammer Strength", "marcas/hammer_strength/HS_Logo.jpg"],
    ["relan", "Relan", "marcas/relan/Relan_Logo_BlancoNegro.png"],
    ["ubian", "Ubian", "marcas/ubian/Ubian_Logo.jpg"],
    ["technogym", "Technogym", "marcas/techno_gym/Technogym_Logo.jpg"],
    ["water-rower", "Water Rower", "marcas/Waterrower_Logo.png"],
    ["movement", "Movement", "marcas/movement/Movement_Logo.png"],
    ["octane", "Octane", "marcas/octane/Octane_Logo.jpg"],
    ["illus", "Illus", "marcas/illus/Ilus_Logo.png"],
  ];
  const models = [
    {
      brand: "movement",
      id: "rt-g2",
      name: "Trotadora",
      model: "RT G2",
      image: "catalogo-assets/movement-rt-g2/rt250.jpg",
    },
    {
      brand: "matrix",
      id: "t600x-sf",
      name: "Trotadora",
      model: "T600X SF",
      // Misma foto de la T600X que usa Mantención en EQU/matrix-catalog.js.
      image: "https://assets.jhtbrand.co/files/product/bbc3ced95b806ab71099b268ac8fc8b3130b91fb/",
    },
    {
      brand: "matrix",
      id: "e-es-f",
      name: "Elíptica",
      model: "E-ES-F",
      image: "https://assets.jhtbrand.co/files/product/b6b93e1cb54a3628d2ae436e300f54ccff618613/",
    },
    {
      brand: "hammer-strength",
      id: "hs-abc",
      name: "Abdominal Crunch",
      model: "HS-ABC",
      image: "https://www.lifefitness.cl/cdn/shop/products/hammer-strength-abdominal-crunch.jpg?v=1706553479&width=1200",
    },
    ...window.catalogManuals.map(({ id, brand, name, model }) => ({
      id, brand, name, model, image: window.catalogMaintenancePhotos[id],
    })),
  ];
  const modelsById = new Map(models.map(model => [model.id, model]));
  const localThumbnails = new Set([
    "rt-g2", "t600x-sf", "e-es-f", "hammer-strength-ssm", "lifefitness-cmdap", "lifefitness-ssm", "mj4",
  ]);
  const thumbnailHosts = new Set(["www.lifefitness.cl", "shop.lifefitness.com"]);

  function photoSources(model) {
    const widths = [240, 384];
    const thumbnailName = model.model === "MJ4" ? "mj4" : model.id;
    const url = new URL(model.image, window.location.href);
    let images;
    if (localThumbnails.has(thumbnailName)) {
      images = widths.map(width => `catalogo-assets/miniaturas/${thumbnailName}-${width}.jpg`);
    } else if (thumbnailHosts.has(url.hostname) && url.pathname.startsWith("/cdn/shop/")) {
      images = widths.map(width => {
        url.searchParams.set("width", width);
        return url.href.replaceAll("&", "&amp;");
      });
    } else {
      return `src="${model.image.replaceAll("&", "&amp;")}"`;
    }
    return `src="${images[0]}" srcset="${images[0]} 240w, ${images[1]} 384w" sizes="auto, 126px"`;
  }

  const directory = document.getElementById("equipmentDirectory");
  const title = document.getElementById("equipmentTitle");
  const description = document.getElementById("equipmentDescription");
  const filter = document.getElementById("equipmentFilter");
  const search = document.getElementById("equipmentSearch");
  const searchStatus = document.getElementById("equipmentSearchStatus");
  const grid = document.getElementById("equipmentGrid");
  const parts = document.getElementById("partsView");
  const app = document.getElementById("catalogApp");
  const planLoad = document.getElementById("planLoad");
  const planLoadMessage = document.getElementById("planLoadMessage");
  const retryPlanLoad = document.getElementById("retryPlanLoad");
  const planWorkspace = document.getElementById("planWorkspace");
  const planBack = document.getElementById("planBack");
  const planModel = document.getElementById("planModel");
  const listQuery = new URLSearchParams(window.location.search).get("buscar") || "";
  const savedParts = document.getElementById("savedPartsView");
  const equipmentNav = document.getElementById("equipmentNav");
  const partsNav = document.getElementById("partsNav");
  const inventoryNav = document.getElementById("inventoryNav");
  const inventory = document.getElementById("inventoryView");
  const preview = document.getElementById("photoPreviewDialog");
  const previewImage = document.getElementById("photoPreviewImage");
  let activeBrand;
  let planLoading;
  let refreshPlan;
  const inventoryPage = window.createCatalogInventory(brands, models);

  function renderBrands() {
    grid.innerHTML = brands.map(([id, name, logo]) => {
      const count = models.filter(model => model.brand === id).length;
      const countLabel = count === 1 ? "1 modelo" : `${count} modelos`;
      return `<a class="equipment-card equipment-brand-card" href="#equipos/${id}">
        <div class="equipment-brand-info">
          <strong>${name}</strong><span>${countLabel} · Ver equipos →</span>
        </div>
        ${logo ? `<span class="equipment-brand-logo"><img src="${logo}" alt="" width="72" height="72"></span>` : ""}
      </a>`;
    }).join("");
  }

  function normalizeSearch(value) {
    return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  }

  function renderModels(brand) {
    const terms = normalizeSearch(search.value).match(/[\p{L}\p{N}]+/gu) || [];
    const matches = models.filter(model => {
      if (model.brand !== brand) return false;
      const label = window.catalogEquipmentName(model);
      const searchable = normalizeSearch(`${label.es} ${label.en} ${model.model}`).replace(/[^\p{L}\p{N}]/gu, "");
      return terms.every(term => searchable.includes(term));
    });
    grid.innerHTML = matches.map(model => {
      const label = window.catalogEquipmentName(model);
      const params = new URLSearchParams();
      if (model.id !== "t600x-sf") params.set("equipo", model.id);
      if (search.value.trim()) params.set("buscar", search.value.trim());
      const query = params.toString();
      return `
      <article class="equipment-card equipment-model-card">
        <button class="equipment-thumbnail" data-equipment-photo="${model.id}" type="button" aria-label="Ampliar imagen de ${label.es} ${model.model}">
          <img ${photoSources(model)} alt="${label.es} ${model.model}" width="240" height="240" loading="lazy" decoding="async">
          <span>Ampliar imagen</span>
        </button>
        <div class="equipment-model-info">
          <strong>${label.es}</strong>
          <small class="equipment-original-name" lang="en">${label.en}</small>
          <span>Modelo ${model.model}</span>
          <a class="btn primary equipment-link" href="catalogo.html${query ? "?" + query : ""}#equipos/${brand}/${model.id}">Ver repuestos →</a>
        </div>
      </article>`;
    }).join("");
    if (!matches.length) {
      const message = terms.length
        ? "No se encontraron equipos que coincidan con la búsqueda."
        : "Todavía no hay modelos con catálogo de repuestos para esta marca.";
      grid.innerHTML = `<p class="equipment-empty">${message}</p>`;
    }
    searchStatus.textContent = terms.length
      ? (matches.length === 1 ? "1 equipo encontrado." : `${matches.length} equipos encontrados.`)
      : "";
  }

  search.addEventListener("input", () => renderModels(activeBrand));

  grid.addEventListener("click", event => {
    const thumbnail = event.target.closest("[data-equipment-photo]");
    const model = modelsById.get(thumbnail?.dataset.equipmentPhoto);
    if (!model) return;
    const image = thumbnail.querySelector("img");
    previewImage.src = model.image;
    previewImage.alt = image.alt;
    previewImage.setAttribute("data-equipment", "");
    preview.setAttribute("aria-label", image.alt);
    preview.showModal();
  });
  preview.addEventListener("close", () => {
    if (previewImage.hasAttribute("data-equipment")) previewImage.removeAttribute("src");
    previewImage.removeAttribute("data-equipment");
    preview.setAttribute("aria-label", "Fotografía ampliada");
  });
  document.getElementById("closePhotoPreview").onclick = () => preview.close();
  preview.addEventListener("click", event => {
    if (event.target === preview) preview.close();
  });

  function loadPlan() {
    if (refreshPlan) {
      refreshPlan();
      return;
    }
    if (app.hidden || planLoading) return;
    planLoad.hidden = false;
    retryPlanLoad.hidden = true;
    planLoadMessage.textContent = "Cargando plano…";
    planLoading = window.openCatalogPlan().then(refresh => {
      refreshPlan = refresh;
      planWorkspace.hidden = false;
      planLoad.hidden = true;
    }).catch(error => {
      planLoadMessage.textContent = error.message || "No se pudo cargar el plano.";
      retryPlanLoad.hidden = false;
    }).finally(() => { planLoading = null; });
  }
  retryPlanLoad.onclick = loadPlan;

  function renderRoute(focusHeading = false) {
    const route = window.location.hash;
    const activeModel = modelsById.get(window.catalogModelId);
    const showingParts = route === `#equipos/${activeModel?.brand}/${activeModel?.id}` ||
      (window.catalogModelId === "t600x-sf" && route === "#repuestos/matrix/t600x-sf");
    const showingSavedParts = route === partsNav.hash;
    const showingInventory = route === inventoryNav.hash;
    const brand = brands.find(([id]) => route === `#equipos/${id}`);
    directory.hidden = showingParts || showingSavedParts || showingInventory;
    parts.hidden = !showingParts;
    savedParts.hidden = !showingSavedParts;
    inventory.hidden = !showingInventory;
    const currentNav = showingInventory ? inventoryNav : showingSavedParts ? partsNav : equipmentNav;
    for (const link of [equipmentNav, inventoryNav, partsNav]) {
      link.classList.toggle("active", link === currentNav);
      if (link === currentNav) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    }

    if (showingInventory) {
      inventoryPage();
      if (focusHeading) document.getElementById("inventoryTitle").focus();
      return;
    }

    if (showingParts) {
      const brandName = brands.find(([id]) => id === activeModel.brand)[1];
      planModel.textContent = `${brandName} · ${activeModel.model}`;
      planBack.href = `catalogo.html${listQuery ? "?" + new URLSearchParams({ buscar: listQuery }) : ""}#equipos/${activeModel.brand}`;
      planBack.textContent = `← Volver a equipos ${brandName}`;
      loadPlan();
      if (focusHeading) planBack.focus();
      return;
    }
    if (showingSavedParts) {
      if (focusHeading) document.getElementById("savedPartsTitle").focus();
      return;
    }

    filter.hidden = !brand;
    if (activeBrand !== brand?.[0]) search.value = activeBrand === undefined && brand ? listQuery : "";
    activeBrand = brand?.[0];
    title.textContent = brand ? `Equipos ${brand[1]}` : "Marcas de equipos";
    description.textContent = brand
      ? "Selecciona un modelo para consultar sus repuestos."
      : "Consulta los modelos con catálogo de repuestos por marca.";
    if (activeBrand) renderModels(activeBrand);
    else {
      searchStatus.textContent = "";
      renderBrands();
    }
    if (focusHeading) title.focus();
  }

  window.addEventListener("hashchange", () => renderRoute(true));
  window.addEventListener("catalog-session-ready", () => {
    if (!parts.hidden && !refreshPlan) loadPlan();
  });
  renderRoute();
})();
