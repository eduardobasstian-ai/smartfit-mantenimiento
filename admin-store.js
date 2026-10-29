/* Caché local de presentación; la fuente de datos es Supabase. */
(function (global) {
  "use strict";

  const STORAGE_KEY = "smartfit.admin.users.v1";
  const SITE_STORAGE_KEY = "smartfit.admin.sites.v1";
  const ACCESS_HISTORY_KEY = "smartfit.admin.access-history.v1";
  const BRAND_STORAGE_KEY = "smartfit.admin.brands.v1";
  const TICKETS_STORAGE_KEY = "smartfit.leader-tickets.v1";
  const MACHINE_RECORDS_KEY = "smartfit.machine-records.v1";
  const CATALOG_BRAND_IDS = ["brand-matrix", "brand-booty-builder"];
  const PROTECTED_ADMIN_ID = "admin-edu";
  const CHILE_REGIONS = [
    "Arica y Parinacota", "Tarapaca", "Antofagasta", "Atacama", "Coquimbo", "Valparaiso",
    "Metropolitana de Santiago", "O'Higgins", "Maule", "Nuble", "Biobio", "La Araucania",
    "Los Rios", "Los Lagos", "Aysen", "Magallanes y la Antartica Chilena"
  ];
  const DEFAULT_BRANDS = [
    { id: "brand-matrix", name: "Matrix", equipmentCount: 71 },
    { id: "brand-booty-builder", name: "Booty Builder", equipmentCount: 8 },
    { id: "brand-shua", name: "Shua", equipmentCount: 29 },
    { id: "brand-ubian", name: "Ubian", equipmentCount: 1 },
    { id: "brand-lifefitness", name: "Lifefitness", equipmentCount: 43 },
    { id: "brand-hammer-strength", name: "Hammer Strength", equipmentCount: 23 },
    { id: "brand-technogym", name: "Technogym", equipmentCount: 46 },
    { id: "brand-water-rower", name: "Water Rower", equipmentCount: 1 },
    { id: "brand-movement", name: "Movement", equipmentCount: 1 },
    { id: "brand-octane", name: "Octane", equipmentCount: 1 },
    { id: "brand-relan", name: "Relan", equipmentCount: 1 },
    { id: "brand-illus", name: "Illus", equipmentCount: 3 },
    { id: "brand-insumos", name: "Insumos", equipmentCount: 1 }
  ];
  function readUsers() {
    try {
      const raw = global.localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const users = JSON.parse(raw);
      return Array.isArray(users) ? users : [];
    } catch (error) {
      return [];
    }
  }

  function writeUsers(users) {
    const safeUsers = (Array.isArray(users) ? users : []).map(user => {
      const safe = Object.assign({}, user);
      delete safe.password;
      return safe;
    });
    global.localStorage.setItem(STORAGE_KEY, JSON.stringify(safeUsers));
    return safeUsers;
  }

  function readSites() {
    try {
      const raw = global.localStorage.getItem(SITE_STORAGE_KEY);
      if (!raw) return [];
      const sites = JSON.parse(raw);
      return Array.isArray(sites) ? sites : [];
    } catch (error) {
      return [];
    }
  }

  function writeSites(sites) {
    global.localStorage.setItem(SITE_STORAGE_KEY, JSON.stringify(sites));
    return sites;
  }

  function readBrands() {
    try {
      const raw = global.localStorage.getItem(BRAND_STORAGE_KEY);
      if (!raw) return DEFAULT_BRANDS.map(brand => Object.assign({}, brand));
      const brands = JSON.parse(raw);
      return Array.isArray(brands) ? brands : DEFAULT_BRANDS.map(brand => Object.assign({}, brand));
    } catch (error) {
      return DEFAULT_BRANDS.map(brand => Object.assign({}, brand));
    }
  }

  function writeBrands(brands) {
    global.localStorage.setItem(BRAND_STORAGE_KEY, JSON.stringify(brands));
    return brands;
  }

  function readStoredArray(key) {
    try {
      const value = JSON.parse(global.localStorage.getItem(key) || "[]");
      return Array.isArray(value) ? value : [];
    } catch (error) {
      return [];
    }
  }

  function readStoredObject(key) {
    try {
      const value = JSON.parse(global.localStorage.getItem(key) || "{}");
      return value && typeof value === "object" && !Array.isArray(value) ? value : {};
    } catch (error) {
      return {};
    }
  }

  function getUserSiteReferences(user, sites) {
    const existingSiteIds = new Set(sites.map(site => site.id));
    const assigned = new Set((Array.isArray(user.siteIds) ? user.siteIds : []).filter(id => existingSiteIds.has(id)));
    sites.forEach(site => {
      if (site.technicianUserId === user.id || site.supervisorUserId === user.id) assigned.add(site.id);
    });
    return Array.from(assigned);
  }

  function getSiteDeletionBlock(id, sites, users) {
    const site = sites.find(entry => entry.id === id);
    if (!site) return "No se encontró la sede.";
    if (users.some(user => getUserSiteReferences(user, sites).includes(id))) {
      return "Quita o reasigna primero los usuarios vinculados a esta sede.";
    }
    if ((Array.isArray(site.equipment) && site.equipment.length) || Number(site.machineCount) > 0) {
      return "No se puede eliminar: la sede tiene equipos registrados. Retira o reasigna el inventario primero.";
    }
    const tickets = readStoredArray(TICKETS_STORAGE_KEY);
    if (tickets.some(ticket => ticket && (ticket.siteId === id || String(ticket.machineRecordKey || "").startsWith(`${id}::`)))) {
      return "No se puede eliminar: la sede tiene tickets asociados.";
    }
    const records = readStoredObject(MACHINE_RECORDS_KEY);
    if (Object.keys(records).some(key => key.startsWith(`${id}::`))) {
      return "No se puede eliminar: la sede tiene eventos o registros de kilometraje asociados.";
    }
    return "";
  }

  function getBrandDeletionBlock(id, brands, sites) {
    const brand = brands.find(entry => entry.id === id);
    if (!brand) return "No se encontró la marca.";
    const externalCatalogIds = Object.keys(global.BRAND_EQUIPMENT_CATALOGS || {});
    if (CATALOG_BRAND_IDS.includes(id) || externalCatalogIds.includes(id)) {
      return "No se puede eliminar: esta marca tiene un catálogo de equipos integrado.";
    }
    if (sites.some(site => (Array.isArray(site.equipment) ? site.equipment : []).some(item =>
      item && (item.brandId === id || item.catalogId === id || String(item.catalogId || "").startsWith(`${id}:`) ||
        String(item.brandName || "").trim().toLocaleLowerCase("es") === String(brand.name || "").trim().toLocaleLowerCase("es"))
    ))) {
      return "No se puede eliminar: hay equipos de esta marca registrados en una o más sedes.";
    }
    if (Number(brand.equipmentCount) > 0) {
      return "No se puede eliminar: la marca todavía tiene equipos registrados.";
    }
    return "";
  }

  function getUserDeletionBlock(id, users, sites) {
    if (id === PROTECTED_ADMIN_ID) return "Cuenta inicial protegida";
    const user = users.find(entry => entry.id === id);
    if (!user) return "No se encontró el usuario.";
    if (user.role === "Administrador" && user.active &&
        users.filter(entry => entry.role === "Administrador" && entry.active).length <= 1) {
      return "Debe quedar al menos un administrador activo.";
    }
    if (getUserSiteReferences(user, sites).length) return "Quita o reasigna primero este usuario en las sedes vinculadas.";
    const tickets = readStoredArray(TICKETS_STORAGE_KEY);
    if (tickets.some(ticket => ticket && ["leaderId", "technicianId", "supervisorId", "recordedById", "createdById"].some(key => ticket[key] === id))) {
      return "No se puede eliminar: el usuario aparece en tickets. Desactiva la cuenta para conservar el historial.";
    }
    const records = readStoredObject(MACHINE_RECORDS_KEY);
    if (Object.values(records).some(record => ["maintenance", "mileage"].some(type =>
      Array.isArray(record?.[type]) && record[type].some(entry =>
        entry && ["recordedById", "technicianId", "supervisorId"].some(key => entry[key] === id)
      )
    ))) {
      return "No se puede eliminar: el usuario aparece en registros de mantenimiento o kilometraje. Desactiva la cuenta para conservar el historial.";
    }
    return "";
  }

  function ensureSitesSeeded() {
    return readSites();
  }
  function nextSiteCode(sites) {
    const maxCode = (sites || ensureSitesSeeded()).reduce((max, site) => Math.max(max, Number(site.internalCode) || 0), 0);
    return Math.max(maxCode + 1, 1);
  }

  function ensureSeeded() {
    const users = readUsers();
    let changed = false;
    users.forEach(user => {
      if (!Array.isArray(user.siteIds)) {
        user.siteIds = [];
        changed = true;
      }
      if (Object.prototype.hasOwnProperty.call(user, "password")) {
        delete user.password;
        changed = true;
      }
    });
    if (changed) writeUsers(users);
    return users;
  }
  function makeId() {
    return "usr-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function validateFields(fields, users, ignoreId) {
    const name = String(fields.name || "").trim();
    const username = String(fields.username || "").trim();
    const password = String(fields.password || "");
    if (!name || !username) throw new Error("Completa el nombre y el usuario.");
    if (users.some(user => user.id !== ignoreId && user.username === username)) {
      throw new Error("Ese nombre de usuario ya está registrado.");
    }
    if (password && password.length < 6) {
      throw new Error("La clave debe tener al menos 6 caracteres.");
    }
    const role = fields.role || "Técnico";
    if (!["Técnico", "Supervisor", "Líder", "Administrador"].includes(role)) {
      throw new Error("Selecciona un rol válido.");
    }
    return { name, username, password, role };
  }

  function prepareSiteEquipment(equipment, fallbackCount) {
    if (!Array.isArray(equipment)) {
      const machineCount = Number(fallbackCount);
      if (!Number.isInteger(machineCount) || machineCount < 0) {
        throw new Error("La cantidad de máquinas debe ser un número entero igual o mayor que cero.");
      }
      return { equipment: undefined, machineCount };
    }
    const normalized = equipment.map(item => {
      const quantity = Number(item.quantity);
      if (!Number.isInteger(quantity) || quantity < 1) {
        throw new Error("Cada equipo seleccionado debe tener al menos una unidad.");
      }
      return {
        catalogId: String(item.catalogId || ""),
        brandId: String(item.brandId || ""),
        brandName: String(item.brandName || ""),
        name: String(item.name || ""),
        model: String(item.model || ""),
        category: String(item.category || ""),
        image: String(item.image || ""),
        quantity,
        units: Array.from({ length: quantity }, (_, index) => {
          const unit = Array.isArray(item.units) ? item.units[index] || {} : {};
          const activeFixed = unit.activeFixed === "" || unit.activeFixed === undefined || unit.activeFixed === null
            ? ""
            : Number(unit.activeFixed);
          if (activeFixed !== "" && (!Number.isInteger(activeFixed) || activeFixed < 0)) {
            throw new Error("El activo fijo debe ser un número entero igual o mayor que cero.");
          }
          return {
            unitId: String(unit.unitId || makeId()),
            activeFixed
          };
        })
      };
    });
    return { equipment: normalized, machineCount: normalized.reduce((total, item) => total + item.quantity, 0) };
  }

  function assignSiteStaff(users, siteId, role, userId) {
    const selected = userId
      ? users.find(user => user.id === userId && user.role === role && user.active)
      : null;
    if (userId && !selected) throw new Error(`Selecciona una cuenta activa de ${role.toLocaleLowerCase("es")}.`);
    users.forEach(user => {
      if (user.role !== role) return;
      user.siteIds = (user.siteIds || []).filter(id => id !== siteId);
    });
    if (selected) {
      selected.siteIds = Array.isArray(selected.siteIds) ? selected.siteIds : [];
      selected.siteIds.push(siteId);
    }
    return selected || null;
  }

  const store = {
    userDeletionBlock(id) {
      return getUserDeletionBlock(id, ensureSeeded(), ensureSitesSeeded());
    },

    siteDeletionBlock(id) {
      return getSiteDeletionBlock(id, ensureSitesSeeded(), ensureSeeded());
    },

    brandDeletionBlock(id) {
      return getBrandDeletionBlock(id, readBrands(), ensureSitesSeeded());
    },

    listUsers() {
      return ensureSeeded().map(user => Object.assign({}, user));
    },

    recordAccess(user, eventId = "") {
      if (!user || !user.id) return null;
      let history = [];
      try {
        const saved = JSON.parse(global.localStorage.getItem(ACCESS_HISTORY_KEY) || "[]");
        if (Array.isArray(saved)) history = saved;
      } catch (error) {
        history = [];
      }
      const access = {
        eventId: String(eventId || ""),
        userId: String(user.id),
        name: String(user.name || "Usuario"),
        username: String(user.username || "—"),
        role: String(user.role || "Usuario"),
        accessedAt: new Date().toISOString()
      };
      history.unshift(access);
      try {
        global.localStorage.setItem(ACCESS_HISTORY_KEY, JSON.stringify(history.slice(0, 500)));
      } catch (error) {
        // El inicio de sesión no se bloquea si el navegador no permite guardar el historial.
      }
      return Object.assign({}, access);
    },

    listRecentAccesses(limit) {
      const amount = Math.max(0, Math.floor(Number(limit) || 15));
      try {
        const history = JSON.parse(global.localStorage.getItem(ACCESS_HISTORY_KEY) || "[]");
        return Array.isArray(history) ? history.slice(0, amount).map(entry => Object.assign({}, entry)) : [];
      } catch (error) {
        return [];
      }
    },

    createUser(fields) {
      const users = ensureSeeded();
      const validated = validateFields(fields, users, null);
      if (!validated.password) throw new Error("Ingresa una clave para el nuevo usuario.");
      const now = new Date().toISOString();
      const user = {
        id: makeId(),
        name: validated.name,
        username: validated.username,
        password: validated.password,
        role: validated.role,
        active: fields.active !== false,
        siteIds: Array.isArray(fields.siteIds) ? fields.siteIds.filter(id => ensureSitesSeeded().some(site => site.id === id)) : [],
        createdAt: now,
        updatedAt: now
      };
      users.push(user);
      writeUsers(users);
      return Object.assign({}, user);
    },

    updateUser(id, fields) {
      const users = ensureSeeded();
      const index = users.findIndex(user => user.id === id);
      if (index < 0) throw new Error("No se encontró el usuario.");
      const current = users[index];
      const validated = validateFields(fields, users, id);
      if (fields.active !== false && !current.password && !validated.password) {
        throw new Error("Define una clave de al menos 6 caracteres antes de activar esta cuenta.");
      }
      if (current.role === "Administrador" && current.active && fields.active === false &&
          current.id !== PROTECTED_ADMIN_ID &&
          users.filter(user => user.role === "Administrador" && user.active).length <= 1) {
        throw new Error("Debe quedar al menos un administrador activo.");
      }
      const next = Object.assign({}, current, {
        name: validated.name,
        username: validated.username,
        role: validated.role,
        active: fields.active !== false,
        siteIds: Array.isArray(fields.siteIds) ? fields.siteIds.filter(siteId => ensureSitesSeeded().some(site => site.id === siteId)) : (current.siteIds || []),
        updatedAt: new Date().toISOString()
      });
      if (validated.password) next.password = validated.password;
      if (current.id === PROTECTED_ADMIN_ID) {
        next.role = "Administrador";
        next.active = true;
      }
      users[index] = next;
      writeUsers(users);
      return Object.assign({}, next);
    },

    deleteUser(id) {
      const users = ensureSeeded();
      const target = users.find(user => user.id === id);
      if (!target) throw new Error("No se encontró el usuario.");
      const block = getUserDeletionBlock(id, users, ensureSitesSeeded());
      if (block) throw new Error(block);
      writeUsers(users.filter(user => user.id !== id));
    },

    listSites() {
      return ensureSitesSeeded().map(site => Object.assign({}, site));
    },

    listRegions() {
      return CHILE_REGIONS.slice();
    },

    nextSiteCode() {
      return nextSiteCode(ensureSitesSeeded());
    },

    listBrands() {
      return readBrands().map(brand => Object.assign({}, brand));
    },

    createBrand(fields) {
      const brands = readBrands();
      const name = String(fields.name || "").trim();
      const equipmentCount = Number(fields.equipmentCount);
      if (!name) throw new Error("Ingresa la marca o categoría del equipo.");
      if (brands.some(brand => brand.name.toLocaleLowerCase("es") === name.toLocaleLowerCase("es"))) {
        throw new Error("Ya existe una marca con ese nombre.");
      }
      if (!Number.isInteger(equipmentCount) || equipmentCount < 0) {
        throw new Error("La cantidad debe ser un número entero igual o mayor que cero.");
      }
      const brand = { id: makeId(), name, equipmentCount, updatedAt: new Date().toISOString() };
      brands.push(brand);
      writeBrands(brands);
      return Object.assign({}, brand);
    },

    updateBrand(id, fields) {
      const brands = readBrands();
      const index = brands.findIndex(brand => brand.id === id);
      if (index < 0) throw new Error("No se encontró la marca.");
      const name = String(fields.name || "").trim();
      const equipmentCount = Number(fields.equipmentCount);
      if (!name) throw new Error("Ingresa la marca o categoría del equipo.");
      if (brands.some(brand => brand.id !== id && brand.name.toLocaleLowerCase("es") === name.toLocaleLowerCase("es"))) {
        throw new Error("Ya existe una marca con ese nombre.");
      }
      if (!Number.isInteger(equipmentCount) || equipmentCount < 0) {
        throw new Error("La cantidad debe ser un número entero igual o mayor que cero.");
      }
      brands[index] = Object.assign({}, brands[index], { name, equipmentCount, updatedAt: new Date().toISOString() });
      writeBrands(brands);
      return Object.assign({}, brands[index]);
    },

    deleteBrand(id) {
      const brands = readBrands();
      const block = getBrandDeletionBlock(id, brands, ensureSitesSeeded());
      if (block) throw new Error(block);
      writeBrands(brands.filter(brand => brand.id !== id));
    },

    createSite(fields) {
      const sites = ensureSitesSeeded();
      const users = ensureSeeded();
      const name = String(fields.name || "").trim();
      const region = String(fields.region || "").trim();
      const preparedEquipment = prepareSiteEquipment(fields.equipment, fields.machineCount);
      if (!name) throw new Error("Ingresa el nombre de la sede.");
      if (!CHILE_REGIONS.includes(region)) throw new Error("Selecciona una región válida para la sede.");
      if (sites.some(site => site.name.toLocaleLowerCase("es") === name.toLocaleLowerCase("es"))) {
        throw new Error("Ya existe una sede con ese nombre.");
      }
      const internalCode = nextSiteCode(sites);
      const siteId = makeId();
      const technician = assignSiteStaff(users, siteId, "Técnico", String(fields.technicianUserId || ""));
      const supervisor = assignSiteStaff(users, siteId, "Supervisor", String(fields.supervisorUserId || ""));
      const site = {
        id: siteId,
        internalCode,
        name,
        region,
        machineCount: preparedEquipment.machineCount,
        equipment: preparedEquipment.equipment || [],
        technicianUserId: technician ? technician.id : "",
        supervisorUserId: supervisor ? supervisor.id : "",
        technician: technician ? technician.name : "",
        supervisor: supervisor ? supervisor.name : "",
        updatedAt: new Date().toISOString()
      };
      sites.push(site);
      global.localStorage.setItem(NEXT_SITE_CODE_KEY, String(internalCode + 1));
      writeUsers(users);
      writeSites(sites);
      return Object.assign({}, site);
    },

    updateSite(id, fields) {
      const sites = ensureSitesSeeded();
      const users = ensureSeeded();
      const index = sites.findIndex(site => site.id === id);
      if (index < 0) throw new Error("No se encontró la sede.");
      const name = String(fields.name || "").trim();
      const region = String(fields.region || "").trim();
      const preparedEquipment = prepareSiteEquipment(fields.equipment, fields.machineCount);
      if (!name) throw new Error("Ingresa el nombre de la sede.");
      if (!CHILE_REGIONS.includes(region)) throw new Error("Selecciona una región válida para la sede.");
      if (sites.some(site => site.id !== id && site.name.toLocaleLowerCase("es") === name.toLocaleLowerCase("es"))) {
        throw new Error("Ya existe una sede con ese nombre.");
      }
      const technician = assignSiteStaff(users, id, "Técnico", String(fields.technicianUserId || ""));
      const supervisor = assignSiteStaff(users, id, "Supervisor", String(fields.supervisorUserId || ""));
      sites[index] = Object.assign({}, sites[index], {
        name,
        region,
        machineCount: preparedEquipment.machineCount,
        ...(preparedEquipment.equipment ? { equipment: preparedEquipment.equipment } : {}),
        technicianUserId: technician ? technician.id : "",
        supervisorUserId: supervisor ? supervisor.id : "",
        technician: technician ? technician.name : "",
        supervisor: supervisor ? supervisor.name : "",
        updatedAt: new Date().toISOString()
      });
      writeUsers(users);
      writeSites(sites);
      return Object.assign({}, sites[index]);
    },

    deleteSite(id) {
      const sites = ensureSitesSeeded();
      const block = getSiteDeletionBlock(id, sites, ensureSeeded());
      if (block) throw new Error(block);
      writeSites(sites.filter(site => site.id !== id));
    }
  };

  global.AdminStore = store;
  try { ensureSeeded(); } catch (error) { /* La caché puede estar deshabilitada en el navegador. */ }
})(window);
