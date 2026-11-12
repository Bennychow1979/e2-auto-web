import {test} from 'node:test';import assert from 'node:assert/strict';
import {ct,accountURL,customerSwitchURL,chooseCustomerLanguage} from '../../customer-language.mjs';
import {flowTranslations} from '../../customer-flow-translations.mjs';
import {privacyTranslations} from '../../customer-privacy-translations.mjs';
import {renderStep,renderReview,esc} from '../../loan-ui.js';
import {sections} from '../../loan-fields.js';
import {loanRoute} from '../../loan-intent.js';
const id='11111111-1111-4111-8111-111111111111';
globalThis.location={href:'https://e2auto.my/my-e2.html?lang=zh',pathname:'/my-e2.html'};
const {flowHTML,documentHint,documentProgress,documentNotice,documentSummary,ft}=await import('../../customer-flow-language.mjs');
test('every new message and complete privacy paragraph has both translations',()=>{
 for(const [key,value]of Object.entries({...flowTranslations,...privacyTranslations})){
  assert.equal(value.length,2,key);assert(value.every(v=>typeof v==='string'&&v.trim()),key);
  for(const lang of ['ms','zh']){
   const translated=ct(key,{},lang);assert(!translated.includes('undefined'),key);
   assert.deepEqual([...translated.matchAll(/\{\w+\}/g)].map(x=>x[0]).sort(),[...key.matchAll(/\{\w+\}/g)].map(x=>x[0]).sort(),`${key}: placeholders preserved`);
  }
 }
});
test('all customer page links preserve application context and language without auth fragments',()=>{
 for(const lang of ['en','ms','zh'])for(const page of ['my-e2','documents','intake','loan-privacy','customer-privacy','intake-privacy','customer','saved']){
  const link=new URL(accountURL(`${page}.html?application=${id}`,lang));assert.equal(link.searchParams.get('lang'),lang);assert.equal(link.searchParams.get('application'),id);
 }
 const switchURL=new URL(customerSwitchURL(`https://e2auto.my/documents.html?application=${id}&staff=1&access_token=secret#refresh_token=secret`,'ms'));
 assert.equal(switchURL.searchParams.get('application'),id);assert.equal(switchURL.searchParams.get('staff'),'1');assert.equal(switchURL.searchParams.get('access_token'),null);assert.equal(switchURL.hash,'');
 assert.equal(new URL(customerSwitchURL(`https://e2auto.my/intake.html?invite=${id}&code=secret`,'zh')).search,`?lang=zh&invite=${id}`);
 assert.equal(new URL(customerSwitchURL('https://e2auto.my/customer.html?mode=register&code=secret','zh')).search,'?lang=zh&mode=register');
 assert.equal(loanRoute(`?application=${id}&lang=zh&redirect=https://evil.example`),`my-e2.html?application=${id}&lang=zh`);
 assert.equal(chooseCustomerLanguage('https://e2auto.my/documents.html?lang=ms','zh'),'ms');
});
test('loan option labels translate while submitted values and customer text stay unchanged',()=>{
 for(const lang of ['en','ms','zh']){
  const translate=(s,v)=>ct(s,v,lang),details={name:'Single',company:'Draft',address:'Address',marital:'Married',guarantor:'Yes',credit:'Yes',debt:'123',g_name:'Not provided'};
  for(let step=0;step<6;step++){
   const html=renderStep(step,details,55000,translate);
   for(const [key,label,sub,type]of sections(details)[step])if(Array.isArray(type))for(const option of type)assert(html.includes(`value="${esc(option)}"`),`${lang} ${key} ${option}`);
  }
  const html=renderStep(1,details,55000,translate);assert(html.includes('value="Single"'));assert(html.includes(`value="Married" selected>${esc(translate('Married'))}`));
  const review=renderReview(details,{translate});for(const raw of ['Single','Draft','Address','Not provided'])assert(review.includes(`<dd>${raw}</dd>`));
  assert(review.includes(`<dd>${translate('Married')}</dd>`));assert(!review.includes('<dd>undefined</dd>'));
 }
});
test('trusted HTML translations never translate interpolated data or change control values',()=>{
 // The query-qualified module uses the explicit Chinese page locale.
 const html=flowHTML`<p>Saved cars</p><strong>${esc('Draft')}</strong><input value="${esc('Single')}"><a href="documents.html?application=${id}">Upload documents ↗</a>`;
 assert(html.includes('收藏'));assert(html.includes('<strong>Draft</strong>'));assert(html.includes('value="Single"'));assert(html.includes('lang=zh'));assert(html.includes(id));
 const hostile=flowHTML`<p>${esc('<img src=x onerror=alert(1)>')}</p>`;assert(!hostile.includes('<img'));assert(hostile.includes('&lt;img'));
 assert.equal(ft('Complete: name'),'请填写：姓名');
});
test('file months and institution names remain exact while progress and requirements translate',()=>{
 const date=new Date(2026,10,13),item={key:'bank_statement',label:'Bank statements / transaction history',months:2,includeCurrentMonth:true};
 const rows=[{category:item.key,state:'ready',covered_months:['2026-11']}];
 assert.match(documentProgress(item,rows,date),/1／2/);assert.match(documentProgress(item,rows,date),/2026-10/);
 assert.equal(documentHint('Latest 3 months'),'最近 3 个月');
 assert.match(documentHint('Latest 3 months including the current month · show salary credited to your personal bank account'),/薪资/);
 assert.match(documentNotice({status:'selected',institution:'DEMO Bank'}),/DEMO Bank/);
 assert.match(documentSummary([item],[],{status:'selected',selected_at:date.toISOString()}),/银行结单／交易记录/);
});
