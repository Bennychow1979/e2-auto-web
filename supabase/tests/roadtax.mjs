import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {runInNewContext} from 'node:vm';
import {roadtaxParts,renderRoadtax,roadtaxPath} from '../../scripts/build-roadtax.mjs';
import {buildVehicleSite} from '../../scripts/build-vehicle-pages.mjs';
import {renderStock} from '../../scripts/build-stock.mjs';
import {vehicleA,vehicleSold} from '../../tests/fixtures/vehicle-pages.mjs';
import {localizedURL} from '../../i18n.mjs';

const root=new URL('../../',import.meta.url),home=await readFile(new URL('index.html',root),'utf8');
const examples=[['pen','sal','ind',1998,379],['pen','sal','co',1998,758],['pen','sal','ind',2494,874],['pen','non','ind',1500,120],['em','sal','ind',1500,72],['lgk','sal','ind',2000,190]];
for(const lang of ['en','ms','zh']){
 const source=await readFile(new URL('templates/roadtax/'+lang+'.html',root),'utf8'),parts=roadtaxParts(source);
 test(lang+': supplied E2RT passes all eight owner acceptance examples',()=>{
  const core=/var E2RT = \([\s\S]*?\n\}\)\(\);/.exec(parts.js)?.[0];assert(core);
  const context={};runInNewContext(core,context,{timeout:1000});
  for(const [region,body,owner,cc,total]of examples)assert.equal(context.E2RT.ice(region,body,owner,cc).total,total);
  assert.equal(context.E2RT.ev(150).total,160);assert.equal(context.E2RT.ev(220).total,305);
 });
 test(lang+': branded shell preserves supplied metadata, script, static rates and FAQ',()=>{
  const html=renderRoadtax(source,home,lang);
  assert(html.includes(parts.metadata));assert(html.includes(parts.js),'Entire supplied calculation/UI script unchanged');
  const tables=source.match(/<table>[\s\S]*?<\/table>/g),faqs=source.match(/<details>[\s\S]*?<\/details>/g);
  assert.equal(tables.length,6);assert.equal(faqs.length,4);
  for(const block of [...tables,...faqs])assert(html.includes(block));
  const prefix=lang==='en'?'':'/'+lang;
  assert(html.includes('href="'+prefix+'/showroom.html#cars"'));
  assert(html.includes('<header class="galleryNav">'));assert(html.includes('<footer class="wrap demoFooter">'));
  assert(html.includes('src="/assets/e2-logo-small.webp"'));assert(html.includes('alt="E2 Auto"'));assert(html.includes('href="'+prefix+'/sales-team.html"'));
  assert.equal((html.match(/<main\b/g)||[]).length,1);assert.equal((html.match(/<h1\b/g)||[]).length,1);
  for(const target of ['en','ms','zh']){
   assert(html.includes('href="'+roadtaxPath(target)+'" data-language="'+target+'"'));
   assert.equal(new URL(localizedURL('https://e2auto.my'+roadtaxPath(lang),target)).pathname,roadtaxPath(target));
  }
 });
}
test('release build retains stock and vehicle routes, adds three calculator pages and discoverable language-correct links',async()=>{
 const rows=[vehicleA,vehicleSold],snapshot={kind:'public-complete',complete:true,expectedCount:rows.length,fetchedAt:new Date().toISOString(),vehicles:rows};
 const out=join(await mkdtemp(join(tmpdir(),'e2-roadtax-')),'site'),manifest=await buildVehicleSite(snapshot,out);
 assert.equal(await readFile(join(out,'stock.txt'),'utf8'),renderStock(rows.filter(v=>v.stock_status!=='Sold'),{maxCharacters:40000,slugs:manifest.slugs,fetchedAt:snapshot.fetchedAt,builtAt:manifest.builtAt,complete:true}));
 const xml=await readFile(join(out,'sitemap.xml'),'utf8');
 for(const lang of ['en','ms','zh']){
  const prefix=lang==='en'?'':lang+'/';
  const html=await readFile(join(out,prefix+'roadtax-calculator/index.html'),'utf8');assert(html.includes('id="rt-form"'));assert(xml.includes('<loc>https://e2auto.my'+roadtaxPath(lang)+'</loc>'));
  for(const file of ['index.html','showroom.html'])assert((await readFile(join(out,prefix+file),'utf8')).includes('href="roadtax-calculator/"'));
  for(const row of rows){
   const path=prefix+'cars/'+manifest.slugs[row.id]+'/',page=await readFile(join(out,path,'index.html'),'utf8');
   assert(page.includes('href="'+roadtaxPath(lang)+'"'));assert(xml.includes('<loc>https://e2auto.my/'+path+'</loc>'));
  }
 }
});
