const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('telemetry.js','utf8');
function check(url, automated, testMode = false) {
  const location=new URL(url), listeners=new Map();
  const state={scripts:0,errors:0,config:null};
  const client={init:config=>{state.config=config;},captureException:()=>{state.errors++;}};
  const window={__SMARTFIT_AUTOMATED_TEST__:testMode,Sentry:client,addEventListener:(name,callback)=>listeners.set(name,callback),requestIdleCallback:fn=>fn()};
  const sandbox={URL,Error,location,navigator:{webdriver:automated,userAgent:'test'},window,
    document:{currentScript:{src:new URL('../telemetry.js',location).href},readyState:'complete',
      createElement:()=>({}),head:{append(script){state.scripts++;script.onload();}}},
    performance:{getEntriesByType:()=>[]},setTimeout};
  vm.runInNewContext(source,sandbox);
  listeners.get('error')?.({error:new Error('prueba sin envío')});
  return state;
}
for(const url of ['file:///C:/proyecto/catalogo/catalogo.html','https://example.com/catalogo/catalogo.html']){
  const result=check(url,true);assert.equal(result.scripts,0);assert.equal(result.errors,0);
  const explicit=check(url,false,true);assert.equal(explicit.scripts,0);assert.equal(explicit.errors,0);
}
for(const url of ['file:///C:/proyecto/catalogo/catalogo.html','http://localhost:8788/catalogo/catalogo.html','http://127.0.0.1/catalogo/catalogo.html','http://[::1]/catalogo/catalogo.html']){
  const result=check(url,false);assert.equal(result.config.environment,'development');assert.equal(result.errors,1);
}
for(const url of ['https://example.com/catalogo/catalogo.html','catalogo://app/catalogo/catalogo.html']){
  const result=check(url,false);assert.equal(result.config.environment,'production');assert.equal(result.errors,1);
}
const maintenance=check('https://example.com/index.html',true);
assert.equal(maintenance.config.environment,'production');assert.equal(maintenance.errors,1);
console.log('OK: pruebas del catálogo sin envío; errores normales capturados; entornos local/web/escritorio correctos; Mantenimiento conserva su comportamiento.');
