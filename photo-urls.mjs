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
// that expired before its image loaded, is renewed: at most three automatic tries
// (at once, after 5 s, after 30 s), more only when forced (back online, or a
// manual refresh). A photo that loads again resets its tries.
const RETRY_DELAYS=[0,5000,30000];
// A link request still unanswered after this long is not waited on by later calls,
// so a retry after a page timeout starts a fresh request instead of joining a stuck one.
const STUCK_MS=8000;
export function photoURLCache(resolve,{now=()=>Date.now()}={}) {
  let byKey=new Map(),byURL=new Map();
  const key=p=>(p.source||'upload')+'|'+p.id+'|'+(p.path||'');
  async function urls(photos) {
    const usable=p=>{const entry=byKey.get(key(p));return entry&&!(entry.pending&&now()-entry.since>=STUCK_MS)};
    const missing=[...new Map(photos.filter(p=>!usable(p)).map(p=>[key(p),p])).values()];
    if(missing.length) {
      const batch=resolve(missing),cache=byKey;
      for(const p of missing)cache.set(key(p),{photo:p,pending:batch,since:now()});
      const resolved=await batch.catch(()=>[]);
      for(const p of resolved) {
        const entry=cache.get(key(p));if(!entry||entry.pending!==batch)continue;
        if(p.url){Object.assign(entry,{url:p.url,tries:0,triedAt:0});delete entry.pending;byURL.set(p.url,key(p))}else cache.delete(key(p));
      }
      for(const p of missing)if(cache.get(key(p))?.pending===batch)cache.delete(key(p));
    }
    await Promise.all(photos.map(p=>byKey.get(key(p))?.pending).filter(Boolean).map(batch=>batch.catch(()=>{})));
    return photos.map(p=>({...p,url:byKey.get(key(p))?.url||null}));
  }
  const entryFor=url=>byKey.get(byURL.get(url));
  // The newest link for a photo, given any link it was issued.
  const current=url=>entryFor(url)?.url||url;
  const known=url=>!!entryFor(url)?.url;
  // Milliseconds until the next automatic try for this photo, or null when none is left.
  function retryIn(url) {
    const entry=entryFor(url);
    if(!entry?.url||entry.tries>=RETRY_DELAYS.length)return null;
    return Math.max(0,entry.triedAt+RETRY_DELAYS[entry.tries]-now());
  }
  function loaded(url){const entry=entryFor(url);if(entry?.url===url)entry.tries=0}
  async function renew(url,{force=false}={}) {
    const entry=entryFor(url);
    if(!entry?.url)return null;
    if(entry.url!==url)return entry.url;
    if(entry.renewing)return entry.renewing;
    if(force)entry.tries=0;
    else if(retryIn(url)!==0)return null;
    entry.tries++;entry.triedAt=now();
    entry.renewing=resolve([entry.photo]).then(([fresh])=>{
      if(!fresh?.url||byKey.get(key(entry.photo))!==entry)return null;
      entry.url=fresh.url;byURL.set(fresh.url,key(entry.photo));return fresh.url;
    }).catch(()=>null).finally(()=>{delete entry.renewing});
    return entry.renewing;
  }
  // Signing out forgets links issued for the previous account.
  const clear=()=>{byKey=new Map();byURL=new Map()};
  return {urls,current,known,retryIn,loaded,renew,clear};
}

// Swap a failed photo for a renewed link wherever it is shown; keep failed photos
// in a list so they are retried on schedule, when the connection returns, or when
// the visitor asks for a refresh, instead of staying broken.
export function watchPhotoErrors(links,{doc=document,win=window,wait=setTimeout}={}) {
  const broken=new Set();
  async function recover(img,force=false) {
    const failed=img.getAttribute('src');
    if(!failed||!links.known(failed))return false;
    const fresh=await links.renew(failed,{force});
    if(fresh) {
      broken.delete(img);
      for(const node of doc.querySelectorAll('img'))if(node.getAttribute('src')===failed)node.src=fresh;
      return true;
    }
    broken.add(img);
    const delay=links.retryIn(failed);
    if(delay!==null)wait(()=>{if(broken.has(img)&&img.isConnected&&img.getAttribute('src')===failed)recover(img)},delay+50);
    return false;
  }
  async function retryAll() {
    const images=[...broken].filter(img=>img.isConnected);broken.clear();
    return (await Promise.all(images.map(img=>recover(img,true)))).some(Boolean);
  }
  doc.addEventListener('error',event=>{if(event.target instanceof win.HTMLImageElement)recover(event.target)},true);
  doc.addEventListener('load',event=>{if(event.target instanceof win.HTMLImageElement){broken.delete(event.target);links.loaded(event.target.getAttribute('src'))}},true);
  win.addEventListener('online',retryAll);
  return {recover,retryAll};
}
