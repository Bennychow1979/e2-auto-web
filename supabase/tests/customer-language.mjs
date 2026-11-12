import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {chooseCustomerLanguage,ct,accountURL} from '../../customer-language.mjs';
import {localizedPage} from '../../scripts/build-languages.mjs';
assert.equal(chooseCustomerLanguage('https://e2auto.my/customer.html?lang=zh','en'),'zh');
assert.equal(chooseCustomerLanguage('https://e2auto.my/customer.html','zh'),'zh','The auth initializer can strip query parameters without losing the preference.');
assert.equal(chooseCustomerLanguage('https://e2auto.my/customer.html?lang=en','zh'),'en','An explicit English choice overrides remembered Chinese.');
assert.equal(chooseCustomerLanguage('https://e2auto.my/customer.html?lang=invalid','ms'),'ms');
assert.equal(chooseCustomerLanguage('https://e2auto.my/customer.html','invalid'),'en');
for(const lang of ['en','ms','zh']){
 const base='https://e2auto.my/'+(lang==='en'?'':lang+'/')+'cars/2020-example/';
 const signIn=new URL(accountURL('/customer.html?mode=register',lang,base));
 assert.equal(signIn.pathname,'/customer.html');assert.equal(signIn.searchParams.get('lang'),lang);assert.equal(signIn.searchParams.get('mode'),'register');
 const saved=new URL(accountURL('saved.html',lang,'https://e2auto.my/customer.html'));
 assert.equal(saved.pathname,'/saved.html');assert.equal(saved.searchParams.get('lang'),lang);
 const car=new URL(accountURL('car.html?id=abc#finance',lang,'https://e2auto.my/saved.html'));
 assert.equal(car.pathname,(lang==='en'?'':'/'+lang)+'/car.html');assert.equal(car.searchParams.get('id'),'abc');assert.equal(car.hash,'#finance');
 assert.equal(accountURL('https://other.example/customer.html',lang,base),'https://other.example/customer.html');
}
assert.equal(ct('Your saved details are ready.',{},'zh'),'已载入你保存的资料。');
assert.equal(ct('Try again in {seconds}s',{seconds:30},'zh'),'30 秒后重试');
assert.equal(ct('{count} saved cars',{count:2},'ms'),'2 kereta disimpan');
assert.equal(ct('Remove {car} from saved cars',{car:'Honda CITY'},'zh'),'取消收藏 Honda CITY');
assert.equal(ct('Unrecognised backend detail',{},'zh'),'Unrecognised backend detail');
for(const file of ['index.html','showroom.html','car.html','sales-team.html']){
 const source=readFileSync(new URL('../../'+file,import.meta.url),'utf8');
 for(const lang of ['ms','zh']){
  const html=localizedPage(source,file,lang);
  assert(html.includes('customer.html?lang='+lang));
  if(file==='index.html'||file==='showroom.html')assert(html.includes('customer.html?mode=register&amp;lang='+lang));
 }
}
console.log('Customer language checks passed: explicit choice, post-login persistence, register mode, saved-car links and translated messages.');
