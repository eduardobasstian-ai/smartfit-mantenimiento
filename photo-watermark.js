(function (global) {
  "use strict";

  let logoPromise;
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

  function getLogo() {
    if (!logoPromise) {
      logoPromise = new Promise(resolve => {
        const logo = new Image();
        const timer = setTimeout(() => resolve(null), 300);
        logo.onload = () => { clearTimeout(timer); resolve(logo); };
        logo.onerror = () => { clearTimeout(timer); resolve(null); };
        logo.src = new URL("IMG/logo-header.png", global.location.href).href;
      });
    }
    return logoPromise;
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
          finish(`GPS aprox. ${latitude.toFixed(5)}, ${longitude.toFixed(5)} · ±${Math.round(accuracy)} m`);
        }, () => { clearTimeout(timer); finish(""); }, { enableHighAccuracy: false, maximumAge: 600000, timeout: 1800 });
      } catch (_) { clearTimeout(timer); finish(""); }
    });
    return locationPromise;
  }

  function roundedRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(x, y, width, height, radius) : ctx.rect(x, y, width, height);
    ctx.fill();
  }

  async function draw(ctx, canvas, supplied = {}) {
    const fallback = sessionContext();
    const person = String(supplied.person || fallback.person || "Personal SmartFit").trim();
    const site = String(supplied.site || fallback.site || "").trim();
    const [logo, gps] = await Promise.all([getLogo(), getLocation()]);
    const w = canvas.width, h = canvas.height;
    const scale = Math.max(1, Math.min(w, h) / 900);
    const pad = Math.round(14 * scale);
    const font = Math.max(12, Math.round(Math.min(w, h) * 0.022));
    const line = Math.round(font * 1.45);
    const rightText = [site ? `Sede: ${site}` : "", gps, new Intl.DateTimeFormat("es-CL", { dateStyle: "short", timeStyle: "short" }).format(new Date())].filter(Boolean);
    const logoW = Math.min(Math.round(w * 0.28), Math.round(190 * scale));
    const logoH = logo ? logoW * (logo.naturalHeight / logo.naturalWidth) : line * 1.4;
    const leftW = logoW + pad * 2;
    ctx.save();
    const metaFont = Math.max(11, Math.round(font * 0.82));
    ctx.font = `500 ${metaFont}px system-ui, Arial, sans-serif`;
    const rightW = Math.min(Math.round(w * 0.66), Math.max(...rightText.map(text => ctx.measureText(text).width)) + pad * 2);
    const badgeH = Math.max(logoH + pad * 2, line * rightText.length + pad * 2);
    const y = h - badgeH - pad;
    ctx.fillStyle = "rgba(8, 10, 15, 0.78)";
    roundedRect(ctx, pad, y, leftW, badgeH, Math.round(10 * scale));
    roundedRect(ctx, w - rightW - pad, y, rightW, badgeH, Math.round(10 * scale));
    if (logo) {
      const ratio = Math.min((leftW - pad * 2) / logo.naturalWidth, (badgeH - pad * 2) / logo.naturalHeight);
      const dw = logo.naturalWidth * ratio, dh = logo.naturalHeight * ratio;
      ctx.drawImage(logo, pad + (leftW - dw) / 2, y + (badgeH - dh) / 2, dw, dh);
    } else {
      ctx.textAlign = "center";
      ctx.font = `800 ${Math.round(font * 1.35)}px system-ui, Arial, sans-serif`;
      ctx.fillStyle = "#fff";
      ctx.fillText("smart", pad + leftW * 0.44, y + badgeH * 0.48);
      ctx.fillStyle = "#ffb51b";
      ctx.fillText("fit", pad + leftW * 0.69, y + badgeH * 0.48);
    }
    ctx.textAlign = "right";
    ctx.font = `700 ${font}px system-ui, Arial, sans-serif`;
    ctx.fillStyle = "#ffffff";
    const nameWidth = Math.min(Math.round(w * 0.68), ctx.measureText(person).width + pad * 2);
    ctx.fillStyle = "rgba(8, 10, 15, 0.78)";
    roundedRect(ctx, w - nameWidth - pad, pad, nameWidth, line + pad, Math.round(8 * scale));
    ctx.fillStyle = "#ffffff";
    ctx.fillText(person, w - pad * 2, pad + line * 0.78, nameWidth - pad * 2);
    ctx.font = `500 ${metaFont}px system-ui, Arial, sans-serif`;
    ctx.fillStyle = "#f4f4f5";
    rightText.forEach((text, index) => ctx.fillText(text, w - pad * 2, y + pad + font + line * index, rightW - pad * 2));
    ctx.restore();
  }

  global.SmartFitPhotoWatermark = Object.freeze({ draw });
})(window);
