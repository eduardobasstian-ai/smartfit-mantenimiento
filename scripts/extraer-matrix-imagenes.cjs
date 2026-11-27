// Descarga solo imágenes de fichas públicas cuyo número coincide exactamente con el BOM.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const workspace = process.cwd();
const scratch = path.join(workspace, 'tmp/matrix-parts-extraccion');
const folder = path.join(workspace, 'catalogo/catalogo-assets/t600x-sf-repuestos-extraidos');
fs.mkdirSync(path.join(folder, 'imagenes'), { recursive: true });
fs.mkdirSync(path.join(scratch, 'originales'), { recursive: true });
const finalQueries = path.join(scratch, 'consultas-final.json');
const manifestPath = path.join(folder, 'manifest.json');
const previous = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : {};
const checkpoint = fs.existsSync(finalQueries) ? finalQueries : path.join(scratch, 'consultas.json');
const queries = fs.existsSync(checkpoint) ? JSON.parse(fs.readFileSync(checkpoint, 'utf8')) : { results: previous.queries, done: previous.queriesDone, total: previous.queriesTotal, running: false };
const partsPath = path.join(scratch, 'referencias.json');
const parts = fs.existsSync(partsPath) ? JSON.parse(fs.readFileSync(partsPath, 'utf8')) : previous.parts;
if(!Array.isArray(queries.results)||!Array.isArray(parts))throw new Error('Faltan las consultas y referencias de origen.');
const images = new Map((previous.images || []).map(row => [row.url, row]));
const errors = [];
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function dimensions(b) {
  if (b.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return { type:'png', width:b.readUInt32BE(16), height:b.readUInt32BE(20) };
  if (b[0] === 255 && b[1] === 216) {
    let p = 2;
    while (p + 9 < b.length) {
      if (b[p++] !== 255) continue;
      while (b[p] === 255) p++;
      const marker = b[p++];
      if (marker === 217 || marker === 218) break;
      if (marker === 1 || marker >= 208 && marker <= 215) continue;
      const length = b.readUInt16BE(p);
      if (length < 2 || p + length > b.length) break;
      if ([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)) return { type:'jpg', width:b.readUInt16BE(p+5), height:b.readUInt16BE(p+3) };
      p += length;
    }
  }
  throw new Error('Formato o dimensiones de imagen no verificables');
}
function optimizePng(b) {
  const chunks = [], idats = [];
  for (let p=8; p<b.length;) {
    const size=b.readUInt32BE(p), end=p+size+12;
    if(end>b.length)throw new Error('PNG incompleto');
    const kind=b.toString('ascii',p+4,p+8);
    chunks.push({kind,bytes:b.subarray(p,end)});
    if(kind==='IDAT')idats.push(b.subarray(p+8,end-4));
    p=end;
  }
  const pixels=zlib.inflateSync(Buffer.concat(idats));
  const data=zlib.deflateSync(pixels,{level:9});
  if(!zlib.inflateSync(data).equals(pixels))throw new Error('La compresión cambió datos');
  const body=Buffer.concat([Buffer.from('IDAT'),data]);
  let crc=0xffffffff;
  for(const byte of body){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^(crc&1?0xedb88320:0);}
  const chunk=Buffer.alloc(data.length+12);chunk.writeUInt32BE(data.length);body.copy(chunk,4);chunk.writeUInt32BE((crc^0xffffffff)>>>0,chunk.length-4);
  let written=false;
  const result=Buffer.concat([b.subarray(0,8),...chunks.flatMap(c=>c.kind!=='IDAT'?[c.bytes]:written?[]:(written=true,[chunk]))]);
  return result.length<b.length?result:b;
}
const urls=[...new Set(queries.results.filter(q=>q.exact).flatMap(q=>(q.images||[]).map(i=>i.url)))];
let cursor=0,blocked=false;
async function worker(){
  while(cursor<urls.length&&!blocked){
    const url=urls[cursor++];
    if(images.has(url)&&fs.existsSync(path.join(folder,images.get(url).file)))continue;
    try{
      const parsed=new URL(url);
      if(parsed.protocol!=='https:'||parsed.hostname!=='parts.matrixfitness.com'||parsed.pathname!=='/resource.php')throw new Error('Origen de imagen no permitido');
      if(!parsed.searchParams.get('url')||parsed.searchParams.get('url').endsWith('/'))throw new Error('La ficha no proporciona un archivo de imagen');
      if(/placeholder|no.?image|image.?not.?found/i.test(url))throw new Error('Imagen genérica sin fotografía');
      const response=await fetch(url,{signal:AbortSignal.timeout(30000)});
      if([403,429].includes(response.status))blocked=true;
      if(!response.ok)throw new Error('HTTP '+response.status);
      const original=Buffer.from(await response.arrayBuffer());
      const info=dimensions(original);
      if(info.width<30||info.height<30)throw new Error('Imagen demasiado pequeña');
      const originalHash=hash(original);
      fs.writeFileSync(path.join(scratch,'originales',originalHash+'.'+info.type),original);
      const optimized=info.type==='png'?optimizePng(original):original;
      const optimizedInfo=dimensions(optimized);
      if(info.width!==optimizedInfo.width||info.height!==optimizedInfo.height)throw new Error('Dimensiones alteradas');
      const sha256=hash(optimized),file='imagenes/'+sha256.slice(0,24)+'.'+info.type;
      fs.writeFileSync(path.join(folder,file),optimized);
      images.set(url,{url,file,...info,originalBytes:original.length,bytes:optimized.length,originalSha256:originalHash,sha256,optimization:optimized===original?'original':'PNG sin pérdida; conserva todos los chunks ajenos a IDAT'});
    }catch(error){errors.push({url,error:error.message});}
    await new Promise(r=>setTimeout(r,200));
  }
}
(async()=>{
  await Promise.all([worker(),worker()]);
  const mappings=parts.map(part=>{
    const matches=queries.results.filter(q=>q.exact&&[part.sap,part.reference].includes(q.code));
    const files=[...new Set(matches.flatMap(q=>(q.images||[]).map(i=>images.get(i.url)?.file).filter(Boolean)))];
    return {item:part.item,reference:part.reference||'',sap:part.sap||'',description:part.description||'',files,matches:matches.map(q=>({code:q.code,partNo:q.partNo,description:q.description,urls:q.images.map(i=>i.url)}))};
  });
  const rows=[...images.values()];
  const manifest={model:'Matrix T600X SF',drawing:'MTM3839-00',source:'https://parts.matrixfitness.com/home',extractedAt:new Date().toISOString(),complete:queries.done===queries.total&&!queries.running,queriesDone:queries.done,queriesTotal:queries.total,partsTotal:parts.length,partsWithImages:mappings.filter(p=>p.files.length).length,uniqueImages:new Set(rows.map(i=>i.file)).size,bytes:rows.reduce((n,i)=>n+i.bytes,0),images:rows,parts:mappings,queries:queries.results,errors,blocked};
  fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2));
  const csv=[['Item','Reference No.','SAP Parts No.','Descripcion','Imagenes locales'],...mappings.map(p=>[p.item,p.reference,p.sap,p.description,p.files.join(' | ')])].map(row=>row.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(';')).join('\r\n');
  fs.writeFileSync(path.join(folder,'referencias.csv'),'\ufeff'+csv);
  const pending=[['Item','Reference No.','SAP Parts No.','Descripcion','Motivo'],...mappings.filter(p=>!p.files.length).map(p=>[p.item,p.reference,p.sap,p.description,p.matches.length?'Ficha encontrada sin imagen valida':'Sin coincidencia exacta en el portal'])].map(row=>row.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(';')).join('\r\n');
  fs.writeFileSync(path.join(folder,'pendientes.csv'),'\ufeff'+pending);
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const copyButton=p=>p.sap?`<button class="copy-sap" type="button" data-sap="${esc(p.sap)}" data-tooltip="Copiar SAP" aria-label="Copiar SAP"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg></button>`:'';
  const copyStyle=`.sap-line{display:flex;align-items:center;gap:8px;min-width:0}.sap-line>span{min-width:0;overflow-wrap:anywhere}.copy-sap{position:relative;display:inline-flex;align-items:center;justify-content:center;flex:0 0 30px;width:30px;height:30px;margin-left:auto;padding:0;border:0;border-radius:7px;background:transparent;color:#b5bdcb;cursor:pointer}.copy-sap:hover,.copy-sap:focus-visible{background:#ffffff14;color:#fff}.copy-sap:focus-visible{outline:2px solid #ffbd18;outline-offset:2px}.copy-sap:after{content:attr(data-tooltip);position:absolute;right:0;bottom:calc(100% + 7px);padding:7px 11px;border-radius:20px;background:#101113;color:#fff;font:12px/1.25 system-ui,sans-serif;white-space:nowrap;pointer-events:none;opacity:0;visibility:hidden;z-index:5;box-shadow:0 2px 8px #0004}.copy-sap:hover:after,.copy-sap:focus-visible:after{opacity:1;visibility:visible}`;
  const copyScript=`document.querySelector('main').addEventListener('click',async event=>{const button=event.target.closest('[data-sap]');if(!button)return;try{try{if(!navigator.clipboard?.writeText)throw new Error();await navigator.clipboard.writeText(button.dataset.sap);}catch{const input=document.createElement('textarea');input.value=button.dataset.sap;input.style.cssText='position:fixed;opacity:0;top:0;left:0;pointer-events:none';document.body.append(input);let copied;try{input.select();copied=document.execCommand('copy');}finally{input.remove();button.focus({preventScroll:true});}if(!copied)throw new Error();}button.dataset.tooltip='SAP copiado';button.setAttribute('aria-label','SAP copiado');}catch{button.dataset.tooltip='No se pudo copiar';button.setAttribute('aria-label','No se pudo copiar SAP');}setTimeout(()=>{button.dataset.tooltip='Copiar SAP';button.setAttribute('aria-label','Copiar SAP');},2000);});`;
  const cards=mappings.filter(p=>p.files.length).map(p=>`<article data-search="${esc([p.item,p.reference,p.sap,p.description].join(' ').toLowerCase())}"><div class="photos">${p.files.map(file=>`<a href="${esc(file)}" target="_blank" rel="noopener"><img src="${esc(file)}" alt="Pieza ${esc(p.item)}" loading="lazy" decoding="async"></a>`).join('')}</div><h2>Ítem ${esc(p.item)}</h2><p>${esc(p.description)}</p><dl><dt>Referencia</dt><dd>${esc(p.reference||'—')}</dd><dt>SAP</dt><dd class="sap-line"><span>${esc(p.sap||'—')}</span>${copyButton(p)}</dd></dl></article>`).join('');
  const html=`<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Imágenes extraídas · Matrix T600X SF</title><link rel="icon" href="../../IMG/favicon.ico"><style>*{box-sizing:border-box}body{margin:0;padding:24px;background:#101116;color:#f4f4f5;font:15px system-ui,sans-serif}header{max-width:1500px;margin:auto auto 24px}h1{font-size:26px;margin:0 0 12px}header p{color:#b5bdcb}a{color:#ffbd18}input{width:min(100%,620px);padding:13px;border:1px solid #515461;border-radius:9px;background:#1d2028;color:white;font:inherit}main{max-width:1500px;margin:auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,240px),1fr));gap:16px}article{min-width:0;background:#20232c;border:1px solid #343843;border-radius:14px;padding:14px}article[hidden]{display:none}.photos{display:flex;gap:8px;overflow:auto}.photos a{min-width:100%;display:block;background:white;border-radius:9px}.photos img{display:block;width:100%;height:180px;object-fit:contain}h2{font-size:18px;margin:14px 0 8px}article p,dd{overflow-wrap:anywhere}article p{font-size:13px;color:#c6ccd6;min-height:35px}dl{display:grid;grid-template-columns:80px minmax(0,1fr);gap:6px;font-size:12px}dt{color:#aab4c6}dd{margin:0;font-weight:700}@media(max-width:500px){body{padding:14px}}${copyStyle}</style><header><h1>Matrix T600X SF · Imágenes de repuestos</h1><p>${manifest.partsWithImages} referencias con foto de ${manifest.partsTotal} revisadas · ${manifest.uniqueImages} archivos únicos · ${queries.done}/${queries.total} códigos consultados.</p><p>Fotografías extraídas del portal oficial por coincidencia exacta de referencia o SAP. Originales conservados; optimización PNG sin pérdida. Toca una foto para ampliarla.</p><p><a href="referencias.csv">Descargar listado CSV</a> · <a href="manifest.json">Ver índice y fuentes</a></p><input id="search" type="search" placeholder="Buscar ítem, referencia, SAP o descripción" aria-label="Buscar repuesto"><p id="count" aria-live="polite"></p></header><main>${cards}</main><script>const cards=[...document.querySelectorAll('article')];document.getElementById('search').addEventListener('input',event=>{const terms=event.target.value.toLowerCase().trim().split(/\\s+/).filter(Boolean);let count=0;for(const card of cards){card.hidden=!terms.every(term=>card.dataset.search.includes(term));if(!card.hidden)count++;}document.getElementById('count').textContent=count+' referencias';});${copyScript}</script></html>`;
  fs.writeFileSync(path.join(folder,'galeria.html'),html);
  console.log(JSON.stringify({queries:queries.done,total:queries.total,partsWithImages:manifest.partsWithImages,uniqueImages:manifest.uniqueImages,bytes:manifest.bytes,errors:errors.length,blocked}));
})().catch(error=>{console.error(error);process.exitCode=1;});
