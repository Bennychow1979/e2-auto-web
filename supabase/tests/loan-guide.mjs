import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {parseApprovedLoan,renderLoanGuide} from '../../scripts/build-loan-guide.mjs';
import {loanGuidePaths} from '../../loan-guide-routes.mjs';
import {localizedURL,escapeHTML as e} from '../../i18n.mjs';
import {buildVehicleSite} from '../../scripts/build-vehicle-pages.mjs';
import {renderStock} from '../../scripts/build-stock.mjs';
import {vehicleA,vehicleSold} from '../../tests/fixtures/vehicle-pages.mjs';
const root=new URL('../../',import.meta.url),source=await readFile(new URL('templates/loan/approved-20261115.md',root),'utf8'),copy=parseApprovedLoan(source),home=await readFile(new URL('index.html',root),'utf8');
for(const [i,lang]of ['ms','en','zh'].entries())test(lang+': approved wording, static content, exact FAQ schema and language-aware actions survive rendering',()=>{
 const c=copy[lang],html=renderLoanGuide(c,home,lang),section=source.replace(/\r\n/g,'\n').split(/\n---\n/)[i+1];
 // Independently check every line/cell from the supplied public copy, not only the parsed object.
 for(const line of section.slice(section.indexOf('\n# ')).trim().split('\n').map(v=>v.trim()).filter(Boolean)){
  if(line.startsWith('|')){if(/^\|[-|]+$/.test(line))continue;for(const cell of line.split('|').slice(1,-1).map(v=>v.trim()))assert(html.includes(e(cell)),cell);}
  else if(line.startsWith('[WhatsApp')){for(const [,label]of line.matchAll(/\[([^\]]+)\]/g))assert(html.includes(e(label)),label);}
  else{const plain=line.replace(/^#{1,2} /,'').replace(/^(?:- |\d+\. )/,'').replace(/^\*\*(.*)\*\*$/,'$1');assert(html.includes(e(plain)),plain);}
 }
 assert(html.includes('<title>'+e(c.title)+'</title>'));assert(html.includes('name="description" content="'+e(c.description)+'"'));
 assert(html.includes('rel="canonical" href="https://e2auto.my'+loanGuidePaths[lang]+'"'));
 assert(html.includes('hreflang="x-default" href="https://e2auto.my'+loanGuidePaths.ms+'"'));
 assert.equal((html.match(/<h1>/g)||[]).length,1);assert.equal((html.match(/<table>/g)||[]).length,1);assert.equal((html.match(/<details>/g)||[]).length,9);
 const faq=JSON.parse(/id="loanFAQ">([^<]*)<\/script>/.exec(html)[1]);assert.equal(faq['@type'],'FAQPage');
 const visible=[...html.matchAll(/<details><summary>(.*?)<\/summary><p>(.*?)<\/p><\/details>/g)].map(([,q,a])=>[q,a]);
 assert.deepEqual(visible,faq.mainEntity.map(v=>[e(v.name),e(v.acceptedAnswer.text)]));
 assert.deepEqual(faq.mainEntity.map(v=>({question:v.name,answer:v.acceptedAnswer.text})),c.faq);
 const prefix=lang==='en'?'':'/'+lang;
 for(const href of ['https://wa.me/60122785126',prefix+'/showroom.html#cars',prefix+'/booking.html','/my-e2.html?lang='+lang])assert(html.includes('href="'+href+'"'));
 for(const target of ['en','ms','zh']){assert(html.includes('href="'+loanGuidePaths[target]+'" data-language="'+target+'"'));assert.equal(new URL(localizedURL('https://e2auto.my'+loanGuidePaths[lang]+'?ref=test#faq',target)).pathname,loanGuidePaths[target]);}
 assert(!html.includes('noindex'));assert(!html.includes('待 Benny 审核'));
});
test('release includes approved guides and translated home/car links without changing stock or vehicle URLs',async()=>{
 const rows=[vehicleA,vehicleSold],snapshot={kind:'public-complete',complete:true,expectedCount:2,fetchedAt:new Date().toISOString(),vehicles:rows},out=join(await mkdtemp(join(tmpdir(),'e2-loan-guide-')),'site');
 const manifest=await buildVehicleSite(snapshot,out),xml=await readFile(join(out,'sitemap.xml'),'utf8');
 assert.equal(await readFile(join(out,'stock.txt'),'utf8'),renderStock(rows,{slugs:manifest.slugs,fetchedAt:snapshot.fetchedAt,builtAt:manifest.builtAt,complete:true}));
 for(const lang of ['en','ms','zh']){
  const prefix=lang==='en'?'':lang+'/';assert(xml.includes('<loc>https://e2auto.my'+loanGuidePaths[lang]+'</loc>'));
  const html=await readFile(join(out,loanGuidePaths[lang].slice(1),'index.html'),'utf8');assert(html.includes('id="loanFAQ"'));
  for(const file of ['index.html','showroom.html'])assert((await readFile(join(out,prefix+file),'utf8')).includes('href="'+loanGuidePaths[lang]+'"'));
  for(const car of rows){const path=prefix+'cars/'+manifest.slugs[car.id]+'/',html=await readFile(join(out,path,'index.html'),'utf8');assert(html.includes('href="'+loanGuidePaths[lang]+'"'));assert(xml.includes('<loc>https://e2auto.my/'+path+'</loc>'));}
 }
});
