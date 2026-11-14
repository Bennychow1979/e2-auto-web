import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {renderStockFeeds} from '../../scripts/build-stock-feeds.mjs';
import {createSlugMap} from '../../scripts/build-vehicle-pages.mjs';
import {publicationMatches,createHandler} from '../functions/e2-inventory-refresh/handler.mjs';
import {verifyLivePublication} from '../../scripts/verify-live-publication.mjs';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {vehicleA,vehicleSold} from '../../tests/fixtures/vehicle-pages.mjs';
const id='aaaaaaaa-1111-4111-8111-111111111111',time='2026-11-15T00:00:00.000Z',rows=[vehicleA,vehicleSold],job={action:'check',revision:'12',dispatch:id,lease:id,started_at:time};
const feeds=renderStockFeeds(rows,{soldAtById:{[vehicleSold.id]:time},slugs:createSlugMap(rows),fetchedAt:time,builtAt:time,complete:true}),sitemap='<urlset/>',hash=s=>createHash('sha256').update(s).digest('hex');
const manifest={releaseArtifact:true,inventoryRefresh:{revision:'12',dispatch:id},fetchedAt:time,builtAt:time,files:Array(6).fill('page'),stockFeeds:feeds.coverage,publicationHashes:{stock:hash(feeds.stock),stockSold:hash(feeds.soldStock),sitemap:hash(sitemap)}};
test('paired receipt requires matching complete active and sold files from one version',async()=>{
 assert(await publicationMatches(job,manifest,feeds.stock,sitemap,feeds.soldStock));
 for(const sold of [undefined,'',feeds.soldStock.split('\n')[0],feeds.soldStock.replace(time,'2026-11-14T00:00:00.000Z')])assert(!await publicationMatches(job,manifest,feeds.stock,sitemap,sold));
 for(const change of [{active:0},{soldExpired:1},{published:3},{maxCharacters:18000}])assert(!await publicationMatches(job,{...manifest,stockFeeds:{...manifest.stockFeeds,...change}},feeds.stock,sitemap,feeds.soldStock));
});
test('status, count and eight-field validation cannot be bypassed by recomputing the hash',async()=>{
 for(const transform of [s=>s.replace('"Available",','"Sold",'),s=>s.replace('"vehicles":1','"vehicles":2'),s=>s.replace('"max_chars":40000','"max_chars":18000'),s=>s.replace(/(\[2016,)/,'$1"EXTRA",')]){
  const bad=transform(feeds.stock);assert.notEqual(bad,feeds.stock);assert(!await publicationMatches(job,{...manifest,publicationHashes:{...manifest.publicationHashes,stock:hash(bad)}},bad,sitemap,feeds.soldStock));
 }
});
test('worker fetches Sold file and cannot acknowledge a missing or stale Sold publication',async()=>{
 for(const stale of [false,true]){
  const seen=[],results=[],handler=createHandler({store:{claimDispatch:async()=>true,claim:async()=>job,finish:async(j,outcome)=>{results.push(outcome);return true;}},fetchImpl:async url=>{
   const path=new URL(url).pathname;seen.push(path);if(path==='/vehicle-pages-manifest.json')return new Response(JSON.stringify(manifest));if(path==='/stock.txt')return new Response(feeds.stock);if(path==='/sitemap.xml')return new Response(sitemap);if(path==='/stock-sold.txt')return new Response(stale?'old':feeds.soldStock);return new Response('{"workflow_runs":[]}');
  }});
  await handler(new Request('https://test/',{method:'POST',headers:{Authorization:'Bearer e2refresh_'+'a'.repeat(64)},body:JSON.stringify({dispatch_id:id})}));assert(seen.includes('/stock-sold.txt'));assert.deepEqual(results,[stale?'waiting':'deployed']);
 }
});
test('postdeploy gate refuses a stale Sold file even when main feed, manifest and sitemap match',async()=>{
 const out=await mkdtemp(join(tmpdir(),'e2-stock-pair-live-')),files={'vehicle-pages-manifest.json':JSON.stringify(manifest),'stock.txt':feeds.stock,'stock-sold.txt':feeds.soldStock,'sitemap.xml':sitemap};await Promise.all(Object.entries(files).map(([name,text])=>writeFile(join(out,name),text)));
 await assert.rejects(verifyLivePublication(out,{attempts:1,request:async url=>new Response(new URL(url).pathname==='/stock-sold.txt'?'old':files[new URL(url).pathname.slice(1)])}),/does not match/);
 assert((await verifyLivePublication(out,{attempts:1,request:async url=>new Response(files[new URL(url).pathname.slice(1)])})).published);
});
