const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'../catalogo'),window={catalogModelData:{}};
const load=file=>vm.runInNewContext(fs.readFileSync(path.join(root,file),'utf8'),{window});
load('catalogo-assets/manuales/datos.js');
const models=[['t600x-sf','matrix','catalogo-assets/mtm3839-datos.js','matrixT600xCatalog'],['e-es-f','matrix','catalogo-assets/eliptica-e-es-f/datos.js','ellipticalCatalog'],['hs-abc','hammer-strength','catalogo-assets/hs-abc/datos.js','hammerAbdominalCatalog'],['rt-g2','movement','catalogo-assets/movement-rt-g2/datos.js','movementRtG2Catalog'],...window.catalogManuals.map(m=>[m.id,m.brand,`catalogo-assets/manuales/${m.id}/datos.js`])];
const brands=new Map();
for(const [id,brand,file,property] of models){
  load(file);const data=property?window[property]:window.catalogModelData[id],parts=new Map();
  for(const view of data.views)for(const part of [...(view.id==='general'?data.bom||[]:[]),...view.bom||[],...Object.values(view.parts||(view.id==='general'?data.parts||{}:{}))]){
    if(part.viewIds || !(part.item||part.reference||part.sap))continue;
    const item=String(part.item||'').trim().toUpperCase();
    const key=part._catalogIdentityKey || (property ? (['hs-abc','rt-g2'].includes(id)?`${view.id}:${item}`:item) : `${view.id}:${item}:${part.reference||''}`);
    const row=[view.id,item,part.reference||'',part.sap||'',key];parts.set(JSON.stringify(row),row);
  }
  if(!brands.has(brand))brands.set(brand,{});brands.get(brand)[id]=[...parts.values()];
}
const dir=path.join(root,'catalogo-assets/busqueda');fs.mkdirSync(dir,{recursive:true});
for(const [brand,data]of brands){
  const text=`window.catalogEquipmentSearchData ||= Object.create(null);\nwindow.catalogEquipmentSearchData[${JSON.stringify(brand)}]=${JSON.stringify(data)};\n`;
  fs.writeFileSync(path.join(dir,brand+'.js'),text);console.log(brand,Object.keys(data).length,'equipos',Buffer.byteLength(text),'bytes');
}
