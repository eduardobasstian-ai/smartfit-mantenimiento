(() => {
  "use strict";

  let stream = null;
  let animationFrame = 0;
  let lastScanAt = 0;
  let onCode = null;
  let locked = false;
  let previousBodyOverflow = "";
  let qrDecoderPromise = null;

  const styles = document.createElement("style");
  styles.textContent = `
    .smartfit-qr-backdrop { position:fixed; z-index:500; inset:0; display:grid; place-items:center; padding:16px; background:#000b; backdrop-filter:blur(5px); }
    .smartfit-qr-backdrop[hidden] { display:none; }
    .smartfit-qr-dialog { width:min(520px,100%); max-height:calc(100vh - 32px); overflow:auto; border:1px solid #3a3d48; border-radius:16px; background:#191b22; color:#f5f5f7; box-shadow:0 24px 80px #0009; font-family:Inter,"Segoe UI",Arial,sans-serif; }
    .smartfit-qr-header { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:15px 18px; border-bottom:1px solid #343743; }
    .smartfit-qr-header h2 { margin:0; font-size:17px; }
    .smartfit-qr-close { width:38px; height:38px; border:1px solid #393c47; border-radius:9px; background:#252832; color:#f5f5f7; font-size:23px; line-height:1; cursor:pointer; }
    .smartfit-qr-body { padding:16px 18px 18px; }
    .smartfit-qr-copy,.smartfit-qr-status { margin:0 0 12px; color:#a3a6b2; font-size:13px; line-height:1.5; }
    .smartfit-qr-video-wrap { position:relative; overflow:hidden; width:100%; aspect-ratio:4/3; border:1px solid #343743; border-radius:12px; background:#090a0d; }
    .smartfit-qr-video { width:100%; height:100%; display:block; object-fit:cover; }
    .smartfit-qr-frame { position:absolute; inset:18% 18%; border:3px solid #ffb51b; border-radius:16px; box-shadow:0 0 0 999px #0003; pointer-events:none; }
    .smartfit-qr-status { min-height:20px; margin:12px 0; }
    .smartfit-qr-status[data-state="error"] { color:#ff9ba4; }
    .smartfit-qr-actions { display:flex; justify-content:flex-end; }
    .smartfit-qr-cancel { min-height:40px; padding:0 15px; border:1px solid #393c47; border-radius:9px; background:#252832; color:#f5f5f7; font:inherit; font-size:13px; font-weight:750; cursor:pointer; }
    @media (max-width:520px) { .smartfit-qr-backdrop { padding:10px; } .smartfit-qr-dialog { max-height:calc(100vh - 20px); } .smartfit-qr-frame { inset:16% 12%; } }
  `;
  document.head.append(styles);

  const backdrop = document.createElement("div");
  backdrop.className = "smartfit-qr-backdrop";
  backdrop.hidden = true;
  backdrop.innerHTML = `
    <section class="smartfit-qr-dialog" role="dialog" aria-modal="true" aria-labelledby="smartfitQrTitle">
      <header class="smartfit-qr-header"><h2 id="smartfitQrTitle">Buscar equipo por QR</h2><button class="smartfit-qr-close" type="button" data-qr-close aria-label="Cerrar lector QR">×</button></header>
      <div class="smartfit-qr-body">
        <p class="smartfit-qr-copy">Enfoca el código QR del equipo. Se leerá únicamente su número de activo fijo.</p>
        <div class="smartfit-qr-video-wrap"><video class="smartfit-qr-video" data-qr-video autoplay muted playsinline></video><span class="smartfit-qr-frame" aria-hidden="true"></span></div>
        <p class="smartfit-qr-status" data-qr-status aria-live="polite">Solicitando permiso para usar la cámara…</p>
        <div class="smartfit-qr-actions"><button class="smartfit-qr-cancel" type="button" data-qr-close>Cancelar</button></div>
      </div>
    </section>`;
  document.body.append(backdrop);

  const video = backdrop.querySelector("[data-qr-video]");
  const status = backdrop.querySelector("[data-qr-status]");
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });

  function stopCamera() {
    if (animationFrame) cancelAnimationFrame(animationFrame);
    animationFrame = 0;
    if (stream) stream.getTracks().forEach(track => track.stop());
    stream = null;
    video.srcObject = null;
  }

  function close() {
    stopCamera();
    backdrop.hidden = true;
    document.body.style.overflow = previousBodyOverflow;
    onCode = null;
    locked = false;
  }

  function showError(message) {
    status.textContent = message;
    status.dataset.state = "error";
  }

  function loadQrDecoder() {
    if (window.jsQR) return Promise.resolve(window.jsQR);
    if (qrDecoderPromise) return qrDecoderPromise;
    qrDecoderPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "vendor/jsQR.min.js?v=1.4.0";
      script.async = true;
      script.onload = () => window.jsQR ? resolve(window.jsQR) : reject(new Error("El lector QR no quedó disponible."));
      script.onerror = () => reject(new Error("No se pudo descargar el lector QR."));
      document.head.append(script);
    }).catch(error => {
      qrDecoderPromise = null;
      throw error;
    });
    return qrDecoderPromise;
  }

  function scanFrame(now) {
    if (backdrop.hidden || !stream) return;
    animationFrame = requestAnimationFrame(scanFrame);
    if (now - lastScanAt < 130 || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || locked) return;
    lastScanAt = now;
    const sourceWidth = video.videoWidth;
    const sourceHeight = video.videoHeight;
    if (!sourceWidth || !sourceHeight) return;
    const scale = Math.min(1, 1200 / sourceWidth);
    canvas.width = Math.round(sourceWidth * scale);
    canvas.height = Math.round(sourceHeight * scale);
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const frame = context.getImageData(0, 0, canvas.width, canvas.height);
    const result = window.jsQR?.(frame.data, frame.width, frame.height, { inversionAttempts: "attemptBoth" });
    if (!result?.data) return;

    const activeFixed = String(result.data).trim();
    if (!/^\d{4,16}$/.test(activeFixed)) {
      status.dataset.state = "error";
      status.textContent = "El QR leído no contiene solo un número válido de activo fijo. Enfoca el código correcto.";
      return;
    }

    locked = true;
    status.removeAttribute("data-state");
    status.textContent = `Activo fijo ${activeFixed} encontrado en el QR. Buscando equipo…`;
    const callback = onCode;
    close();
    if (typeof callback === "function") callback(activeFixed);
  }

  async function open(options = {}) {
    onCode = typeof options.onCode === "function" ? options.onCode : null;
    backdrop.hidden = false;
    previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    status.removeAttribute("data-state");
    status.textContent = "Cargando lector QR…";
    try {
      await loadQrDecoder();
    } catch (error) {
      showError("No se pudo cargar el lector QR. Comprueba la conexión e inténtalo otra vez.");
      return;
    }
    if (backdrop.hidden) return;
    status.removeAttribute("data-state");
    status.textContent = "Solicitando permiso para usar la cámara…";
    if (!navigator.mediaDevices?.getUserMedia) {
      showError("Este navegador no permite usar la cámara aquí. Abre el sitio mediante HTTPS o desde localhost y vuelve a intentarlo.");
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      video.srcObject = stream;
      await video.play();
      status.textContent = "Apunta la cámara al QR; se buscará automáticamente el activo fijo.";
      animationFrame = requestAnimationFrame(scanFrame);
    } catch (error) {
      stopCamera();
      if (error?.name === "NotAllowedError" || error?.name === "PermissionDeniedError") {
        showError("No se concedió permiso para usar la cámara. Habilítalo en los permisos del navegador y vuelve a intentarlo.");
      } else if (error?.name === "NotFoundError" || error?.name === "DevicesNotFoundError") {
        showError("No se encontró una cámara disponible en este dispositivo.");
      } else if (error?.name === "NotReadableError" || error?.name === "TrackStartError") {
        showError("La cámara está ocupada por otra aplicación. Ciérrala e inténtalo nuevamente.");
      } else {
        showError("No se pudo iniciar la cámara. Verifica que el sitio use HTTPS o localhost y revisa los permisos del dispositivo.");
      }
    }
  }

  backdrop.addEventListener("click", event => {
    if (event.target === backdrop || event.target.closest("[data-qr-close]")) close();
  });
  document.addEventListener("keydown", event => {
    if (!backdrop.hidden && event.key === "Escape") close();
  });
  window.SmartFitQrScanner = { open, close };
})();
