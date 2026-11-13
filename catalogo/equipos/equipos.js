(() => {
  "use strict";

  // Marcas de equipos del directorio de Mantención (admin-store.js).
  const brands = [
    ["matrix", "Matrix", "marcas/matrix/Matrix_Logo.jpg"],
    ["booty-builder", "Booty Builder", "marcas/booty_builder/Bb_Logo.png"],
    ["shua", "Shua", "marcas/shua/Shua_Logo.avif"],
    ["lifefitness", "Lifefitness", "marcas/life_fitness/LifeFitness_Logo_BlancoNegro.png"],
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
  ];

  const directory = document.getElementById("equipmentDirectory");
  const title = document.getElementById("equipmentTitle");
  const description = document.getElementById("equipmentDescription");
  const filter = document.getElementById("equipmentFilter");
  const search = document.getElementById("equipmentSearch");
  const searchStatus = document.getElementById("equipmentSearchStatus");
  const grid = document.getElementById("equipmentGrid");
  const parts = document.getElementById("partsView");
  const savedParts = document.getElementById("savedPartsView");
  const equipmentNav = document.getElementById("equipmentNav");
  const partsNav = document.getElementById("partsNav");
  const preview = document.getElementById("photoPreviewDialog");
  const previewImage = document.getElementById("photoPreviewImage");
  let activeBrand;

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
      const searchable = normalizeSearch(`${model.name} ${model.model}`).replace(/[^\p{L}\p{N}]/gu, "");
      return terms.every(term => searchable.includes(term));
    });
    grid.innerHTML = matches.map(model => `
      <article class="equipment-card equipment-model-card">
        <button class="equipment-thumbnail" type="button" aria-label="Ampliar imagen de ${model.name} ${model.model}">
          <img src="${model.image}" alt="${model.name} ${model.model}" width="544" height="544">
          <span>Ampliar imagen</span>
        </button>
        <div class="equipment-model-info">
          <strong>${model.name}</strong>
          <span>Modelo ${model.model}</span>
          <a class="btn primary equipment-link" href="catalogo.html${model.id === "e-es-f" ? "?equipo=e-es-f" : ""}#equipos/${brand}/${model.id}">Ver repuestos →</a>
        </div>
      </article>`).join("");
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
    const thumbnail = event.target.closest(".equipment-thumbnail");
    if (!thumbnail) return;
    const image = thumbnail.querySelector("img");
    previewImage.src = image.src;
    previewImage.alt = image.alt;
    previewImage.setAttribute("data-equipment", "");
    preview.setAttribute("aria-label", image.alt);
    preview.showModal();
  });
  preview.addEventListener("close", () => {
    previewImage.removeAttribute("data-equipment");
    preview.setAttribute("aria-label", "Fotografía ampliada");
  });

  function renderRoute(focusHeading = false) {
    const route = window.location.hash;
    const showingParts = route === `#equipos/matrix/${window.catalogModelId}` ||
      (window.catalogModelId === "t600x-sf" && route === "#repuestos/matrix/t600x-sf");
    const showingSavedParts = route === partsNav.hash;
    const brand = brands.find(([id]) => route === `#equipos/${id}`);
    directory.hidden = showingParts || showingSavedParts;
    parts.hidden = !showingParts;
    savedParts.hidden = !showingSavedParts;
    equipmentNav.classList.toggle("active", !showingSavedParts);
    partsNav.classList.toggle("active", showingSavedParts);
    equipmentNav.removeAttribute("aria-current");
    partsNav.removeAttribute("aria-current");
    (showingSavedParts ? partsNav : equipmentNav).setAttribute("aria-current", "page");

    if (showingParts) {
      if (focusHeading) parts.querySelector(".equipment-back").focus();
      return;
    }
    if (showingSavedParts) {
      if (focusHeading) document.getElementById("savedPartsTitle").focus();
      return;
    }

    filter.hidden = !brand;
    if (activeBrand !== brand?.[0]) search.value = "";
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
  renderRoute();
})();
