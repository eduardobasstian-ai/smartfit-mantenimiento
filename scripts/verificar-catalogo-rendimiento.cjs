const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
let calls = 0;
let value = 'Pantalla';
const window = { dispatchEvent() {} };
const context = { window, performance, CustomEvent, crypto, console,
  fetch: async (_url, options) => {
    calls++;
    await new Promise(resolve => setTimeout(resolve, 10));
    return new Response(JSON.stringify(options.method === 'POST' ? null : [{ tipo: 'nombre', clave: '1', valor: value }]));
  },
};
vm.runInNewContext(fs.readFileSync('catalogo/equipos/sincronizacion.js', 'utf8'), context);
(async () => {
  const sync = window.CatalogSync;
  const connect = () => sync.connect({ url: 'https://prueba.invalid', key: 'prueba', role: 'supervisor', getToken: async () => 'token-prueba' });
  connect();
  const scope = sync.forModel('t600x-sf');
  const [a, b] = await Promise.all([scope.read(true), scope.read(true)]);
  assert.equal(calls, 1, 'Las lecturas simultáneas deben compartir una petición.');
  assert.equal(a, b);
  assert.equal(await scope.read(true), a, 'Sin cambios no debe reconstruirse el índice.');
  const before = calls;
  assert.equal(await scope.read(), a);
  assert.equal(calls, before, 'La navegación inmediata debe reutilizar el caché.');
  const [names, sameNames] = await Promise.all([sync.readBrandNames('matrix', true), sync.readBrandNames('matrix', true)]);
  assert.equal(names, sameNames);
  assert.equal(await sync.readBrandNames('matrix', true), names);
  value = 'Pantalla nueva';
  await scope.save([{ tipo: 'nombre', clave: '1', valor: value }]);
  assert.equal((await scope.read())[0].valor, value, 'Un guardado debe invalidar la lectura anterior.');
  const oldRead = scope.read(true);
  connect();
  await assert.rejects(oldRead, /sesión/);
  const html = fs.readFileSync('catalogo/catalogo.html', 'utf8');
  for (const file of ['plano.js', 'inventario.js', 'catalogo-edicion.js', 'fotos.js']) {
    assert.ok(!html.includes('src="equipos/' + file), file + ' debe cargarse al abrir la vista.');
  }
  console.log('OK: peticiones compartidas, caché estable, invalidación, aislamiento de sesión y carga bajo demanda.');
})().catch(error => { console.error(error); process.exitCode = 1; });
