const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export const revision=value=>typeof value==='string'&&/^[1-9]\d{0,17}$/.test(value);
export async function publicationMatches(job,manifest,stock,sitemap){
 if(!manifest?.releaseArtifact||manifest.inventoryRefresh?.dispatch!==job.dispatch||manifest.inventoryRefresh?.revision!==job.revision
  ||!Number.isFinite(Date.parse(manifest.fetchedAt))||Date.parse(manifest.fetchedAt)<Date.parse(job.started_at)-60000)return false;
 try{
  if(stock.length>18000)return false;
  const values=stock.trim().split('\n').filter(l=>!l.startsWith('#')).map(l=>JSON.parse(l)),header=values.shift(),end=values.pop();
  if(!(header.complete===true&&header.format==='e2-stock-v1'&&header.snapshot_at===manifest.fetchedAt
   &&header.built_at===manifest.builtAt&&header.vehicles===values.length&&end.end===header.format&&end.vehicles===values.length
   &&manifest.files.length===values.length*3&&values.every(row=>Array.isArray(row)&&row.length===8)))return false;
  if(typeof sitemap!=='string')return false;
  const hash=async text=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),b=>b.toString(16).padStart(2,'0')).join('');
  return manifest.publicationHashes?.stock===await hash(stock)&&manifest.publicationHashes?.sitemap===await hash(sitemap);
 }catch{return false;}
}
export function createHandler({store,githubToken,fetchImpl=fetch,now=Date.now}){
 const reply=(status,body)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
 return async req=>{
  if(req.method!=='POST')return reply(405,{error:'Use POST'});
  if(req.headers.get('Origin'))return reply(403,{error:'Database dispatch only'});
  const auth=req.headers.get('Authorization')||'';
  if(!/^Bearer e2refresh_[a-f0-9]{64}$/.test(auth))return reply(401,{error:'Invalid dispatch'});
  try{
   const raw=await req.text();if(raw.length>300)return reply(413,{error:'Request too large'});
   let body;try{body=JSON.parse(raw)}catch{return reply(400,{error:'Invalid request'})}
   if(!uuid.test(body?.dispatch_id||''))return reply(400,{error:'Invalid dispatch'});
   if(!await store.claimDispatch(body.dispatch_id,auth.slice(7)))return reply(403,{error:'Dispatch expired or used'});
   const job=await store.claim();if(!job)return reply(200,{processed:false});
   if(!uuid.test(job.dispatch)||!uuid.test(job.lease)||!revision(job.revision)||!['dispatch','check'].includes(job.action))throw Error('Invalid job');
   let outcome,retrySeconds=0;
   if(job.action==='check'){
    outcome='waiting';
    try{
     const query='?refresh='+job.dispatch+'&t='+Math.floor(now()/60000);
     const options={credentials:'omit',cache:'no-store',redirect:'error',headers:{'Cache-Control':'no-cache'},signal:AbortSignal.timeout(15000)};
     const [m,s,x]=await Promise.all(['vehicle-pages-manifest.json','stock.txt','sitemap.xml'].map(path=>fetchImpl('https://e2auto.my/'+path+query,options)));
     if(m.ok&&s.ok&&x.ok&&await publicationMatches(job,await m.json(),await s.text(),await x.text()))outcome='deployed';
    }catch{/* Keep the attempt outstanding; a stale CDN response is not success. */}
    if(outcome==='waiting'){
     try{
      // Public workflow metadata only. A completed run is not a publication receipt;
      // only a known failed attempt shortens the retry wait.
      const r=await fetchImpl('https://api.github.com/repos/Bennychow1979/e2-auto-web/actions/workflows/deploy-pages.yml/runs?event=workflow_dispatch&branch=main&per_page=30',
       {redirect:'error',cache:'no-store',signal:AbortSignal.timeout(10000),headers:{Accept:'application/vnd.github+json','User-Agent':'E2-Auto-Inventory-Refresh',...(githubToken?{Authorization:'Bearer '+githubToken}:{})}});
      if(r.ok){const data=await r.json();const run=data.workflow_runs?.find(r=>r.display_title==='Inventory refresh '+job.revision+' '+job.dispatch);
       if(run?.status==='completed'&&['failure','cancelled','timed_out','action_required','startup_failure'].includes(run.conclusion))outcome='build_failed';}
     }catch{/* Missing/ambiguous run metadata is handled by the persistent timeout. */}
    }
   }else if(!githubToken){outcome='unconfigured';}
   else{
    try{
     const response=await fetchImpl('https://api.github.com/repos/Bennychow1979/e2-auto-web/actions/workflows/deploy-pages.yml/dispatches',{
      method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers:{'Accept':'application/vnd.github+json','Content-Type':'application/json',
       'Authorization':'Bearer '+githubToken,'X-GitHub-Api-Version':'2022-11-28','User-Agent':'E2-Auto-Inventory-Refresh'},
      body:JSON.stringify({ref:'main',inputs:{inventory_revision:job.revision,inventory_dispatch:job.dispatch}})
     });
     outcome=response.ok?'dispatched':response.status>=400&&response.status<500?'rejected':'uncertain';
     if(outcome==='rejected')retrySeconds=Math.min(86400,Math.max(0,Math.ceil(Number(response.headers.get('Retry-After'))||0),
      response.headers.get('X-RateLimit-Remaining')==='0'?Math.ceil((Number(response.headers.get('X-RateLimit-Reset'))*1000-now())/1000)||0:0));
    }catch{outcome='uncertain';}
   }
   if(!await store.finish(job,outcome,retrySeconds))throw Error('Lease changed');
   return reply(200,{processed:true,outcome});
  }catch{return reply(500,{error:'Inventory refresh worker could not finish'});}
 };
}
