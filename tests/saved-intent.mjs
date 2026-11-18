import assert from 'node:assert/strict';
import {test} from 'node:test';
import {rememberSave,pendingSave,captureSave,saveReturnURL,clearSave,bindSave} from '../saved-intent.js';
const id='11111111-1111-4111-8111-111111111111';
test('email return only carries a fresh UUID and timestamp to same-origin account pages',()=>{
 globalThis.location={href:'https://e2auto.my/customer.html?lang=zh#access_token=secret'};
 const values=new Map();globalThis.sessionStorage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
 rememberSave(id);const link=new URL(saveReturnURL('/customer.html?lang=zh'));
 assert.equal(link.searchParams.get('save'),id);assert.equal(link.hash,'');assert.equal(link.searchParams.has('email'),false);
 assert.equal(saveReturnURL('https://other.test/customer.html'),'https://other.test/customer.html');
 assert.equal(saveReturnURL('/portal.html'),'https://e2auto.my/portal.html');
 clearSave();assert.equal(captureSave(link.search),id);bindSave('customer-A');assert.equal(pendingSave('customer-A'),id);assert.equal(pendingSave('customer-B'),null);
 clearSave();for(const [car,at] of [[id,Date.now()-86400001],[id,Date.now()+60000],['<script>',Date.now()],[id,'NaN']])assert.equal(captureSave(new URLSearchParams({save:car,save_at:at})),null);
 assert.equal(pendingSave(),null);
});
test('blocked browser storage still carries intent through navigation; failed saves can retry',()=>{
 globalThis.sessionStorage={getItem:()=>{throw Error('blocked')},setItem:()=>{throw Error('blocked')},removeItem:()=>{throw Error('blocked')}};
 rememberSave(id);const link=saveReturnURL('/saved.html?lang=ms');assert.equal(new URL(link).searchParams.get('save'),id);
 clearSave('different-id');assert.equal(pendingSave(),id);clearSave(id);assert.equal(pendingSave(),null);
 captureSave(new URL(link).search);assert.equal(pendingSave(),id);clearSave();
});
