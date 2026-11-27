const { app, BrowserWindow, Menu, net, protocol, session, dialog, ipcMain } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const origin = "catalogo://app";
const resourceRoot = app.isPackaged
  ? path.join(process.resourcesPath, "catalogo")
  : path.resolve(__dirname, "contenido");

protocol.registerSchemesAsPrivileged([{
  scheme: "catalogo",
  privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true },
}]);

let mainWindow;
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow?.isMinimized()) mainWindow.restore();
    mainWindow?.show();
    mainWindow?.focus();
  });
  app.whenReady().then(async () => {
    app.setAppUserModelId("cl.smartfit.catalogo.beta");
    protocol.handle("catalogo", async request => {
      try {
        const url = new URL(request.url);
        if (url.hostname !== "app") return new Response("Recurso no disponible", { status: 404 });
        const relative = decodeURIComponent(url.pathname).replace(/^\/+/, "") || "catalogo/catalogo.html";
        const file = path.resolve(resourceRoot, relative);
        if (!file.startsWith(resourceRoot + path.sep)) return new Response("Acceso denegado", { status: 403 });
        return await net.fetch(pathToFileURL(file).href);
      } catch {
        return new Response("Recurso no disponible", { status: 404 });
      }
    });
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, answer) => answer(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    Menu.setApplicationMenu(null);
    mainWindow = new BrowserWindow({
      width: 1440,
      height: 960,
      minWidth: 800,
      minHeight: 600,
      show: false,
      title: "Catálogo SmartFit Beta",
      backgroundColor: "#101116",
      icon: path.join(resourceRoot, "catalogo/IMG/favicon.ico"),
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, preload: path.join(__dirname, 'preload.cjs') },
    });
    mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    mainWindow.webContents.on("will-navigate", (event, url) => {
      if (!url.startsWith(origin + "/")) event.preventDefault();
    });
    mainWindow.once("ready-to-show", () => mainWindow.show());
    const updates = require('./actualizaciones.cjs').createUpdates({ app, ipcMain, getWindow: () => mainWindow, dialog, loadUpdater: () => require('electron-updater').autoUpdater });
    app.once('before-quit', () => updates.dispose());
    await mainWindow.loadURL(origin + "/catalogo/catalogo.html");
  }).catch(error => {
    dialog.showErrorBox("No se pudo abrir el catálogo", error.message);
    app.quit();
  });
  app.on("window-all-closed", () => app.quit());
}
