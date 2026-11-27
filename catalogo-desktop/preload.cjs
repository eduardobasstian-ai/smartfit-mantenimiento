const { ipcRenderer } = require('electron');
const REMIND_EVERY = 10 * 60 * 1000;
const HIDE_AFTER = 12000;
let state = { stage: 'idle' }, panel, title, text, action, hideTimer;
function reveal() {
  if (!panel || !['available', 'downloading', 'ready'].includes(state.stage)) return;
  panel.hidden = false;
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => { panel.hidden = true; }, HIDE_AFTER);
}
function paint(next) {
  if (!next || !panel) return;
  const changed = next.stage !== state.stage || next.version !== state.version || next.message !== state.message;
  state = next;
  if (state.stage === 'idle') { panel.hidden = true; return; }
  title.textContent = state.stage === 'ready' ? 'Actualización lista' : state.stage === 'downloading' ? 'Descargando actualización' : 'Actualización disponible';
  text.textContent = state.message || (state.stage === 'downloading' ? `${state.percent || 0} % · Puedes seguir trabajando.` : `Versión ${state.version}. Puedes seguir trabajando.`);
  action.textContent = state.stage === 'ready' ? 'Reiniciar y actualizar' : state.stage === 'downloading' ? 'Descargando…' : 'Actualizar';
  action.disabled = state.stage === 'downloading';
  if (changed) reveal();
}
window.addEventListener('DOMContentLoaded', () => {
  const style = document.createElement('style');
  style.textContent = '.catalog-update-notice{position:fixed;right:18px;bottom:18px;z-index:100000;box-sizing:border-box;width:min(350px,calc(100vw - 36px));padding:14px 38px 14px 15px;border:1px solid #6b5524;border-radius:12px;background:#202128;color:#f4f4f6;box-shadow:0 5px 24px #0005;font:13px/1.4 system-ui,sans-serif}.catalog-update-notice[hidden]{display:none}.catalog-update-notice strong{display:block;color:#ffba17}.catalog-update-notice p{margin:6px 0 10px;color:#c3c6cf}.catalog-update-notice button{cursor:pointer;font:inherit}.catalog-update-action{padding:7px 11px;border:0;border-radius:7px;background:#ffba17;color:#151515;font-weight:700}.catalog-update-action:disabled{opacity:.7;cursor:default}.catalog-update-close{position:absolute;top:8px;right:8px;border:0;background:transparent;color:#d2d4dc;font-size:20px!important}.catalog-update-notice button:focus-visible{outline:2px solid white;outline-offset:3px}';
  document.head.append(style);
  panel = document.createElement('aside');
  panel.className = 'catalog-update-notice';
  panel.hidden = true;
  panel.setAttribute('aria-label', 'Actualizaciones del Catálogo');
  title = document.createElement('strong');
  title.setAttribute('role', 'status');
  text = document.createElement('p');
  action = document.createElement('button');
  action.type = 'button'; action.className = 'catalog-update-action';
  const close = document.createElement('button');
  close.type = 'button'; close.className = 'catalog-update-close'; close.textContent = '×';
  close.setAttribute('aria-label', 'Ocultar aviso de actualización');
  close.onclick = () => { panel.hidden = true; clearTimeout(hideTimer); };
  action.onclick = () => {
    const method = state.stage === 'ready' ? 'install' : 'download';
    ipcRenderer.invoke('catalogo-updates:' + method).catch(() => {});
  };
  panel.append(title, text, action, close); document.body.append(panel);
  ipcRenderer.on('catalogo-updates:state', (_event, next) => paint(next));
  ipcRenderer.invoke('catalogo-updates:get').then(paint).catch(() => {});
  const reminder = setInterval(() => {
    if (!document.hidden && ['available', 'ready'].includes(state.stage)) reveal();
  }, REMIND_EVERY);
  window.addEventListener('beforeunload', () => { clearInterval(reminder); clearTimeout(hideTimer); }, { once: true });
});
