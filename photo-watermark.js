(function (global) {
  "use strict";

  let locationPromise;

  function sessionContext() {
    for (const key of ["smartfit.site.session", "smartfit.leader.session", "smartfit.admin.session"]) {
      try {
        const session = JSON.parse(sessionStorage.getItem(key) || "null");
        if (session) return { person: session.name || session.fullName || "", site: session.siteName || session.site_name || "" };
      } catch (_) {}
    }
    return { person: "", site: "" };
  }

  function getLocation() {
    if (locationPromise) return locationPromise;
    locationPromise = new Promise(resolve => {
      if (!global.isSecureContext || !navigator.geolocation) return resolve("");
      let settled = false;
      const finish = value => { if (!settled) { settled = true; resolve(value); } };
      const timer = setTimeout(() => finish(""), 250);
      try {
        navigator.geolocation.getCurrentPosition(position => {
          clearTimeout(timer);
          const { latitude, longitude, accuracy } = position.coords;
          finish(`${latitude.toFixed(5)}, ${longitude.toFixed(5)} · ±${Math.round(accuracy)} m`);
        }, () => { clearTimeout(timer); finish(""); }, { enableHighAccuracy: false, maximumAge: 600000, timeout: 1800 });
      } catch (_) { clearTimeout(timer); finish(""); }
    });
    return locationPromise;
  }

  function shadow(ctx) {
    ctx.shadowColor = "rgba(0,0,0,.5)";
    ctx.shadowBlur = 2;
    ctx.shadowOffsetX = 1;
    ctx.shadowOffsetY = 1;
  }

  function wrapText(ctx, text, maxWidth) {
    const words = String(text).split(/\s+/).filter(Boolean);
    const lines = [];
    let line = "";
    words.forEach(word => {
      const candidate = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(candidate).width > maxWidth) {
        lines.push(line);
        line = word;
      } else line = candidate;
    });
    if (line) lines.push(line);
    return lines;
  }

  function drawSmartFit(ctx, x, y, imageWidth, margin) {
    const targetWidth = Math.max(1, Math.min(imageWidth * 0.22, imageWidth - margin * 2));
    ctx.font = "800 100px system-ui, Arial, sans-serif";
    const smartWidthAt100 = ctx.measureText("smart").width;
    ctx.font = "800 104px system-ui, Arial, sans-serif";
    const fitWidthAt100 = ctx.measureText("fit").width;
    const font = 100 * targetWidth / (smartWidthAt100 + fitWidthAt100 + 8);
    ctx.save();
    shadow(ctx);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.font = `800 ${font}px system-ui, Arial, sans-serif`;
    ctx.fillStyle = "rgba(255,255,255,.92)";
    ctx.fillText("smart", x, y);
    const smartWidth = ctx.measureText("smart").width;
    ctx.font = `800 ${font * 1.04}px system-ui, Arial, sans-serif`;
    ctx.fillStyle = "rgba(255,181,27,.96)";
    const fitX = x + smartWidth + font * 0.08;
    ctx.fillText("fit", fitX, y);
    const fitWidth = ctx.measureText("fit").width;
    ctx.shadowColor = "transparent";
    ctx.beginPath();
    ctx.moveTo(fitX + font * 0.05, y + font * 0.17);
    ctx.quadraticCurveTo(fitX + fitWidth * 0.48, y + font * 0.63, fitX + fitWidth * 0.96, y + font * 0.17);
    ctx.strokeStyle = "rgba(255,181,27,.96)";
    ctx.lineWidth = Math.max(1.5, font * 0.085);
    ctx.lineCap = "round";
    ctx.stroke();
    ctx.restore();
  }

  async function draw(ctx, canvas, supplied = {}) {
    const fallback = sessionContext();
    const person = String(supplied.person || fallback.person || "Personal SmartFit").trim();
    const site = String(supplied.site || fallback.site || "").trim();
    const region = String(supplied.region || "").trim();
    const gps = await getLocation();
    const width = canvas.width, height = canvas.height;
    const shortest = Math.min(width, height);
    const margin = Math.max(12, Math.round(shortest * 0.018));
    const detailFont = Math.max(12, width * 0.025);
    const lineHeight = detailFont * 1.35;
    const emitted = new Intl.DateTimeFormat("es-CL", { dateStyle: "medium", timeStyle: "short" }).format(new Date());
    const details = [person, site ? `Sede: ${site}${region ? ` · ${region}` : ""}` : region, gps ? `GPS aprox.: ${gps}` : "", emitted].filter(Boolean);
    const logoFont = Math.min(width * 0.22, width - margin * 2) / 4.5;
    const logoY = height - margin - logoFont * 0.68;
    ctx.save();
    // Texto y marca sin placas: solo una sombra fina para conservar la lectura.
    drawSmartFit(ctx, margin, logoY, width, margin);

    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "right";
    shadow(ctx);
    ctx.font = `500 ${detailFont}px system-ui, Arial, sans-serif`;
    ctx.fillStyle = "rgba(255,255,255,.92)";
    const detailMaxWidth = Math.max(100, width * 0.68);
    const detailLines = details.flatMap(line => wrapText(ctx, line, detailMaxWidth));
    detailLines.forEach((line, index) => {
      ctx.fillText(line, width - margin, height - margin - (detailLines.length - index - 1) * lineHeight, detailMaxWidth);
    });
    ctx.restore();
  }

  global.SmartFitPhotoWatermark = Object.freeze({ draw });
})(window);
