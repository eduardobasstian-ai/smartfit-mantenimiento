const INTERVAL = 10 * 60 * 1000;
const CHANNEL = 'catalogo-updates:';

function createUpdates({ app, ipcMain, getWindow, dialog, loadUpdater, timers = globalThis }) {
  let updater, checking, downloading, state = { stage: 'idle' };
  let lastProgress = 0;
  const publish = next => {
    state = next;
    const window = getWindow();
    if (window && !window.isDestroyed()) window.webContents.send(CHANNEL + 'state', state);
  };
  function trusted(event) {
    const window = getWindow();
    return window && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame &&
      event.senderFrame.url.startsWith('catalogo://app/');
  }
  function getUpdater() {
    if (updater) return updater;
    updater = loadUpdater();
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.allowPrerelease = true;
    updater.channel = 'beta';
    updater.allowDowngrade = false;
    updater.disableWebInstaller = true;
    updater.on('update-available', info => {
      if (!['downloading', 'ready'].includes(state.stage)) publish({ stage: 'available', version: info.version });
    });
    updater.on('update-not-available', () => {
      if (!['downloading', 'ready'].includes(state.stage)) publish({ stage: 'idle' });
    });
    updater.on('download-progress', progress => {
      if (state.stage !== 'downloading' || Date.now() - lastProgress < 1000) return;
      lastProgress = Date.now();
      publish({ stage: 'downloading', version: state.version, percent: Math.max(0, Math.min(100, Math.round(progress.percent))) });
    });
    updater.on('update-downloaded', info => publish({ stage: 'ready', version: info.version }));
    updater.on('error', () => {
      // Las comprobaciones fallidas permanecen silenciosas; no interrumpen el trabajo.
      if (state.stage === 'downloading') publish({ stage: 'available', version: state.version, message: 'No se pudo descargar. Puedes reintentar.' });
    });
    return updater;
  }
  async function check() {
    if (!app.isPackaged || checking || ['downloading', 'ready'].includes(state.stage)) return checking;
    checking = Promise.resolve().then(() => getUpdater().checkForUpdates()).catch(() => {}).finally(() => { checking = null; });
    return checking;
  }
  ipcMain.handle(CHANNEL + 'get', event => trusted(event) ? state : null);
  ipcMain.handle(CHANNEL + 'download', async event => {
    if (!trusted(event)) throw Error('Origen no permitido.');
    if (downloading) return downloading;
    if (state.stage !== 'available') return state;
    const version = state.version;
    publish({ stage: 'downloading', version, percent: 0 });
    downloading = Promise.resolve().then(() => getUpdater().downloadUpdate()).catch(() => {
      publish({ stage: 'available', version, message: 'No se pudo descargar. Puedes reintentar.' });
    }).finally(() => { downloading = null; });
    await downloading;
    return state;
  });
  let installing = false;
  ipcMain.handle(CHANNEL + 'install', async event => {
    if (!trusted(event)) throw Error('Origen no permitido.');
    if (state.stage !== 'ready' || installing) return false;
    installing = true;
    try {
      const answer = await dialog.showMessageBox(getWindow(), {
        type: 'question', title: 'Actualizar Catálogo',
        message: 'La actualización está lista. ¿Reiniciar e instalar ahora?',
        detail: 'Guarda las ediciones que tengas abiertas antes de continuar. Tu sesión y los datos locales se conservarán.',
        buttons: ['Seguir trabajando', 'Reiniciar y actualizar'], defaultId: 0, cancelId: 0,
      });
      if (answer.response !== 1) return false;
      getUpdater().quitAndInstall(false, true);
      return true;
    } finally { installing = false; }
  });
  const first = timers.setTimeout(check, 15000);
  const interval = timers.setInterval(check, INTERVAL);
  first.unref?.(); interval.unref?.();
  return {
    check, getState: () => state,
    dispose() {
      timers.clearTimeout(first); timers.clearInterval(interval);
      for (const action of ['get', 'download', 'install']) ipcMain.removeHandler(CHANNEL + action);
    },
  };
}
module.exports = { createUpdates, INTERVAL };
