// Real-browser check of photo link reuse and recovery: the real e2-drive-photos handler
// (stubbed database and Drive) and the real photo-urls.mjs in Chromium.
// npm run test:photo-browser            offline, server-down, stuck-renewal and broken-photo cases (~4 min)
// npm run test:photo-browser -- --slow  also waits 5 real minutes for the draft promise
// CHROMIUM_PATH selects the browser binary; otherwise Playwright's own Chromium is used.
import http from 'node:http';import vm from 'node:vm';import {readFileSync} from 'node:fs';import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import * as core from '../supabase/functions/e2-drive-photos/core.mjs';
const root_=new URL('../',import.meta.url).pathname,slow=process.argv.includes('--slow');
const realNow=Date.now;let offset=0;Date.now=()=>realNow()+offset;
const jpeg=Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=','base64');
const actor='00000000-0000-4000-8000-000000000001',vehicle='10000000-0000-4000-8000-000000000001',photo='20000000-0000-4000-8000-000000000001';
const folder='folder_1234567890',file='file_1234567890',root='root_1234567890',checksum='a'.repeat(32);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function load(state){
  const rows={vehicles:[{id:vehicle,plate:'VBH4735',publication:'published'}],staff_memberships:[{user_id:actor,role:'admin',active:true}],
    vehicle_photos:[{id:photo,vehicle_id:vehicle,source:'drive'}],vehicle_drive_photos:[{photo_id:photo,vehicle_id:vehicle,folder_id:folder,file_id:file,checksum,mime_type:'image/jpeg'}]};
  function createClient(_u,key,o={}){const bypass=key==='service',staff=o.global?.headers.Authorization==='Bearer valid-admin';
    return {auth:{getUser:async t=>t==='valid-admin'?{data:{user:{id:actor}},error:null}:{data:{user:null},error:{message:'x'}}},
      from(table){let f=[],single=false;const q={select(){return q},eq(n,v){f.push(r=>r[n]===v);return q},in(n,v){f.push(r=>v.includes(r[n]));return q},maybeSingle(){single=true;return q},
        then(res,rej){let d=rows[table].filter(r=>f.every(x=>x(r)));if(!bypass&&!staff&&table==='vehicle_photos')d=d.filter(r=>rows.vehicles.some(v=>v.id===r.vehicle_id&&v.publication==='published'));return Promise.resolve({data:single?d[0]||null:d,error:null}).then(res,rej)}};return q},rpc:async()=>({data:1,error:null})}}
  const env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_ANON_KEY:'anon',SUPABASE_SERVICE_ROLE_KEY:'service',E2_DRIVE_ROOT_FOLDER_ID:root,E2_DRIVE_SIGNING_SECRET:'test-only-signing-key-at-least-32-characters',E2_DRIVE_SERVICE_ACCOUNT_JSON:JSON.stringify({client_email:'t@example.test',private_key:'x'})};
  let handler;
  vm.runInNewContext(readFileSync(root_+'supabase/functions/e2-drive-photos/index.ts','utf8').replace(/^import .*;\r?\n/gm,''),{...core,createClient,Request,Response,URL,JSON,Error,Set,Promise,Object,Array,Number,String,
    Deno:{env:{get:k=>env[k]},serve:fn=>handler=fn},googleDrive:()=>({metadata:async id=>id===root?{name:'E2',mimeType:'application/vnd.google-apps.folder'}:id===folder?{name:'VBH4735 CIVIC',mimeType:'application/vnd.google-apps.folder',parents:[root]}:{id:file,mimeType:'image/jpeg',parents:[folder],size:jpeg.length,md5Checksum:state.brokenPhoto?'b'.repeat(32):checksum,capabilities:{canDownload:true}},list:async()=>[],image:async()=>new Uint8Array(jpeg)})});
  return {handler,rows};
}
const page=`<!doctype html><body><div id=list></div><script type=module>
import {photoURLCache,watchPhotoErrors} from './photo-urls.mjs';
// POST like the site's functions.invoke call: Chrome queues a repeated GET behind a stuck one.
const issue=async ps=>{const r=await fetch('/links',{method:'POST'});if(!r.ok)throw Error('link service down');const urls=await r.json();return ps.map((p,i)=>({...p,url:urls[i]||null}))};
const cache=photoURLCache(issue),recovery=watchPhotoErrors(cache);
const photos=[{id:'${photo}',source:'drive',path:'x'}];
window.render=async()=>{const u=await cache.urls(photos);list.innerHTML=u.map(p=>p.url?'<img src="'+p.url+'">':'<span>none</span>').join('');await new Promise(r=>setTimeout(r,500));return width()};
window.show=async url=>{list.innerHTML='<img src="'+url+'">';await new Promise(r=>setTimeout(r,500));return width()};
window.width=()=>document.images[0]?.naturalWidth??-1;
window.src=()=>document.images[0]?.getAttribute('src');
window.manualRefresh=()=>recovery.retryAll();
</script>`;
async function setup(){
  const state={linkDown:false,linkHang:false,brokenPhoto:false},hung=[],{handler,rows}=load(state),stats={links:0,gets:0,ok:0,fail:0};
  const server=http.createServer(async(q,s)=>{const u=new URL(q.url,'http://x');
    if(u.pathname==='/')return s.end(page);
    if(u.pathname==='/photo-urls.mjs'){s.setHeader('content-type','text/javascript');return s.end(readFileSync(root_+'photo-urls.mjs'))}
    if(u.pathname==='/links'){stats.links++;if(state.linkDown){s.statusCode=500;return s.end('down')}
      if(state.linkHang){hung.push(s);return}   // never answers
      const r=await handler(new Request('https://example.supabase.co/functions/v1/e2-drive-photos',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'urls',ids:[photo]})}));   // public visitor
      const body=await r.json();s.setHeader('cache-control','no-store');return s.end(JSON.stringify(body.photos.map(p=>p.url.replace('https://example.supabase.co',''))))}
    if(u.pathname==='/functions/v1/e2-drive-photos'){stats.gets++;const r=await handler(new Request('https://example.supabase.co'+q.url));r.status===200?stats.ok++:stats.fail++;
      s.statusCode=r.status;r.headers.forEach((v,k)=>s.setHeader(k,v));return s.end(Buffer.from(await r.arrayBuffer()))}
    s.statusCode=404;s.end()}).listen(0);
  const browser=await chromium.launch(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),ctx=await browser.newContext(),p=await ctx.newPage();
  const base='http://127.0.0.1:'+server.address().port+'/';await p.goto(base);await p.waitForFunction(()=>window.render);
  const tab=async()=>{const t=await ctx.newPage();await t.goto(base);await t.waitForFunction(()=>window.show);return t};
  const expireAndUncache=async()=>{offset+=6*60*1000;const cdp=await ctx.newCDPSession(p);await cdp.send('Network.clearBrowserCache')};
  return {state,rows,stats,p,ctx,tab,expireAndUncache,close:async()=>{await browser.close();hung.forEach(s=>s.destroy());server.close()}};
}
const results={};
async function run(name,fn){offset=0;const e=await setup();try{results[name]=await fn(e)}finally{await e.close()}console.log(name,JSON.stringify(results[name]))}

