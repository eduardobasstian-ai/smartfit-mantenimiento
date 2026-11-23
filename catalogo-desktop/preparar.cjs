const fs = require("node:fs");
const path = require("node:path");

const source = path.resolve(__dirname, "../catalogo");
const destination = path.join(__dirname, "contenido/catalogo");
fs.mkdirSync(destination, { recursive: true });
for (const name of ["catalogo.html", "index.html", "supabase-auth.js", "IMG", "equipos", "catalogo-assets"]) {
  fs.cpSync(path.join(source, name), path.join(destination, name), { recursive: true });
}
for (const file of fs.readdirSync(path.join(source, "marcas"), { recursive: true, withFileTypes: true })) {
  if (!file.isFile() || !/logo.*\.(png|jpe?g|avif|webp|ico)$/i.test(file.name)) continue;
  const original = path.join(file.parentPath, file.name);
  const target = path.join(destination, "marcas", path.relative(path.join(source, "marcas"), original));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(original, target);
}
console.log("Recursos del catálogo preparados.");
fs.copyFileSync(path.resolve(__dirname, "../telemetry.js"), path.join(__dirname, "contenido/telemetry.js"));
fs.mkdirSync(path.join(__dirname, "contenido/vendor"), { recursive: true });
fs.copyFileSync(
  path.resolve(__dirname, "../vendor/sentry-browser-tracing-11.16.0.min.js"),
  path.join(__dirname, "contenido/vendor/sentry-browser-tracing-11.16.0.min.js")
);
