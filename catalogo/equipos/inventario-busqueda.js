window.createCatalogEquipmentSearch = () => {
  const files=new Map(), snapshots=new Map();
  const normalize=value=>String(value??'').normalize('NFD').replace(/\p{M}/gu,'').toLowerCase();
  async function prepare(brand,onReady){
    if(!files.has(brand)){
      // Los scripts locales funcionan también bajo file://; fetch(JSON) está bloqueado.
      const task=new Promise((resolve,reject)=>{
        if(!/^[a-z0-9-]+$/.test(brand)){reject(Error('Marca inválida.'));return;}
        const saved=window.catalogEquipmentSearchData?.[brand];
        if(saved){resolve(saved);return;}
        const script=document.createElement('script');
        script.async=true;
        script.src=`catalogo-assets/busqueda/${brand}.js?v=20261127-archivo1`;
        script.onload=()=>{
          script.remove();
          const data=window.catalogEquipmentSearchData?.[brand];
          if(data&&typeof data==='object'&&Object.values(data).every(Array.isArray))resolve(data);
          else reject(Error('El índice de repuestos está incompleto.'));
        };
        script.onerror=()=>{script.remove();reject(Error('No se pudo cargar el índice de repuestos.'));};
        document.head.append(script);
      }).catch(error=>{files.delete(brand);throw error;});
      files.set(brand,task);
    }
    // Un error del servidor no debe ocultar referencias disponibles en el índice.
    const remote=Promise.resolve().then(()=>window.CatalogSync.active?window.CatalogSync.readBrandNames(brand):[])
      .then(rows=>({rows}),error=>({error}));
    const data=await files.get(brand);
    build(brand,data,snapshots.get(brand)?.rows || []);
    onReady?.();
    const result=await remote;
    if(result.error)return {partial:true,error:result.error.message};
    build(brand,data,result.rows);
    return {partial:false};
  }
  function build(brand,data,rows){
    const previous=snapshots.get(brand);
    if(previous?.rows===rows)return;
    const models=new Map(),names=window.catalogNameIndex(brand,rows);
    for(const [id,tuples]of Object.entries(data)){
      const prefix=id==='t600x-sf'?'':`modelo:${id}:`;
      const scoped=rows.filter(row=>prefix?row.clave.startsWith(prefix):!row.clave.startsWith('modelo:')&&!row.clave.startsWith('pieza:'));
      const localNames=Object.fromEntries(scoped.filter(row=>row.tipo==='nombre').map(row=>[prefix?row.clave.slice(prefix.length):row.clave,row.valor]));
      const parts=tuples.map(([view,item,reference,sap,key])=>({view,item,reference,sap,key}));
      for(const row of scoped){
        const record=row.valor;
        if(row.tipo==='referencia'&&record?.part&&record.original){
          for(const part of parts)if(part.view===record.viewId&&['item','reference','sap'].every(field=>String(part[field]||'')===String(record.original[field]||'')))Object.assign(part,record.part);
        }
        if(row.tipo==='marcador'&&record?.part)parts.push({...record.part,key:prefix?row.clave.slice(prefix.length):row.clave});
      }
      models.set(id,parts.map(part=>{
        const technicalName=window.catalogTechnicalName(brand,part,localNames,part.key,names);
        return {technicalName,reference:part.reference||'',sap:part.sap||'',fields:[technicalName,part.reference,part.sap].map(normalize)};
      }));
    }
    snapshots.set(brand,{rows,models});
  }
  function find(model,terms,modelText){
    for(const part of snapshots.get(model.brand)?.models.get(model.id)||[]){
      if(terms.every(term=>modelText.includes(term)||part.fields.some(field=>field.includes(term))))return part;
    }
    return null;
  }
  return {prepare,find,clear(){snapshots.clear();}};
};
