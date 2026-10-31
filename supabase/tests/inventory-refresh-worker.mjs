import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {createHandler,publicationMatches} from '../functions/e2-inventory-refresh/handler.mjs';
import {inventoryReceipt} from '../../scripts/inventory-refresh-receipt.mjs';
import {sameProjection,verifyInventoryCurrent} from '../../scripts/verify-inventory-current.mjs';
import {verifyLivePublication} from '../../scripts/verify-live-publication.mjs';
import {vehicleA} from '../../tests/fixtures/vehicle-pages.mjs';
const id='aaaaaaaa-1111-4111-8111-111111111111',token='e2refresh_'+'a'.repeat(64);
const job={action:'dispatch',lease:id,dispatch:id,revision:'12',started_at:new Date().toISOString()};
const request=()=>new Request('https://worker.test/',{method:'POST',headers:{Authorization:'Bearer '+token},body:JSON.stringify({dispatch_id:id})});
const manifest={inventoryRefresh:{revision:'12',dispatch:id},releaseArtifact:true,fetchedAt:job.started_at,builtAt:job.started_at,files:[]};
const stock=[JSON.stringify({format:'e2-stock-v1',complete:true,snapshot_at:job.started_at,built_at:job.started_at,vehicles:0}),JSON.stringify({end:'e2-stock-v1',vehicles:0})].join('\n');
const sitemap='<urlset></urlset>';
manifest.publicationHashes=Object.fromEntries(Object.entries({stock,sitemap}).map(([key,text])=>[key,createHash('sha256').update(text).digest('hex')]));
function harness({fetchImpl,claim=job,configured=true,finish=true,accepted=true}={}){
 const calls=[];const handler=createHandler({githubToken:configured?'synthetic-test-value':undefined,fetchImpl,store:{claimDispatch:async()=>accepted,claim:async()=>claim,finish:async(j,outcome,retrySeconds)=>{calls.push({j,outcome,retrySeconds});return finish;}}});
 return {handler,calls};
}
test('dispatches only the fixed main workflow with an opaque revision and no vehicle data',async()=>{
 const h=harness({fetchImpl:async(url,options)=>{
  assert.equal(url,'https://api.github.com/repos/Bennychow1979/e2-auto-web/actions/workflows/deploy-pages.yml/dispatches');
  assert.equal(options.redirect,'error');assert.deepEqual(JSON.parse(options.body),{ref:'main',inputs:{inventory_revision:'12',inventory_dispatch:id}});
  return new Response(null,{status:204});
 }});assert.equal((await h.handler(request())).status,200);assert.equal(h.calls[0].outcome,'dispatched');
});
test('GitHub rejection, ambiguous failure and missing configuration remain distinct',async()=>{
 for(const [status,expected] of [[200,'dispatched'],[401,'rejected'],[429,'rejected'],[503,'uncertain']]){
  const h=harness({fetchImpl:async()=>new Response(null,{status})});await h.handler(request());assert.equal(h.calls[0].outcome,expected);
 }
 const h=harness({fetchImpl:async()=>{throw Error('network')}});await h.handler(request());assert.equal(h.calls[0].outcome,'uncertain');
 const missing=harness({configured:false,fetchImpl:()=>assert.fail('must not send')});await missing.handler(request());assert.equal(missing.calls[0].outcome,'unconfigured');
 const limited=harness({fetchImpl:async()=>new Response(null,{status:429,headers:{'Retry-After':'600'}})});await limited.handler(request());assert.equal(limited.calls[0].retrySeconds,600);
});
test('database failure after send never resends and does not expose provider/credential data',async()=>{
 let sends=0;const h=harness({finish:false,fetchImpl:async()=>{sends++;return new Response(null,{status:204});}});
 const response=await h.handler(request());assert.equal(response.status,500);assert.equal(sends,1);assert(!((await response.text()).includes('synthetic-test-value')));
});
test('replayed capabilities and browser origins cannot request builds',async()=>{
 const h=harness({accepted:false,fetchImpl:()=>assert.fail('must not send')});assert.equal((await h.handler(request())).status,403);
 const browser=request();browser.headers.set('Origin','https://e2auto.my');assert.equal((await h.handler(browser)).status,403);
 assert.equal((await h.handler(new Request('https://worker.test/'))).status,405);
});
test('publication receipt must match dispatch, complete snapshot time, footer and both hashes, including zero inventory',async()=>{
 assert(await publicationMatches(job,manifest,stock,sitemap));
 for(const altered of [{...manifest,inventoryRefresh:{revision:'11',dispatch:id}},{...manifest,inventoryRefresh:{revision:'12',dispatch:'bbbbbbbb-1111-4111-8111-111111111111'}},{...manifest,releaseArtifact:false},{...manifest,fetchedAt:'2020-01-01'}])assert(!await publicationMatches(job,altered,stock,sitemap));
 assert(!await publicationMatches(job,manifest,stock.split('\n')[0],sitemap));assert(!await publicationMatches(job,manifest,stock.replace('"complete":true','"complete":false'),sitemap));
 assert(!await publicationMatches(job,manifest,stock,'stale sitemap'));assert(!await publicationMatches(job,manifest,stock+'\n',sitemap));
});
test('stale CDN data stays pending; matching live receipt acknowledges deployment without another GitHub send',async()=>{
 for(const [value,outcome] of [[manifest,'deployed'],[{...manifest,inventoryRefresh:undefined},'waiting']]){
  const h=harness({claim:{...job,action:'check'},fetchImpl:async(url,options)=>{
   assert(url.startsWith('https://e2auto.my/'));assert(url.includes('?refresh='+id));assert.equal(options.cache,'no-store');
   return new Response(url.includes('stock.txt')?stock:url.includes('sitemap.xml')?sitemap:JSON.stringify(value));
  }});await h.handler(request());assert.equal(h.calls[0].outcome,outcome);
 }
});
test('receipt inputs reject incomplete or executable strings',()=>{
 assert.equal(inventoryReceipt(),undefined);assert.deepEqual(inventoryReceipt('12',id),manifest.inventoryRefresh);
 for(const [r,d] of [['12',''],['','x'],['$(echo test)',id],['0',id],['12','../other']])assert.throws(()=>inventoryReceipt(r,d));
});
test('a known failed matching run retries; unrelated failures and accepted runs cannot acknowledge publication',async()=>{
 for(const [title,conclusion,outcome] of [['Inventory refresh 12 '+id,'failure','build_failed'],['Other run','failure','waiting'],['Inventory refresh 12 '+id,'success','waiting']]){
  const h=harness({claim:{...job,action:'check'},fetchImpl:async url=>url.startsWith('https://api.github.com/')?
   new Response(JSON.stringify({workflow_runs:[{display_title:title,status:'completed',conclusion}]})):new Response('old')});
  await h.handler(request());assert.equal(h.calls[0].outcome,outcome);
 }
});
test('predeploy comparison rejects publication, price, status, deletion and photo changes',async()=>{
 const snapshot={fetchedAt:new Date().toISOString(),vehicles:[vehicleA],publicPhotos:[{vehicleId:vehicleA.id,photoId:null,source:null}]};
 assert(sameProjection(snapshot,{...snapshot,fetchedAt:new Date().toISOString()}));
 for(const vehicles of [[],[{...vehicleA,publication:'draft'}],[{...vehicleA,price:1}],[{...vehicleA,stock_status:'Sold'}]])assert(!sameProjection(snapshot,{...snapshot,vehicles}));
 assert(!sameProjection(snapshot,{...snapshot,publicPhotos:[{...snapshot.publicPhotos[0],photoId:id}]}));
 const config={supabaseUrl:'https://synthetic.supabase.co',publishableKey:'sb_publishable_synthetic'};
 await assert.rejects(verifyInventoryCurrent(snapshot,config,async()=>new Response('[]',{headers:{'content-range':'*/0'}})),/changed during build/);
});
test('postdeploy check requires exact manifest, stock and sitemap and retries stale caches',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'e2-publication-'));
 const contents={'vehicle-pages-manifest.json':JSON.stringify({builtAt:job.started_at}),'stock.txt':stock,'sitemap.xml':'<urlset/>'};
 await Promise.all(Object.entries(contents).map(([path,text])=>writeFile(join(dir,path),text)));
 let calls=0;const request=async url=>{calls++;return new Response(calls<=3?'old':contents[new URL(url).pathname.slice(1)]);};
 assert((await verifyLivePublication(dir,{request,attempts:2,sleep:async()=>{}})).published);assert.equal(calls,6);
 await assert.rejects(verifyLivePublication(dir,{request:async()=>new Response('old'),attempts:1}),/does not match/);
});
