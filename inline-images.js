(()=>{
  const repo='Bennychow1979/e2-auto-web';
  const version='5c2e624c';
  const names=['myvi-real.jpg','crv-real.jpg'];
  const cache=new Map();
  let myviPromise=null;

  function fileFor(img){
    const src=(img.getAttribute('src')||'').toLowerCase();
    return names.find(name=>src.includes(name))||null;
  }

  function bytesToObjectUrl(b64,type){
    const raw=atob(b64.replace(/\s/g,''));
    const bytes=new Uint8Array(raw.length);
    for(let i=0;i<raw.length;i++) bytes[i]=raw.charCodeAt(i);
    return URL.createObjectURL(new Blob([bytes],{type}));
  }

  async function chunkedMyviUrl(){
    if(myviPromise) return myviPromise;
    myviPromise=(async()=>{
      const urls=Array.from({length:6},(_,i)=>`assets/myvi-b64/${i}.txt?v=${version}`);
      const parts=await Promise.all(urls.map(async url=>{
        const res=await fetch(url,{cache:'no-store'});
        if(!res.ok) throw new Error(`Myvi chunk failed: ${res.status}`);
        return (await res.text()).trim();
      }));
      const b64=parts.join('');
      if(!b64.startsWith('UklGR')) throw new Error('Myvi payload is not WebP');
      return bytesToObjectUrl(b64,'image/webp');
    })();
    return myviPromise;
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
    const url=bytesToObjectUrl(b64,'image/jpeg');
    cache.set(name,url);
    return url;
  }

  async function repairMyvi(img){
    if(img.dataset.e2ImageReady==='1') return;
    img.dataset.e2ImageReady='1';
    const previousVisibility=img.style.visibility;
    img.style.visibility='hidden';
    try{
      const url=await chunkedMyviUrl();
      img.onload=()=>{img.style.visibility=previousVisibility||'visible';};
      img.onerror=()=>{img.style.visibility=previousVisibility||'visible';};
      img.src=url;
      if(img.complete&&img.naturalWidth>0) img.style.visibility=previousVisibility||'visible';
    }catch(err){
      console.error('E2 chunked Myvi image failed',err);
      img.style.visibility=previousVisibility||'visible';
    }
  }

  function repairCrv(img){
    if(img.dataset.e2ImageReady==='1') return;
    img.dataset.e2ImageReady='1';
    img.onerror=async()=>{
      img.onerror=null;
      try{img.src=await apiObjectUrl('crv-real.jpg');}
      catch(err){console.error('E2 CR-V image fallback failed',err);}
    };
    img.src=rawUrl('crv-real.jpg');
  }

  function apply(){
    document.querySelectorAll('img').forEach(img=>{
      const name=fileFor(img);
      if(name==='myvi-real.jpg') repairMyvi(img);
      if(name==='crv-real.jpg') repairCrv(img);
    });
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',apply,{once:true});
  else apply();
})();