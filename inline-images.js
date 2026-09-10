(()=>{
  const repo='Bennychow1979/e2-auto-web';
  const names=['myvi-real.jpg','crv-real.jpg'];
  const cache=new Map();

  async function objectUrl(name){
    if(cache.has(name)) return cache.get(name);
    const api=`https://api.github.com/repos/${repo}/contents/assets/${encodeURIComponent(name)}?ref=main`;
    const res=await fetch(api,{headers:{Accept:'application/vnd.github+json'}});
    if(!res.ok) throw new Error(`image fetch failed: ${res.status}`);
    const data=await res.json();
    const b64=(data.content||'').replace(/\s/g,'');
    const raw=atob(b64);
    const bytes=new Uint8Array(raw.length);
    for(let i=0;i<raw.length;i++) bytes[i]=raw.charCodeAt(i);
    const url=URL.createObjectURL(new Blob([bytes],{type:'image/jpeg'}));
    cache.set(name,url);
    return url;
  }

  function fileFor(img){
    const src=(img.getAttribute('src')||'').toLowerCase();
    return names.find(name=>src.includes(name))||null;
  }

  async function repair(img){
    const name=fileFor(img);
    if(!name||img.dataset.e2Repair==='done') return;
    img.dataset.e2Repair='done';
    try{ img.src=await objectUrl(name); }
    catch(err){ console.error('E2 image repair failed',name,err); }
  }

  function apply(){
    document.querySelectorAll('img').forEach(img=>{
      if(fileFor(img)){
        img.addEventListener('error',()=>repair(img),{once:true});
        repair(img);
      }
    });
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',apply,{once:true});
  else apply();
})();