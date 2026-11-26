(function (global) {
  "use strict";

  var connectionCheckUrl = "https://acmcksmiqrfrxopceies.supabase.co/auth/v1/health";
  var publishableKey = "sb_publishable_uWaLgff_Xc03iC68QpUUuQ_QkmCLLGy";

  let needsRecovery = !navigator.onLine;
  let probe = null;
  let refresh = null;
  let notifyViews = false;
  let timer;
  let retryDelay = 2000;
  let active = true;
  let manualRefresh = null;

  function schedule(delay) {
    clearTimeout(timer);
    if (active && !document.hidden) timer = setTimeout(monitor, delay);
  }

  function retrySoon() {
    needsRecovery = true;
    schedule(retryDelay);
  }

  function checkConnection() {
    if (!navigator.onLine) {
      retrySoon();
      return Promise.resolve(false);
    }
    if (probe) return probe;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    probe = (async () => {
      try {
        const response = await fetch(connectionCheckUrl, {
          cache: "no-store", headers: { apikey: publishableKey }, signal: controller.signal
        });
        if (!response.ok || !navigator.onLine) retrySoon();
        return response.ok && navigator.onLine;
      } catch (_) {
        retrySoon();
        return false;
      }
    })().finally(() => { clearTimeout(timeout); probe = null; });
    return probe;
  }

  function syncData(options) {
    const data = global.SmartFitSupabaseData;
    if (!data) {
      needsRecovery = false;
      return Promise.resolve({ ok: true, refreshed: false });
    }
    notifyViews ||= options.dispatchUpdate !== false;
    if (refresh) return refresh;
    refresh = (async () => {
      let retryFailed = false;
      try { await data.retryPending?.(); }
      catch (_) { retryFailed = true; }
      const result = await data.hydrate?.();
      const refreshed = Boolean(result && !result.skipped);
      if (refreshed) {
        data.startRealtimeSync?.();
        if (notifyViews) {
          global.dispatchEvent(new CustomEvent("smartfit:supabase-data-hydrated", {
            detail: { tables: ["sites", "brands", "equipment", "tickets", "maintenance_events", "mileage_records", "maintenance_event_tickets", "inspection_records", "profiles", "site_assignments", "admin_user_access", "audit_log"] }
          }));
        }
      }
      needsRecovery = retryFailed || !navigator.onLine;
      if (needsRecovery) retrySoon();
      return { ok: true, refreshed };
    })().catch(error => {
      retrySoon();
      return { ok: false, error };
    }).finally(() => { refresh = null; notifyViews = false; });
    return refresh;
  }

  async function refreshRequested(options) {
    if ((!navigator.onLine || needsRecovery) && !await checkConnection()) return { ok: false };
    return syncData(options);
  }

  function runManualRefresh(work) {
    if (manualRefresh) return manualRefresh;
    let indicator;
    const delay = setTimeout(() => {
      indicator = document.createElement("div");
      indicator.setAttribute("role", "status");
      indicator.textContent = "Procesando…";
      indicator.style.cssText = "position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:2147483647;padding:12px 18px;border:1px solid #454854;border-radius:12px;background:#191b22;color:white;font:600 15px system-ui;pointer-events:none";
      document.body?.append(indicator);
    }, 700);
    let release;
    const background = new Promise(resolve => { release = resolve; });
    const foregroundLimit = setTimeout(() => release({ pending: true }), 1800);
    const task = Promise.resolve().then(work).finally(() => { manualRefresh = null; });
    manualRefresh = Promise.race([task, background]).finally(() => {
      clearTimeout(foregroundLimit);
      clearTimeout(delay);
      indicator?.remove();
    });
    return manualRefresh;
  }

  function reconnectAndRefresh(options = {}) {
    return options.silent ? refreshRequested(options) : runManualRefresh(() => refreshRequested(options));
  }

  async function monitor() {
    if (!active || document.hidden) return;
    if (await checkConnection() && needsRecovery) await syncData({ dispatchUpdate: false });
    schedule(needsRecovery ? retryDelay : 60000);
    retryDelay = needsRecovery ? Math.min(8000, retryDelay * 2) : 2000;
  }

  function startMonitoring() {
    active = true;
    clearTimeout(timer);
    void monitor();
  }

  global.addEventListener("offline", retrySoon);
  global.addEventListener("online", () => { retrySoon(); void monitor(); });
  global.addEventListener("focus", monitor);
  document.addEventListener("visibilitychange", monitor);
  global.addEventListener("pagehide", () => { active = false; clearTimeout(timer); });
  global.addEventListener("pageshow", event => { if (event.persisted) startMonitoring(); });
  global.SmartFitOnlineGuard = { checkConnection, reconnectAndRefresh, runManualRefresh };
  startMonitoring();
})(window);
