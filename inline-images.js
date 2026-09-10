(()=>{
  const repo='Bennychow1979/e2-auto-web';
  const names=['myvi-real.jpg','crv-real.jpg'];
  const version='55530627';
  const cache=new Map();

  function fileFor(img){
    const src=(img.getAttribute('src')||'').toLowerCase();
    return names.find(name=>src.includes(name))||null;
  }

  function rawUrl(name){
    return `https://raw.githubusercontent.com/${repo}/main/assets/${encodeURIComponent(name)}?v=${version}`;
  }

  async function apiObjectUrl(name){
    if(cache.has(name)) return cache.get(name);
    const api=`https://api.github.com/repos/${repo}/contents/assets/${encodeURIComponent(name)}?ref=main&v=${version}`;
    const res=await fetch(api,{cache:'no-store',headers:{Accept:'application/vnd.github+json'}});
    if(!res.ok) throw new Error(`GitHub API image fetch failed: ${res.status}`);
    const data=await res.json();
    const b64=(data.content||'').replace(/\s/g,'');
    if(!b64) throw new Error('GitHub API returned empty image content');
    const raw=atob(b64);
    const bytes=new Uint8Array(raw.length);
    for(let i=0;i<raw.length;i++) bytes[i]=raw.charCodeAt(i);
    const url=URL.createObjectURL(new Blob([bytes],{type:'image/jpeg'}));
    cache.set(name,url);
    return url;
  }

  function repair(img,name){
    if(img.dataset.e2ImageReady==='1') return;
    img.dataset.e2ImageReady='1';
    img.onerror=async()=>{
      img.onerror=null;
      try{ img.src=await apiObjectUrl(name); }
      catch(err){ console.error('E2 image fallback failed',name,err); }
    };
    img.src=rawUrl(name);
  }

  function apply(){
    document.querySelectorAll('img').forEach(img=>{
      const name=fileFor(img);
      if(name) repair(img,name);
    });
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',apply,{once:true});
  else apply();
})();