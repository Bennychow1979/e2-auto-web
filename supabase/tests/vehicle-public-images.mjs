import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fetchPublicPhotoCoverage} from '../../scripts/vehicle-public-images.mjs';
import {publicVehicleImageURL,probePublicImageGateway} from '../../vehicle-public-image.mjs';
import {buildVehicleSite} from '../../scripts/build-vehicle-pages.mjs';
import {vehicleA,vehicleB,vehiclePath} from '../../tests/fixtures/vehicle-pages.mjs';
const config={supabaseUrl:'https://synthetic.supabase.co',publishableKey:'sb_publishable_synthetic'},photo='10000000-0000-4000-8000-000000000001';
const response=(rows,count=rows.length)=>({ok:true,headers:new Headers({'content-range':'0-'+(rows.length-1)+'/'+count}),json:async()=>rows});
const coverage=[{vehicleId:vehicleA.id,photoId:photo,source:'drive'},{vehicleId:vehicleB.id,photoId:null,source:null}];
const snapshot=()=>({kind:'public-complete',complete:true,expectedCount:2,fetchedAt:new Date().toISOString(),vehicles:[vehicleA,vehicleB],publicPhotos:coverage,publicImageOrigin:config.supabaseUrl});
const ok=()=>new Response(null,{headers:{'x-e2-public-image':'v2','content-type':'image/jpeg','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','content-disposition':'inline'}});
test('stable URL contains no ticket, credentials or remote file identifier',()=>{const url=publicVehicleImageURL(config.supabaseUrl,vehicleA.id);assert.equal(url,config.supabaseUrl+'/functions/v1/e2-drive-photos?public_vehicle='+vehicleA.id);for(const origin of ['https://evil.example','http://test.supabase.co','https://test.supabase.co/','https://user:pass@test.supabase.co'])assert.throws(()=>publicVehicleImageURL(origin,vehicleA.id))});
test('gateway capability requires HEAD, v2 marker, image MIME and no-store',async()=>{assert(await probePublicImageGateway(config.supabaseUrl,vehicleA.id,async(url,options)=>{assert.equal(options.method,'HEAD');assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');return ok()}));for(const r of [new Response(null,{status:404}),new Response(null,{headers:{'content-type':'image/jpeg'}}),new Response(null,{headers:{'x-e2-public-image':'v2','content-type':'text/html','cache-control':'no-store'}})])assert.equal(await probePublicImageGateway(config.supabaseUrl,vehicleA.id,async()=>r),false)});
test('coverage requests only public first-photo metadata and validates snapshot equality',async()=>{const rows=[{...vehicleA,vehicle_photos:[{id:photo,position:0,source:'drive'}]},{...vehicleB,vehicle_photos:[]}];const value=await fetchPublicPhotoCoverage(config,snapshot(),async(url,options)=>{assert.equal(options.credentials,'omit');assert.equal(url.searchParams.get('publication'),'eq.published');assert.equal(url.searchParams.get('vehicle_photos.limit'),'1');assert(!url.search.includes('file_id'));assert(!url.search.includes('path'));return response(rows)});assert.deepEqual(value,coverage);await assert.rejects(fetchPublicPhotoCoverage(config,snapshot(),async()=>response([{...rows[0],updated_at:'changed'},rows[1]])));await assert.rejects(fetchPublicPhotoCoverage(config,snapshot(),async()=>response(rows,3)))});
test('coverage paginates 201 rows without image bytes and rejects duplicate identities',async()=>{const vehicles=Array.from({length:201},(_,i)=>({...vehicleA,id:'aaaaaaaa-1111-4111-8111-'+String(i).padStart(12,'0')})),offsets=[];const value=await fetchPublicPhotoCoverage(config,{vehicles},async url=>{const offset=+url.searchParams.get('offset');offsets.push(offset);return response(vehicles.slice(offset,offset+200).map(v=>({...v,vehicle_photos:[]})),201)});assert.equal(value.length,201);assert.deepEqual(offsets,[0,200]);await assert.rejects(fetchPublicPhotoCoverage(config,snapshot(),async()=>response([{...vehicleA,vehicle_photos:[]},{...vehicleA,vehicle_photos:[]}])))});
test('release gate preserves prior artifact until stable images are verified',async()=>{const out=join(await mkdtemp(join(tmpdir(),'e2-release-images-')),'site');const first=await buildVehicleSite(snapshot(),out);assert.equal(first.releaseArtifact,false);const before=await readFile(join(out,'vehicle-pages-manifest.json'),'utf8');await assert.rejects(buildVehicleSite(snapshot(),out,{release:true,imageRequest:async()=>new Response(null,{status:404})}),/not active/);assert.equal(await readFile(join(out,'vehicle-pages-manifest.json'),'utf8'),before);const ready=await buildVehicleSite(snapshot(),out,{release:true,imageRequest:async()=>ok()});assert(ready.releaseArtifact&&ready.imageGatewayVerified);for(const lang of ['en','ms','zh']){const html=await readFile(join(out,vehiclePath(vehicleA.id,lang),'index.html'),'utf8');assert(html.includes('data-public-image="1" src="'+publicVehicleImageURL(config.supabaseUrl,vehicleA.id)+'"'));assert(html.includes('property="og:image"'));assert(!html.includes('?ticket='));const schema=JSON.parse(/type="application\/ld\+json">([^<]+)/.exec(html)[1]);assert.deepEqual(schema.image,[publicVehicleImageURL(config.supabaseUrl,vehicleA.id)])}});
test('partial coverage, duplicate IDs and absent complete envelope cannot produce release artifact',async()=>{const out=join(await mkdtemp(join(tmpdir(),'e2-invalid-images-')),'site');for(const s of [{...snapshot(),publicPhotos:[coverage[0],coverage[0]]},{...snapshot(),publicPhotos:[]},{...snapshot(),kind:'public-sample'}])await assert.rejects(buildVehicleSite(s,out,{release:true,imageRequest:async()=>ok()}));await assert.rejects(access(out))});

test('v1 or missing defensive headers cannot pass the v2 release gate',async()=>{
 const out=join(await mkdtemp(join(tmpdir(),'e2-image-v2-gate-')),'site');
 await buildVehicleSite(snapshot(),out);const before=await readFile(join(out,'vehicle-pages-manifest.json'),'utf8');
 const cases=[['x-e2-public-image','v1'],['x-e2-public-image',null],['cache-control','public, max-age=3600'],['content-type','image/svg+xml'],['x-content-type-options',null],['referrer-policy',null],['content-disposition',null]];
 for(const [name,value] of cases){
  const imageRequest=async()=>{const r=ok();if(value===null)r.headers.delete(name);else r.headers.set(name,value);return r;};
  assert.equal(await probePublicImageGateway(config.supabaseUrl,vehicleA.id,imageRequest),false);
  await assert.rejects(buildVehicleSite(snapshot(),out,{release:true,imageRequest}),/not active/);
  assert.equal(await readFile(join(out,'vehicle-pages-manifest.json'),'utf8'),before);
 }
 for(const imageRequest of [async()=>{throw Error('offline')},async()=>new Response(null,{status:405})]){
  await assert.rejects(buildVehicleSite(snapshot(),out,{release:true,imageRequest}));assert.equal(await readFile(join(out,'vehicle-pages-manifest.json'),'utf8'),before);
 }
 const ready=await buildVehicleSite(snapshot(),out,{release:true,imageRequest:async()=>ok()});assert.equal(ready.imageGatewayVersion,'v2');assert.equal(ready.imageGatewayCheck,'HEAD');
});

test('invalid IDs cannot enter raw HTML image URLs or trigger network probes',async()=>{
 for(const id of ['../private','<img src=x onerror=alert(1)>',vehicleA.id+'%2fsecret',vehicleA.id+'?ticket=anything']){
  assert.throws(()=>publicVehicleImageURL(config.supabaseUrl,id));
  let called=false;await assert.rejects(probePublicImageGateway(config.supabaseUrl,id,async()=>{called=true;return ok()}));assert.equal(called,false);
 }
});
