import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runInNewContext} from 'node:vm';
import {buildVehicleSite,legacyRedirectScript} from '../../scripts/build-vehicle-pages.mjs';
import {budgets,matchesBudget,categoryRegistry,categoryPath,categoryMatches,relatedAvailable} from '../../vehicle-discovery.mjs';
import {vehicleA,vehicleB} from '../../tests/fixtures/vehicle-pages.mjs';
import {vehiclePath} from '../../vehicle-routes.mjs';
import {renderStock} from '../../scripts/build-stock.mjs';
import {renderCategory,categoryMetadata} from '../../scripts/build-discovery.mjs';

test('budget boundaries have exactly one bucket and old filter values do not silently match',()=>{
 for(const [price,expected] of [[0,0],[29999,0],[30000,1],[49999,1],[50000,2],[79999,2],[80000,3],[300000,3]])assert.deepEqual(budgets.map((b,i)=>matchesBudget(price,b.slug)?i:-1).filter(i=>i>=0),[expected]);
 assert(!matchesBudget(20000,'100000'));assert(!matchesBudget(null,budgets[0].slug));
});
test('related vehicles are available, unique and rank exact model before price alternatives',()=>{
 const sold={...vehicleA,stock_status:'Sold'},same={...vehicleA,id:vehicleB.id,price:100000},near={...vehicleB,id:'cccccccc-1111-4111-8111-111111111111',price:35000};
 assert.deepEqual(relatedAvailable(sold,[sold,same,near,{...near,id:'dddddddd-1111-4111-8111-111111111111',stock_status:'Sold'}]).map(v=>v.id),[same.id,near.id]);
});
test('all six listing HTML documents expose full available links, Sold pages remain, categories persist and stock bytes retain v1 contract',async()=>{
 const sold={...vehicleB,stock_status:'Sold'},rows=[vehicleA,sold],snapshot={kind:'public-complete',complete:true,expectedCount:2,fetchedAt:new Date().toISOString(),vehicles:rows};
 const out=join(await mkdtemp(join(tmpdir(),'e2-discovery-')),'site'),manifest=await buildVehicleSite(snapshot,out);
 for(const lang of ['en','ms','zh']){
  for(const file of ['index.html','showroom.html']){
   const html=await readFile(join(out,lang==='en'?'':lang,file),'utf8'),listing=/<div id="filterResults">([\s\S]*?)\n<\/div>/.exec(html)[1];
   assert.equal((listing.match(/class="rowVehicleLink"/g)||[]).length,1);
   assert(listing.includes('href="'+vehiclePath(vehicleA.id,lang,manifest.slugs)+'"'));
   assert(listing.includes(String(vehicleA.year))&&listing.includes(vehicleA.brand)&&listing.includes(vehicleA.model)&&listing.includes('RM34,990'));
   assert(!listing.includes(vehiclePath(sold.id,lang,manifest.slugs)));
   assert(html.includes('9:30')&&html.includes('6:30'));
   assert.equal((html.match(/<h1 /g)||[]).length,1);
  }
  const soldPage=await readFile(join(out,vehiclePath(sold.id,lang,manifest.slugs).slice(1),'index.html'),'utf8');
  assert(soldPage.includes('https://schema.org/SoldOut'));assert(soldPage.includes('id="discoveryRelated"'));assert(soldPage.includes('href="'+vehiclePath(vehicleA.id,lang,manifest.slugs)+'"'));
  const schema=JSON.parse(/id="vehicleStructuredData" type="application\/ld\+json">([^<]+)</.exec(soldPage)[1]);assert.deepEqual(schema['@type'],['Car','Product']);assert.equal(schema.offers.priceCurrency,'MYR');
  assert(soldPage.includes('"@type":"BreadcrumbList"'));
 }
 assert.equal(await readFile(join(out,'stock.txt'),'utf8'),renderStock(rows,{slugs:manifest.slugs,fetchedAt:snapshot.fetchedAt,builtAt:manifest.builtAt,complete:true}));
 const oldCategory=manifest.categories.find(v=>v.kind==='model'&&categoryMatches(vehicleA,v));
 const changed={...snapshot,vehicles:[{...vehicleA,stock_status:'Sold'},sold]};
 const next=await buildVehicleSite(changed,out);assert(next.categories.some(v=>v.slug===oldCategory.slug));
 for(const lang of ['en','ms','zh']){
  const html=await readFile(join(out,categoryPath(oldCategory.slug,lang).slice(1),'index.html'),'utf8');
  assert(html.includes({en:'Temporarily out of stock',ms:'Stok sementara habis',zh:'暂时没货'}[lang]));assert(html.includes('https://wa.me/60122785126'));
  assert.equal((html.match(/rel="alternate"/g)||[]).length,4);assert(html.includes('rel="canonical" href="https://e2auto.my'+categoryPath(oldCategory.slug,lang)+'"'));
 }
 const retained=categoryRegistry([],[oldCategory]);assert(retained.some(v=>v.slug===oldCategory.slug),'Stateless release retains historical models');
});
test('untrusted inventory labels are escaped in category text and metadata',()=>{
 const row={...vehicleA,brand:'Brand <img onerror=bad>',model:'Model </script><script>bad</script>'},category=categoryRegistry([row]).find(v=>v.kind==='model');
 const html=renderCategory(category,[],'zh',{},[category]);assert(!html.includes('<script>bad'));assert(!html.includes('<img onerror'));assert(html.includes('&lt;img'));
 assert.notEqual(categoryMetadata(category,'zh').title,categoryMetadata(category,'ms').title);
});
test('legacy entry immediately redirects each language, retaining attribution, without redirecting staff previews or unknown IDs',()=>{
 const code=legacyRedirectScript().replace(/^<script[^>]*>|<\/script>$/g,'');
 for(const lang of ['en','ms','zh'])for(const preview of [false,true]){
  let redirected;const nodes=[],route='fixed-slug',location={origin:'https://e2auto.my',pathname:'/'+(lang==='en'?'':lang+'/')+'car.html',search:'?id='+vehicleA.id+'&ref=E2TEST&sales=keep&token=drop'+(preview?'&preview=1':''),hash:'#specs',replace:url=>redirected=url};
  const document={getElementById:()=>({textContent:JSON.stringify({[vehicleA.id]:route})}),createElement:()=>({}),head:{append:n=>nodes.push(n)}};
  runInNewContext(code,{location,document,URL,URLSearchParams});
  if(preview){assert.equal(redirected,undefined);continue;}
  const url=new URL(redirected);assert.equal(url.pathname,'/'+(lang==='en'?'':lang+'/')+'cars/'+route+'/');assert.equal(url.searchParams.get('ref'),'E2TEST');assert.equal(url.searchParams.get('sales'),'keep');assert(!url.searchParams.has('token'));assert.equal(url.hash,'#specs');
 }
});
