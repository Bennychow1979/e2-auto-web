import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {publicRows,fetchPublicSample,fetchPublicInventory,createSlugMap,renderVehiclePage,buildVehicleSite,PUBLIC_FIELDS} from '../../scripts/build-vehicle-pages.mjs';
import {vehicleIdentity} from '../../vehicle-routes.mjs';
import {localizedURL} from '../../i18n.mjs';
import {withDeadline} from '../../vehicle-loading.mjs';
import {vehicleA,vehicleB,vehiclePath,testSlugs} from '../../tests/fixtures/vehicle-pages.mjs';
const template=await readFile(new URL('../../car.html',import.meta.url),'utf8');
const snapshot=(vehicles=[vehicleA,vehicleB])=>({kind:'synthetic-test',fetchedAt:new Date().toISOString(),vehicles:structuredClone(vehicles)});
test('routes preserve identity, language and parameters; conflicting IDs fail',()=>{
 const document={documentElement:{dataset:{vehicleId:vehicleA.id}},getElementById:()=>({textContent:JSON.stringify(testSlugs)})};
 for(const lang of ['en','ms','zh']){const path=vehiclePath(vehicleA.id,lang);assert.equal(vehicleIdentity({pathname:path,search:'?sales=synthetic'},document),vehicleA.id);assert.equal(new URL(localizedURL('booking.html?id='+vehicleA.id,lang,'https://e2auto.my'+path)).pathname,'/'+(lang==='en'?'':lang+'/')+'booking.html');}
 assert.throws(()=>vehicleIdentity({pathname:vehiclePath(vehicleA.id),search:'?id='+vehicleB.id}));
 assert.equal(vehicleIdentity({pathname:'/car.html',search:'?id='+vehicleB.id}),vehicleB.id);
 assert.equal(localizedURL('https://e2auto.my'+vehiclePath(vehicleA.id)+'?sales=test#specs','zh'),'https://e2auto.my'+vehiclePath(vehicleA.id,'zh')+'?sales=test#specs');
});
test('only complete fresh published fields cross the build boundary',()=>{
 const s=snapshot([{...vehicleA,secret:'NEVER-EXPORT',vehicle_photos:[{signedUrl:'SECRET-URL'}]},{...vehicleB,publication:'draft'}]);
 const rows=publicRows(s);assert.equal(rows.length,1);assert.equal(rows[0].secret,undefined);assert.equal(rows[0].vehicle_photos,undefined);assert.deepEqual(Object.keys(rows[0]).sort(),PUBLIC_FIELDS.slice().sort());
 assert.throws(()=>publicRows({...s,fetchedAt:'2000-01-01T00:00:00Z'}));assert.throws(()=>publicRows({...s,fetchedAt:'2100-01-01T00:00:00Z'}));
 for(const value of [null,'',-1,'not a price'])assert.throws(()=>publicRows(snapshot([{...vehicleA,price:value}])));
 assert.throws(()=>publicRows(snapshot([vehicleA,vehicleA])));
});
test('sample request is anonymous, exact-ID scoped and excludes photo metadata',async()=>{
 const ids=[vehicleA.id],requests=[];
 const result=await fetchPublicSample({supabaseUrl:'https://synthetic-vehicle.supabase.co',publishableKey:'sb_publishable_synthetic'},ids,async(url,options)=>{requests.push({url,options});return {ok:true,json:async()=>[vehicleA]}});
 assert.equal(result.vehicles.length,1);assert.equal(requests.length,1);assert.equal(requests[0].url.searchParams.get('publication'),'eq.published');assert.equal(requests[0].url.searchParams.get('id'),'eq.'+vehicleA.id);assert.equal(requests[0].options.credentials,'omit');assert.deepEqual(Object.keys(requests[0].options.headers),['apikey']);assert(!requests[0].url.search.includes('photo'));
 await assert.rejects(fetchPublicSample({},ids));await assert.rejects(fetchPublicSample({supabaseUrl:'https://synthetic-vehicle.supabase.co',publishableKey:'sb_publishable_synthetic'},ids,async()=>({ok:false,status:503})));
});
test('three languages contain unique facts, same-car canonical and literal alternates before scripts run',()=>{
 for(const lang of ['en','ms','zh']){
  const html=renderVehiclePage(template,vehicleA,lang,new Date().toISOString());
  assert(html.includes('id="model">VIOS</strong>'));assert(html.includes('id="heroPrice">RM34,990</strong>'));assert(html.includes('TEST-A'));assert(html.includes('<main id="carMain">'));
  assert(html.includes('rel="canonical" href="https://e2auto.my'+vehiclePath(vehicleA.id,lang)+'"'));
  for(const l of ['en','ms','zh'])assert(html.includes('href="'+vehiclePath(vehicleA.id,l)+'" data-language="'+l+'"'));
  assert.equal((html.match(/rel="alternate"/g)||[]).length,4);assert(!html.includes('id="vehicleSearchPolicy"'));assert(!html.includes('src="../'));assert(!html.includes('href="car.html'));
  assert.equal(JSON.parse(/id="vehicleStructuredData" type="application\/ld\+json">([^<]+)</.exec(html)[1]).offers.price,34990);
 }
 assert.notEqual(renderVehiclePage(template,vehicleA,'en','test'),renderVehiclePage(template,vehicleB,'en','test'));
});
test('database strings cannot escape text, metadata or JSON script contexts',()=>{
 const car={...vehicleA,model:'City </script><script>window.BAD=1</script> $& "',description:'<img src=x onerror="window.BAD=2">'},html=renderVehiclePage(template,car,'en','test');
 assert(!html.includes('<script>window.BAD'));assert(!html.includes('<img src=x'));assert(html.includes('&lt;/script&gt;'));assert(html.includes('$&amp;'));
 const schema=JSON.parse(/id="vehicleStructuredData" type="application\/ld\+json">([^<]+)</.exec(html)[1]);assert.equal(schema.model,car.model);
});
test('empty optional public fields render safely in every language',()=>{for(const lang of ['en','ms','zh']){const html=renderVehiclePage(template,{...vehicleA,body_type:null,transmission:null,fuel_type:null,engine_litres:null,variant:null},lang,'test');assert(html.includes('id="model">VIOS'));assert(!html.includes('null L'));assert(!html.includes('>undefined<'))}});
test('rebuild updates price and Sold and removes withdrawn pages in every language and sitemap',async()=>{
 const out=join(await mkdtemp(join(tmpdir(),'e2-vehicle-build-')),'site'),s=snapshot();
 const first=await buildVehicleSite(s,out);assert.equal(first.files.length,6);
 await writeFile(join(out,'unrelated.txt'),'Keep me');
 const changed=snapshot([{...vehicleA,price:32990,stock_status:'Sold'},{...vehicleB,publication:'draft'}]);
 const next=await buildVehicleSite(changed,out);assert.equal(next.files.length,3);
 for(const lang of ['en','ms','zh']){const html=await readFile(join(out,vehiclePath(vehicleA.id,lang),'index.html'),'utf8');assert(html.includes('RM32,990'));assert(html.includes('https://schema.org/SoldOut'));await assert.rejects(access(join(out,vehiclePath(vehicleB.id,lang),'index.html')));}
 const sitemap=await readFile(join(out,'sitemap.xml'),'utf8');assert(!sitemap.includes(testSlugs[vehicleB.id]));assert(sitemap.includes(testSlugs[vehicleA.id]));assert(!sitemap.includes('car.html?id='));assert.equal(await readFile(join(out,'unrelated.txt'),'utf8'),'Keep me');assert.equal(next.slugs[vehicleB.id],first.slugs[vehicleB.id]);
 const before=await readFile(join(out,'vehicle-pages-manifest.json'),'utf8');
 await assert.rejects(buildVehicleSite({...changed,fetchedAt:'2000-01-01T00:00:00Z'},out));await assert.rejects(buildVehicleSite(snapshot([{...vehicleA,price:null}]),out));assert.equal(await readFile(join(out,'vehicle-pages-manifest.json'),'utf8'),before);
});
test('unsafe prior manifests cannot prune paths outside generated vehicle files',async()=>{
 const out=await mkdtemp(join(tmpdir(),'e2-vehicle-manifest-'));await writeFile(join(out,'vehicle-pages-manifest.json'),JSON.stringify({version:1,files:['../other.html']}));await assert.rejects(buildVehicleSite(snapshot(),out),/Unsafe/);
});
test('slugs remain stable across edits, collisions, missing plates and withdrawal',()=>{
 const collision={...vehicleA,id:vehicleB.id},first=createSlugMap([vehicleA,collision]);assert.notEqual(first[vehicleA.id],first[vehicleB.id]);
 const changed=createSlugMap([{...vehicleA,price:12345,brand:'Changed',plate:'NEW'}],first);assert.deepEqual(changed,first);
 assert(createSlugMap([{...vehicleA,plate:null}])[vehicleA.id].endsWith(vehicleA.id.slice(0,8)));assert.throws(()=>createSlugMap([],{[vehicleA.id]:'same',[vehicleB.id]:'same'}));
});
test('complete inventory pagination confirms zero and fails closed on error, truncation or concurrent changes',async()=>{
 const config={supabaseUrl:'https://synthetic-vehicle.supabase.co',publishableKey:'sb_publishable_synthetic'};let calls=0;
 const response=(rows,count=rows.length)=>({ok:true,headers:{get:()=> '0-'+(rows.length-1)+'/'+count},json:async()=>rows});
 const result=await fetchPublicInventory(config,async()=>{calls++;return response([vehicleA,vehicleB])});assert.equal(calls,2);assert.equal(result.expectedCount,2);assert(result.complete);
 const empty=await fetchPublicInventory(config,async()=>response([],0));assert.equal(empty.expectedCount,0);assert.equal(empty.confirmedReads,2);
 await assert.rejects(fetchPublicInventory(config,async()=>response([vehicleA],2)));await assert.rejects(fetchPublicInventory(config,async()=>({ok:false})));
 calls=0;await assert.rejects(fetchPublicInventory(config,async()=>response([{...vehicleA,price:calls++?1:2}])));
 const many=Array.from({length:201},(_,i)=>({...vehicleA,id:'aaaaaaaa-1111-4111-8111-'+String(i).padStart(12,'0')})),offsets=[];
 const paged=await fetchPublicInventory(config,async url=>{const offset=Number(url.searchParams.get('offset'));offsets.push(offset);return response(many.slice(offset,offset+200),201)});assert.equal(paged.vehicles.length,201);assert.deepEqual(offsets,[0,200,0,200]);
 const out=join(await mkdtemp(join(tmpdir(),'e2-vehicle-empty-')),'site');await assert.rejects(buildVehicleSite(snapshot([]),out),/Empty/);await assert.rejects(buildVehicleSite({...snapshot(),kind:'public-complete',complete:true,expectedCount:3},out),/Incomplete/);await assert.rejects(access(out));
});
test('same-model vehicles keep distinct pages and canonical identities without inventing title facts',()=>{
 const other={...vehicleA,id:vehicleB.id,plate:'OTHER-A',price:29990},slugs=createSlugMap([vehicleA,other]);
 const first=renderVehiclePage(template,vehicleA,'en','test',slugs),second=renderVehiclePage(template,other,'en','test',slugs);assert.notEqual(first,second);assert.notEqual(slugs[vehicleA.id],slugs[other.id]);assert(second.includes('OTHER-A'));assert(second.includes('RM29,990'));
 assert.equal(/<title>([^<]*)/.exec(first)[1],/<title>([^<]*)/.exec(second)[1]);
});
test('Sold sitemap policy is explicit; excluding Sold never removes its public page',async()=>{
 const out=join(await mkdtemp(join(tmpdir(),'e2-vehicle-sold-')),'site'),rows=[{...vehicleA,stock_status:'Sold'}, {...vehicleB,stock_status:'Reserved'}];
 const result=await buildVehicleSite(snapshot(rows),out,{includeSold:false});assert.equal(result.files.length,6);const xml=await readFile(join(out,'sitemap.xml'),'utf8');assert(!xml.includes(testSlugs[vehicleA.id]));assert(xml.includes(testSlugs[vehicleB.id]));assert.equal((xml.match(/<loc>/g)||[]).length,13,'Homes, bookings, privacy, number plates and one vehicle');await access(join(out,vehiclePath(vehicleA.id),'index.html'));
});
test('photo deadlines terminate waiting and pass completed values',async()=>{
 await assert.rejects(withDeadline(new Promise(()=>{}),20));assert.equal(await withDeadline(Promise.resolve('ready'),20),'ready');
});
