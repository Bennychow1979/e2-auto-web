import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {canonicalVehicleURL,vehicleMetadata,applyVehicleMetadata,excludeVehicleFromSearch} from '../../vehicle-seo.mjs';
import {renderSitemap,loadPublishedVehicles} from '../../scripts/build-sitemap.mjs';

const id = '763ab19c-a414-4651-aa10-076cbefe9ba9';
const car = {id,publication:'published',year:2019,brand:'Mazda',model:'CX-5',variant:'2.5 High',stock_status:'Available'};
const canonical = 'https://e2auto.my/car.html?id=' + id;
assert.equal(canonicalVehicleURL(id.toUpperCase()),canonical);
assert.throws(()=>canonicalVehicleURL('not-a-car'));
assert.equal(vehicleMetadata(car).title,'2019 Mazda CX-5 2.5 High | E2 Auto Batu Caves');
assert(vehicleMetadata(car).description.includes('Batu Caves, Selangor'));
assert(vehicleMetadata({...car,stock_status:'Sold'}).description.includes('sold'));
assert(vehicleMetadata({...car,stock_status:'Reserved'}).description.includes('reserved'));
assert.equal(vehicleMetadata({...car,publication:'draft'}),null);
assert.equal(vehicleMetadata(car,{preview:true}),null);

function fakeDocument() {
  const nodes=[];
  return {
    nodes,title:'',
    createElement(tag) {
      return {tag,attributes:{},setAttribute(k,v){this.attributes[k]=v},remove(){nodes.splice(nodes.indexOf(this),1)}};
    },
    head:{append(node){nodes.push(node)}},
    querySelector(selector) {
      const [,tag,key,value] = selector.match(/^(\w+)\[(\w+)="([^"]+)"\]$/);
      return nodes.find(n=>n.tag===tag&&n.attributes[key]===value)||null;
    },
  };
}
const doc=fakeDocument();
applyVehicleMetadata(car,{},doc);
applyVehicleMetadata(car,{},doc);
assert.equal(doc.nodes.filter(n=>n.tag==='link').length,1);
assert.equal(doc.querySelector('link[rel="canonical"]').attributes.href,canonical);
assert.equal(doc.querySelector('meta[name="robots"]').attributes.content,'index,follow');
assert.equal(doc.title,vehicleMetadata(car).title);
excludeVehicleFromSearch(doc);
assert.equal(doc.querySelector('meta[name="robots"]').attributes.content,'noindex,nofollow');
assert.equal(doc.querySelector('link[rel="canonical"]'),null);
applyVehicleMetadata(car,{preview:true},doc);
assert.equal(doc.querySelector('meta[name="robots"]').attributes.content,'noindex,nofollow');

const root=new URL('../../',import.meta.url);
const html=readFileSync(new URL('car.html',root),'utf8');
const guard=html.match(/<script id="vehicleSearchPolicy">([\s\S]*?)<\/script>/)[1];
for(const [search,indexable] of [
  ['?id='+id+'&ref=E2PARTNER&sales='+id,true],
  ['?id='+id+'&preview=1',false],['?id=invalid',false],['',false],
]) {
  const document=fakeDocument();
  const robots=document.createElement('meta');
  robots.setAttribute('name','robots');robots.setAttribute('content','index,follow');document.head.append(robots);
  const location={search};
  runInNewContext(guard,{document,location,URLSearchParams});
  assert.equal(document.querySelector('meta[name="robots"]').attributes.content,indexable?'index,follow':'noindex,nofollow');
  assert.equal(location.search,search,'Referral and salesperson parameters must remain in the visitor URL.');
  assert.equal(document.querySelector('link[rel="canonical"]')?.attributes.href,indexable?canonical:undefined);
}
for(const file of ['portal.html','customer.html','partner.html','team.html','documents.html','gallery-demo.html']) {
  assert.match(readFileSync(new URL(file,root),'utf8'),/<meta name="robots" content="noindex,nofollow">/,file+' remains excluded');
}
for(const file of ['index.html','showroom.html']) {
  const source=readFileSync(new URL(file,root),'utf8');
  assert.match(source,/<link rel="canonical" href="https:\/\/e2auto.my\/">/);
  assert.match(source,/<a class="navPartner" href="partner.html">Partner Login<\/a>/);
  assert.equal((source.match(/rel="canonical"/g)||[]).length,1);
  const schema=JSON.parse(source.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  assert.equal(schema['@type'],'AutoDealer');
  assert.equal(schema.address.addressLocality,'Batu Caves');
  assert.equal(schema.telephone,'+60122785126');
}

const sitemap=renderSitemap([car,{...car,id:id.toUpperCase()},{...car,id:'invalid'},
  {...car,id:'00000000-0000-0000-0000-000000000001',publication:'draft'}]);
assert.equal((sitemap.match(/<loc>/g)||[]).length,2);
assert(!sitemap.includes('00000000-0000-0000-0000-000000000001'));
assert(!sitemap.includes('preview=')&&!sitemap.includes('sales=')&&!sitemap.includes('ref='));
assert(!sitemap.includes('<lastmod>'));
assert(renderSitemap([{...car,updated_at:'2026-09-24T07:15:18Z'}]).includes('<lastmod>2026-09-24T07:15:18.000Z</lastmod>'));
assert(!renderSitemap([{...car,updated_at:'invalid'}]).includes('<lastmod>'));

const config={supabaseUrl:'https://example.supabase.co',publishableKey:'sb_publishable_test'};
const requests=[];
const rows=await loadPublishedVehicles(config,async(url,options)=>{
  requests.push({url,options});
  return {ok:true,json:async()=>requests.length===1?Array.from({length:500},()=>car):[car]};
});
assert.equal(rows.length,501);
assert.deepEqual(requests.map(r=>r.url.searchParams.get('offset')),['0','500']);
for(const {url,options} of requests){
  assert.equal(url.searchParams.get('publication'),'eq.published');
  assert.equal(url.searchParams.get('select'),'id,publication,updated_at');
  assert.equal(options.credentials,'omit');
  assert.equal(options.headers.apikey,config.publishableKey);
  assert(!('Authorization' in options.headers));
}
await assert.rejects(loadPublishedVehicles(config,async()=>({ok:false,status:503})),/503/);
await assert.rejects(loadPublishedVehicles(config,async()=>({ok:true,json:async()=>({error:'bad'})})),/Unexpected/);
console.log('SEO checks passed: public indexing, private previews, canonical referral handling, dealer metadata, public-only sitemap and pagination.');
