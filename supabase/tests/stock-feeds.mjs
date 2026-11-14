import test from 'node:test';
import assert from 'node:assert/strict';
import {renderStockFeeds,resolveStockSoldDates,STOCK_FEED_MAX_CHARACTERS} from '../../scripts/build-stock-feeds.mjs';
import {createSlugMap,buildVehicleSite} from '../../scripts/build-vehicle-pages.mjs';
import {readFile,mkdtemp,access} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {vehicleA,vehicleB,vehicleSold} from '../../tests/fixtures/vehicle-pages.mjs';
const fetchedAt='2026-11-15T00:00:00.000Z',cutoff=new Date(Date.parse(fetchedAt)-90*86400000).toISOString();
const parse=text=>text.trim().split('\n').filter(l=>!l.startsWith('#')).map(JSON.parse);
const options=rows=>({slugs:createSlugMap(rows),fetchedAt,builtAt:fetchedAt,complete:true,soldAtById:Object.fromEntries(rows.filter(r=>r.stock_status==='Sold').map(r=>[r.id,fetchedAt]))});
test('website Sold update time is frozen across edits and reset only after returning to active stock',()=>{
 const initial=resolveStockSoldDates([vehicleSold]);assert.equal(initial[vehicleSold.id],new Date(vehicleSold.updated_at).toISOString());
 const edited={...vehicleSold,price:999,updated_at:fetchedAt};assert.deepEqual(resolveStockSoldDates([edited],initial),initial);
 const active=resolveStockSoldDates([{...edited,stock_status:'Available'}],initial);assert.deepEqual(active,{});
 assert.equal(resolveStockSoldDates([edited],active)[vehicleSold.id],fetchedAt);
 assert.throws(()=>resolveStockSoldDates([{...vehicleSold,updated_at:null}]),/valid website update time/);
});
test('active and recent-Sold feeds retain exactly eight fields and shared snapshot with separate complete counts',()=>{
 const rows=[vehicleA,{...vehicleB,stock_status:'Reserved'},vehicleSold],r=renderStockFeeds(rows,options(rows)),active=parse(r.stock),sold=parse(r.soldStock);
 for(const values of [active,sold]){assert.equal(values[0].format,'e2-stock-v1');assert.equal(values[0].snapshot_at,fetchedAt);assert.equal(values[0].complete,true);assert.equal(values[0].max_chars,40000);assert.deepEqual(values[0].columns,['year','make','model','variant','plate','status','price_myr','url']);assert(values.slice(1,-1).every(v=>Array.isArray(v)&&v.length===8));assert.equal(values[0].vehicles,values.length-2);assert.equal(values.at(-1).vehicles,values.length-2);}
 assert.deepEqual(active[0].counts,{Available:1,Reserved:1,Sold:0});assert.deepEqual(sold[0].counts,{Available:0,Reserved:0,Sold:1});assert.equal(r.coverage.published,r.coverage.active+r.coverage.soldRecent+r.coverage.soldExpired);
});
test('90-day boundary uses verified sale time, never the mutable updated_at value',()=>{
 const rows=[vehicleSold],o=options(rows);o.soldAtById[vehicleSold.id]=cutoff;assert.equal(parse(renderStockFeeds(rows,o).soldStock)[0].vehicles,1);
 o.soldAtById[vehicleSold.id]=new Date(Date.parse(cutoff)-1).toISOString();const r=renderStockFeeds([{...vehicleSold,updated_at:fetchedAt}],o);assert.equal(parse(r.soldStock)[0].vehicles,0);assert.equal(r.coverage.soldExpired,1);
});
test('missing, invalid and future sale dates fail explicitly rather than silently dropping vehicles',()=>{
 const rows=[vehicleSold],o=options(rows);for(const value of [undefined,'2026-02-30T00:00:00Z','2026-11-16T00:00:00Z','not-a-date'])assert.throws(()=>renderStockFeeds(rows,{...o,soldAtById:{[vehicleSold.id]:value}}),/sold date/);
 assert.throws(()=>renderStockFeeds([vehicleA,vehicleA],options([vehicleA])),/Duplicate/);
});
test('both feeds fail above the declared limit and never return a truncated pair',()=>{
 for(const status of ['Available','Sold']){const rows=[{...vehicleA,stock_status:status,variant:'X'.repeat(STOCK_FEED_MAX_CHARACTERS)}];assert.throws(()=>renderStockFeeds(rows,options(rows)),error=>error.code==='E2_STOCK_SIZE_LIMIT'&&error.maxCharacters===40000&&error.characters>40000&&error.vehicles===1&&error.feed===(status==='Sold'?'stock-sold.txt':'stock.txt'));}
});
test('180 active vehicles fit with all records and canonical URLs while retired Sold vehicles do not inflate the main feed',()=>{
 const rows=Array.from({length:180},(_,i)=>({...vehicleA,id:'aaaaaaaa-1111-4111-8111-'+String(i).padStart(12,'0'),plate:'TEST'+i}));const r=renderStockFeeds(rows,options(rows)),a=parse(r.stock);assert.equal(a[0].vehicles,180);assert.equal(a.at(-1).vehicles,180);assert.equal(new Set(a.slice(1,-1).map(v=>v[7])).size,180);assert(r.stock.length<40000);assert.equal(parse(r.soldStock)[0].vehicles,0);
});
test('overflow preserves both old files; 90-day expiry removes only the Sold feed row, retaining public pages and URLs',async()=>{
 const rows=[vehicleA,{...vehicleSold,updated_at:fetchedAt}],snapshot={kind:'public-complete',complete:true,expectedCount:2,fetchedAt,vehicles:rows},out=join(await mkdtemp(join(tmpdir(),'e2-stock-pair-')),'site'),now=Date.parse(fetchedAt);
 const first=await buildVehicleSite(snapshot,out,{now}),before=await Promise.all(['stock.txt','stock-sold.txt'].map(f=>readFile(join(out,f),'utf8')));
 for(const status of ['Available','Sold']){
  const bad={...snapshot,vehicles:rows.map(r=>r.stock_status===status?{...r,variant:'X'.repeat(40000)}:r)};await assert.rejects(buildVehicleSite(bad,out,{now}),e=>e.code==='E2_STOCK_SIZE_LIMIT');
  assert.deepEqual(await Promise.all(['stock.txt','stock-sold.txt'].map(f=>readFile(join(out,f),'utf8'))),before);
 }
 const later=now+91*86400000,edited={...snapshot,fetchedAt:new Date(later).toISOString(),vehicles:rows.map(r=>({...r,updated_at:new Date(later).toISOString()}))};
 const next=await buildVehicleSite(edited,out,{now:later});assert.equal(next.stockSoldDates[vehicleSold.id],first.stockSoldDates[vehicleSold.id]);assert.equal(parse(await readFile(join(out,'stock-sold.txt'),'utf8'))[0].vehicles,0);assert.equal(next.stockFeeds.soldExpired,1);
 const slug=first.slugs[vehicleSold.id];await access(join(out,'cars',slug,'index.html'));assert((await readFile(join(out,'sitemap.xml'),'utf8')).includes('/cars/'+slug+'/'));
});
