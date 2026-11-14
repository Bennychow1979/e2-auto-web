const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export const revision=value=>typeof value==='string'&&/^[1-9]\d{0,17}$/.test(value);
function validFeed(text,manifest,statuses,expected){
 if(typeof text!=='string'||text.length>40000)return null;
 const values=text.trim().split('\n').filter(l=>!l.startsWith('#')).map(JSON.parse),header=values.shift(),end=values.pop(),columns=['year','make','model','variant','plate','status','price_myr','url'];
 if(header?.format!=='e2-stock-v1'||header.max_chars!==40000||header.complete!==true||header.snapshot_at!==manifest.fetchedAt||header.built_at!==manifest.builtAt||header.vehicles!==expected||values.length!==expected||end?.end!==header.format||end.vehicles!==expected||JSON.stringify(header.columns)!==JSON.stringify(columns))return null;
 const counts={Available:0,Reserved:0,Sold:0},urls=new Set();
 for(const row of values){if(!Array.isArray(row)||row.length!==8||!statuses.includes(row[5])||typeof row[7]!=='string'||!row[7].startsWith('https://e2auto.my/cars/')||urls.has(row[7]))return null;urls.add(row[7]);counts[row[5]]++;}
 if(!header.counts||Object.keys(counts).some(k=>header.counts[k]!==counts[k]))return null;
 return urls;
}
export async function publicationMatches(job,manifest,stock,sitemap,soldStock){
 if(!manifest?.releaseArtifact||manifest.inventoryRefresh?.dispatch!==job.dispatch||manifest.inventoryRefresh?.revision!==job.revision
  ||!Number.isFinite(Date.parse(manifest.fetchedAt))||Date.parse(manifest.fetchedAt)<Date.parse(job.started_at)-60000)return false;
 try{
  if(manifest.stockFeeds){
   const c=manifest.stockFeeds;
   if(c.version!==1||c.maxCharacters!==40000||c.retentionDays!==90||!['published','active','soldRecent','soldExpired'].every(k=>Number.isSafeInteger(c[k])&&c[k]>=0)||c.published!==c.active+c.soldRecent+c.soldExpired||manifest.files.length!==c.published*3||c.soldCutoff!==new Date(Date.parse(manifest.fetchedAt)-90*86400000).toISOString())return false;
   const active=validFeed(stock,manifest,['Available','Reserved'],c.active),sold=validFeed(soldStock,manifest,['Sold'],c.soldRecent);
   if(!active||!sold||[...sold].some(url=>active.has(url))||typeof sitemap!=='string')return false;
   const hash=async text=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),b=>b.toString(16).padStart(2,'0')).join('');
   return manifest.publicationHashes?.stock===await hash(stock)&&manifest.publicationHashes?.stockSold===await hash(soldStock)&&manifest.publicationHashes?.sitemap===await hash(sitemap);
  }
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
     if(m.ok&&s.ok&&x.ok){
      const manifest=await m.json(),sold=manifest.stockFeeds?await fetchImpl('https://e2auto.my/stock-sold.txt'+query,options):null;
      if((!manifest.stockFeeds||sold?.ok)&&await publicationMatches(job,manifest,await s.text(),await x.text(),sold?await sold.text():undefined))outcome='deployed';
     }
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