if(slow)await run('draftPromise',async({rows,stats,p,tab})=>{
  const r={shown:await p.evaluate(()=>render())};const url=await p.evaluate(()=>src());const t0=realNow();
  rows.vehicles[0].publication='draft';                        // staff moves the car to draft
  await sleep(60000);let h=stats.gets;const t=await tab();
  r.at60s={newTabShown:await t.evaluate(u=>show(u),url),serverHits:stats.gets-h};
  await sleep(Math.max(0,t0+305000-realNow()));h=stats.gets;const l=stats.links;
  const t2=await tab();
  r.at305s={newTabShown:await t2.evaluate(u=>show(u),url),sameTabShown:await p.evaluate(u=>show(u),url),serverHits:stats.gets-h,failedGets:stats.fail};
  await sleep(40000);r.at305s.afterRetries={sameTabShown:await p.evaluate(()=>width()),linkRequests:stats.links-l};
  assert.equal(r.shown,1);assert.deepEqual(r.at60s,{newTabShown:1,serverHits:0},'Within five minutes the cached copy may still show');
  assert.equal(r.at305s.newTabShown,0,'After five minutes the browser cache no longer shows a photo moved to draft');
  // A page that stays open may redisplay an image it already loaded whatever the cache
  // headers say; car.js and showroom.js re-read the stock every 4 minutes and drop it
  // (covered in tests/vehicle-pages.spec.mjs). Renewal never issues a link for it.
  assert.equal(r.at305s.afterRetries.linkRequests,0);
  return r;
});
await run('offlineThenOnline',async({stats,p,ctx,expireAndUncache})=>{
  const r={shown:await p.evaluate(()=>render())};await expireAndUncache();await ctx.setOffline(true);
  await p.evaluate(()=>{const u=src();list.innerHTML='<img src="'+u+'">'});    // timed re-render with the expired link, offline
  await sleep(40000);r.offline={shown:await p.evaluate(()=>width()),linkRequestsReachedServer:stats.links-1};
  const l=stats.links;await ctx.setOffline(false);await sleep(3000);
  r.online={shown:await p.evaluate(()=>width()),linkRequests:stats.links-l};
  assert.deepEqual(r,{shown:1,offline:{shown:0,linkRequestsReachedServer:0},online:{shown:1,linkRequests:1}},'Back online, the broken photo recovers by itself');return r;
});
await run('serverDownThenManual',async({state,stats,p,expireAndUncache})=>{
  const r={shown:await p.evaluate(()=>render())};await expireAndUncache();state.linkDown=true;const l=stats.links;
  await p.evaluate(()=>{const u=src();list.innerHTML='<img src="'+u+'">'});
  await sleep(40000);r.down={shown:await p.evaluate(()=>width()),autoTries:stats.links-l};
  await sleep(40000);r.downLater={autoTries:stats.links-l};
  state.linkDown=false;const m=stats.links;await p.evaluate(()=>manualRefresh());await sleep(1500);
  r.manual={shown:await p.evaluate(()=>width()),linkRequests:stats.links-m};
  assert.deepEqual(r,{shown:1,down:{shown:0,autoTries:3},downLater:{autoTries:3},manual:{shown:1,linkRequests:1}},'Three automatic tries, then a manual refresh recovers');return r;
});
await run('stuckRenewalThenManual',async({state,stats,p,expireAndUncache})=>{
  const r={shown:await p.evaluate(()=>render())};await expireAndUncache();state.linkHang=true;
  await p.evaluate(()=>{const u=src();list.innerHTML='<img src="'+u+'">'});
  await sleep(3000);r.stuck={shown:await p.evaluate(()=>width())};
  state.linkHang=false;const t=realNow();await p.evaluate(()=>manualRefresh());await p.waitForFunction(()=>width()===1,null,{timeout:6000});
  r.manual={shown:await p.evaluate(()=>width()),within2s:realNow()-t<2000};
  assert.deepEqual(r,{shown:1,stuck:{shown:0},manual:{shown:1,within2s:true}},'A manual refresh does not wait on a renewal that never answers');return r;
});
await run('stuckRenewalThenOnline',async({state,p,ctx,expireAndUncache})=>{
  const r={shown:await p.evaluate(()=>render())};await expireAndUncache();state.linkHang=true;
  await p.evaluate(()=>{const u=src();list.innerHTML='<img src="'+u+'">'});
  await sleep(3000);r.stuck={shown:await p.evaluate(()=>width())};
  state.linkHang=false;await ctx.setOffline(true);await ctx.setOffline(false);const t=realNow();
  await p.waitForFunction(()=>width()===1,null,{timeout:6000});r.online={shown:1,within2s:realNow()-t<2000};
  assert.deepEqual(r,{shown:1,stuck:{shown:0},online:{shown:1,within2s:true}},'Coming back online does not wait on a renewal that never answers');return r;
});
await run('stuckRenewalThenAuto',async({state,stats,p,expireAndUncache})=>{
  const r={shown:await p.evaluate(()=>render())};await expireAndUncache();state.linkHang=true;
  await p.evaluate(()=>{const u=src();list.innerHTML='<img src="'+u+'">'});
  await sleep(4000);state.linkHang=false;     // the service answers again; nobody touches the page
  await sleep(12000);r.after16s={shown:await p.evaluate(()=>width())};
  assert.deepEqual(r,{shown:1,after16s:{shown:1}},'A stuck renewal times out after 8 s and the next scheduled try recovers');return r;
});
await run('brokenPhotoStops',async({state,stats,p,expireAndUncache})=>{
  const r={shown:await p.evaluate(()=>render())};await expireAndUncache();state.brokenPhoto=true;const l=stats.links,g=stats.gets;
  await p.evaluate(()=>{const u=src();list.innerHTML='<img src="'+u+'">'});
  await sleep(45000);r.after45s={shown:await p.evaluate(()=>width()),linkRequests:stats.links-l,photoRequests:stats.gets-g};
  await sleep(30000);r.after75s={linkRequests:stats.links-l,photoRequests:stats.gets-g};
  assert.deepEqual(r,{shown:1,after45s:{shown:0,linkRequests:3,photoRequests:4},after75s:{linkRequests:3,photoRequests:4}},'A photo that keeps failing stops after three renewals');return r;
});
console.log('PASS photo browser: link reuse, bounded renewal, recovery when back online or on manual refresh'+(slow?', five-minute draft promise':''));
