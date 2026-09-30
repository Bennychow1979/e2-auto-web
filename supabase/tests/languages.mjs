import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {t,localizedURL,languageFromPath,translateHTML} from '../../i18n.mjs';
import {localizedPage} from '../../scripts/build-languages.mjs';
import {canonicalVehicleURL,vehicleMetadata} from '../../vehicle-seo.mjs';
import {renderSitemap} from '../../scripts/build-sitemap.mjs';
import {publicURL} from '../../advertising-core.js';
import {descriptionFor} from '../../vehicle-translations.mjs';

const id='763ab19c-a414-4651-aa10-076cbefe9ba9';
const url='https://e2auto.my/car.html?id='+id+'&ref=E2BENNY&sales='+id+'&utm_source=fb#finance';
for(const lang of ['en','ms','zh']){
 const result=new URL(localizedURL(url,lang));
 assert.equal(languageFromPath(result.pathname),lang);
 assert.equal(result.search,new URL(url).search);
 assert.equal(result.hash,'#finance');
 assert.equal(new URL(localizedURL('customer.html',lang,result.href)).pathname,'/customer.html');
 assert.equal(new URL(localizedURL('car.html?id='+id,lang,result.href)).pathname,(lang==='en'?'':'/'+lang)+'/car.html');
 assert.equal(localizedURL(localizedURL(url,'zh'),lang),result.href);
 const home=localizedURL('https://e2auto.my/showroom.html?ref=E2BENNY#cars',lang);
 assert.equal(new URL(home).searchParams.get('ref'),'E2BENNY');
 assert.equal(localizedURL('https://wa.me/60122785126',lang),'https://wa.me/60122785126');
 const car={id,publication:'published',year:2019,brand:'Mazda',model:'CX-5'};
 assert.equal(vehicleMetadata(car,{lang}).canonical,canonicalVehicleURL(id,lang));
 assert.equal(vehicleMetadata(car,{lang,preview:true}),null);
 assert(publicURL('https://e2auto.my/'+(lang==='en'?'':lang+'/')+'car.html?id='+id));
 assert(!publicURL('https://e2auto.my/'+(lang==='en'?'':lang+'/')+'car.html?id='+id+'&preview=1'));
 assert(!publicURL('https://e2auto.my/'+(lang==='en'?'':lang+'/')+'customer.html'));
}
assert.equal(t('Show {count} cars',{count:3},'zh'),'显示 3 辆车');
assert.equal(t('Arrange a viewing ↗',{},'ms'),'Atur sesi melihat kereta ↗');
assert.equal(t('7 years',{},'zh'),'7 年');
assert.equal(t('CX-5',{},'zh'),'CX-5');
assert.equal(translateHTML('<script>const label="Finance";</script><p>Finance</p>','zh'),'<script>const label="Finance";</script><p>融资</p>');
assert.equal(descriptionFor('FULL SERVICE RECORD','zh'),'完整保养记录');
assert.equal(descriptionFor('New vehicle description','zh'),'New vehicle description','Never reuse stale translated inventory copy.');
const root=new URL('../../',import.meta.url);
for(const lang of ['ms','zh']){
 for(const file of ['index.html','showroom.html','car.html']){
  const html=localizedPage(readFileSync(new URL(file,root),'utf8'),file,lang);
  assert(html.includes('lang="'+(lang==='zh'?'zh-Hans':'ms')+'"'));
  assert(html.includes('src="../'+(file==='car.html'?'car':'showroom')+'.js?'));
  assert(html.includes('href="../customer.html"'));
  assert(html.includes('aria-current="page">'+(lang==='ms'?'BM':'华语')+'</a>'));
  if(file==='car.html'){
   assert(html.includes('<option value="Morning">'+t('Morning',{},lang)+'</option>'));
   assert(html.includes(t('Please confirm details and condition with E2 before purchase.',{},lang)));
  }else{
   assert(html.includes('<option value="SUV">'+t('SUV',{},lang)+'</option>'));
   assert(html.includes('href="https://e2auto.my/'+lang+'/"'));
   assert(html.includes(t('Partner Login',{},lang)));
   assert(!html.includes('Used cars for KL &amp; Selangor.'));
   for(const alternate of ['en-MY','ms-MY','zh-Hans-MY','x-default'])assert(html.includes('hreflang="'+alternate+'"'));
  }
 }
}
const xml=renderSitemap([{id,publication:'published'},{id,publication:'draft'}]);
assert.equal((xml.match(/<loc>/g)||[]).length,6);
assert.equal((xml.match(/hreflang="zh-Hans-MY"/g)||[]).length,6);
assert(!/[?&](?:amp;)?(?:preview|sales|ref)=/.test(xml));
console.log('Language checks passed: translated HTML, stable option values, routing, referral preservation, canonicals, hreflang, sitemap and private-page exclusion.');
