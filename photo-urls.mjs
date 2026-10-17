// Preserve the album order and let uploaded images work during a Drive outage.
export async function resolvePhotoURLs(photos,{uploaded,drive}) {
  if(!photos.length)return [];
  const local=photos.filter(p=>p.source!=='drive'),linked=photos.filter(p=>p.source==='drive');
  const urls=new Map();
  const jobs=[];
  if(local.length)jobs.push(uploaded(local).then(items=>items.forEach((item,i)=>urls.set(local[i].id,item.signedUrl||null))));
  if(linked.length)jobs.push((async()=>{
    for(let start=0;start<linked.length;start+=100) {
      try {
        const items=await drive(linked.slice(start,start+100).map(p=>p.id));
        for(const item of items)urls.set(item.id,item.url||null);
      }catch{/* Show an unavailable tile without breaking the uploaded photos. */}
    }
  })());
  await Promise.all(jobs);
  return photos.map(photo=>({...photo,url:urls.get(photo.id)||null}));
}

// Keep one link per photo for the life of the page, so searches, saves and timed
// stock refreshes reuse it (and the browser's cached copy) instead of issuing a
// new link and downloading the same photo again. A link that fails, usually one
// that expired before its image loaded, is renewed at most once a minute.
export function photoURLCache(resolve,{now=()=>Date.now()}={}) {
  let byKey=new Map(),byURL=new Map();
  const key=p=>(p.source||'upload')+'|'+p.id+'|'+(p.path||'');
  async function urls(photos) {
    const missing=[...new Map(photos.filter(p=>!byKey.has(key(p))).map(p=>[key(p),p])).values()];
    if(missing.length) {
      const batch=resolve(missing),cache=byKey;
      for(const p of missing)cache.set(key(p),{photo:p,pending:batch});
      const resolved=await batch.catch(()=>[]);
      for(const p of resolved) {
        const entry=cache.get(key(p));if(!entry||entry.pending!==batch)continue;
        if(p.url){entry.url=p.url;entry.renewed=0;delete entry.pending;byURL.set(p.url,key(p))}else cache.delete(key(p));
      }
      for(const p of missing)if(cache.get(key(p))?.pending===batch)cache.delete(key(p));
    }
    await Promise.all(photos.map(p=>byKey.get(key(p))?.pending).filter(Boolean).map(batch=>batch.catch(()=>{})));
    return photos.map(p=>({...p,url:byKey.get(key(p))?.url||null}));
  }
  // The newest link for a photo, given any link it was issued.
  const current=url=>byKey.get(byURL.get(url))?.url||url;
  async function renew(url) {
    const entry=byKey.get(byURL.get(url));
    if(!entry?.url)return null;
    if(entry.url!==url)return entry.url;
    if(entry.renewing)return entry.renewing;
    if(now()-entry.renewed<60000)return null;
    entry.renewed=now();
    entry.renewing=resolve([entry.photo]).then(([fresh])=>{
      if(!fresh?.url||byKey.get(key(entry.photo))!==entry)return null;
      entry.url=fresh.url;byURL.set(fresh.url,key(entry.photo));return fresh.url;
    }).catch(()=>null).finally(()=>{delete entry.renewing});
    return entry.renewing;
  }
  // Signing out forgets links issued for the previous account.
  const clear=()=>{byKey=new Map();byURL=new Map()};
  return {urls,current,renew,clear};
}
