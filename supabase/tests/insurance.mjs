import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {runInNewContext} from 'node:vm';
import {insuranceParts,renderInsurance} from '../../scripts/build-insurance.mjs';
import {insurancePaths} from '../../insurance-routes.mjs';
import {buildVehicleSite} from '../../scripts/build-vehicle-pages.mjs';
import {vehicleA,vehicleSold} from '../../tests/fixtures/vehicle-pages.mjs';
import {localizedURL} from '../../i18n.mjs';
const root=new URL('../../',import.meta.url),home=await readFile(new URL('index.html',root),'utf8');
for(const lang of ['en','ms','zh']){
 const source=await readFile(new URL('templates/insurance/'+lang+'.html',root),'utf8'),parts=insuranceParts(source);
 test(lang+': supplied insurance calculation matches all three requested totals',()=>{
  const core=/var E2INS = \([\s\S]*?\n\}\)\(\);/.exec(parts.js)?.[0];assert(core);
  const context={};runInNewContext(core,context,{timeout:1000});
  assert.equal(context.E2INS.calc('west','comp',50000,1468,25).total,1289.39);
  assert.equal(context.E2INS.calc('west','comp',99990,2494,55).total,1442.05);
  assert.equal(context.E2INS.calc('west','tp',0,1468,25).total,119.35);
 });
 test(lang+': shell preserves the supplied metadata, CSS, entire script, static tables and FAQ',()=>{
  const html=renderInsurance(source,home,lang);
  for(const block of [parts.metadata,parts.css,parts.js,...source.match(/<table>[\s\S]*?<\/table>/g),...source.match(/<details>[\s\S]*?<\/details>/g)])assert(html.includes(block));
  assert.equal((html.match(/<main\b/g)||[]).length,1);assert.equal((html.match(/<h1\b/g)||[]).length,1);
  assert.equal((html.match(/<table>/g)||[]).length,3);assert.equal((html.match(/<details>/g)||[]).length,4);
  assert(html.includes('<header class="galleryNav">'));assert(html.includes('<footer class="wrap demoFooter">'));assert(html.includes('href="/roadtax-site.css?v=1"'));
  for(const target of ['en','ms','zh']){
   assert(html.includes('href="'+insurancePaths[target]+'" data-language="'+target+'"'));
   const url=new URL(localizedURL('https://e2auto.my'+insurancePaths[lang]+'?ref=test#in-form',target));
   assert.equal(url.pathname,insurancePaths[target]);assert.equal(url.search,'?ref=test');assert.equal(url.hash,'#in-form');
  }
 });
}
test('release output contains all insurance pages, sitemap alternates and links from road tax and every vehicle language',async()=>{
 const rows=[vehicleA,vehicleSold],snapshot={kind:'public-complete',complete:true,expectedCount:rows.length,fetchedAt:new Date().toISOString(),vehicles:rows};
 const out=join(await mkdtemp(join(tmpdir(),'e2-insurance-')),'site'),manifest=await buildVehicleSite(snapshot,out);
 const sitemap=await readFile(join(out,'sitemap.xml'),'utf8');
 for(const lang of ['en','ms','zh']){
  const prefix=lang==='en'?'':lang+'/';
  const page=await readFile(join(out,insurancePaths[lang].slice(1),'index.html'),'utf8');assert(page.includes('id="in-form"'));
  const entry=sitemap.match(new RegExp('<url><loc>https://e2auto.my'+insurancePaths[lang]+'</loc>(.*?)</url>'))?.[0];assert(entry);
  for(const target of ['en','ms','zh'])assert(entry.includes('hreflang="'+({en:'en',ms:'ms',zh:'zh-Hans'}[target])+'" href="https://e2auto.my'+insurancePaths[target]+'"'));
  assert(entry.includes('hreflang="x-default" href="https://e2auto.my'+insurancePaths.en+'"'));
  assert((await readFile(join(out,prefix+'roadtax-calculator/index.html'),'utf8')).includes('href="'+insurancePaths[lang]+'"'));
  assert((await readFile(join(out,prefix+'car.html'),'utf8')).includes('href="'+insurancePaths[lang]+'"'));
  for(const row of rows)assert((await readFile(join(out,prefix+'cars/'+manifest.slugs[row.id]+'/index.html'),'utf8')).includes('href="'+insurancePaths[lang]+'"'));
 }
});
