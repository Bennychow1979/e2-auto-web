import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {calculateCarLoan} from '../car-loan-core.mjs';
import {carLoanPath,carLoanCopy} from '../car-loan-copy.mjs';
import {renderCarLoan} from '../scripts/build-car-loan.mjs';
import {localizedURL} from '../i18n.mjs';
import {buildVehicleSite} from '../scripts/build-vehicle-pages.mjs';
import {vehicleA} from './fixtures/vehicle-pages.mjs';
const home=await readFile(new URL('../index.html',import.meta.url),'utf8');
test('flat interest uses financed principal and years, with no intermediate rounding',()=>{
 const r=calculateCarLoan({price:50000,deposit:5000,rate:3.5,years:7});
 assert.deepEqual(r,{principal:45000,months:84,interest:11025,repayment:56025,monthly:666.9642857142857,total:61025});
 assert.equal(calculateCarLoan({price:100000,deposit:10000,rate:3.5,years:7}).monthly.toFixed(2),'1333.93');
});
test('zero rate, zero deposit and cash purchase do not divide by zero or invent interest',()=>{
 assert.equal(calculateCarLoan({price:12000,deposit:0,rate:0,years:1}).monthly,1000);
 assert.equal(calculateCarLoan({price:50000,deposit:50000,rate:3.5,years:7}).monthly,0);
 assert.equal(calculateCarLoan({price:50000,deposit:50000,rate:3.5,years:7}).total,50000);
});
test('invalid and incomplete values are rejected instead of showing plausible payments',()=>{
 const valid={price:50000,deposit:5000,rate:3.5,years:7};
 for(const patch of [{price:0},{price:-1},{price:10000001},{deposit:-1},{deposit:50001},{rate:-1},{rate:31},{years:0},{years:10},{years:1.5},{price:NaN},{deposit:Infinity},{rate:'3.5'},{years:undefined}])assert.throws(()=>calculateCarLoan({...valid,...patch}),RangeError);
});
for(const lang of ['en','ms','zh'])test(lang+': static content, canonical, language links and local navigation',()=>{
 const html=renderCarLoan(home,lang),c=carLoanCopy[lang];
 assert(html.includes('<h1>'+c.heading+'</h1>'));assert(html.includes('https://e2auto.my'+carLoanPath(lang)));
 assert.equal((html.match(/<h1\b/g)||[]).length,1);assert.equal((html.match(/<main\b/g)||[]).length,1);
 assert.equal((html.match(/<details>/g)||[]).length,3);assert(html.includes(c.formula));
 for(const target of ['en','ms','zh']){
  assert(html.includes('href="'+carLoanPath(target)+'" data-language="'+target+'"'));
  assert.equal(new URL(localizedURL('https://e2auto.my'+carLoanPath(lang),target)).pathname,carLoanPath(target));
 }
 assert(html.includes('/'+(lang==='en'?'':lang+'/')+'showroom.html#cars'));
});
test('complete site build emits calculator pages, three sitemap entries and localized homepage entry beside road tax',async()=>{
 const out=join(await mkdtemp(join(tmpdir(),'e2-car-loan-')),'site');
 await buildVehicleSite({kind:'public-complete',complete:true,expectedCount:1,fetchedAt:new Date().toISOString(),vehicles:[vehicleA]},out);
 const xml=await readFile(join(out,'sitemap.xml'),'utf8');
 for(const lang of ['en','ms','zh']){
  const prefix=lang==='en'?'':lang+'/';
  const page=await readFile(join(out,carLoanPath(lang).slice(1),'index.html'),'utf8');assert(page.includes('id="cl-form"'));
  assert(xml.includes('<loc>https://e2auto.my'+carLoanPath(lang)+'</loc>'));
  for(const name of ['index.html','showroom.html']){
   const html=await readFile(join(out,prefix+name),'utf8');
   assert(html.includes('href="car-loan-calculator/"'));
   assert(html.includes(lang==='ms'?'Kalkulator pinjaman kereta':lang==='zh'?'汽车贷款计算器':'Car loan calculator'));
  }
 }
 for(const file of ['car-loan-calculator.js','car-loan-core.mjs','car-loan-copy.mjs','car-loan-calculator.css'])assert((await readFile(join(out,file))).length>0);
});
