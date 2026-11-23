import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHandler, normalizePhone} from '../functions/verify-viewing-contact/handler.mjs';

const ref = '11111111-1111-4111-8111-111111111111';
const key = 'synthetic-test-key-never-used-in-production';
const result = {found:true, match:true, already_verified:false, vehicle_label:'Test car', preferred_date:'2026-11-23'};
function setup({secret=key, allowed=true, verifyResult=result, fail=false}={}) {
  const calls = {rate:0, verify:[]};
  const handler = createHandler({key:secret, store:{
    takeRateSlot:async () => {calls.rate++; if (fail) throw Error('private details'); return allowed;},
    verify:async (...args) => {calls.verify.push(args); return verifyResult;}
  }});
  const request = (body={ref, phone:'+60 12-387 1066'}, headers={}, method='POST') => new Request('https://example.test', {
    method, headers:{'content-type':'application/json', 'x-e2-verify-key':key, ...headers},
    ...(!['GET','HEAD'].includes(method) ? {body:typeof body === 'string' ? body : JSON.stringify(body)} : {})
  });
  return {calls, handler, request};
}

test('dedicated header is mandatory; empty configuration always fails closed', async () => {
  const s=setup();
  for (const wrong of ['', 'wrong', key+'x', key.slice(0,-1)]) {
    const response=await s.handler(s.request(undefined, {'x-e2-verify-key':wrong, Authorization:'Bearer '+key}));
    assert.equal(response.status,401); assert.deepEqual(await response.json(),{found:false});
  }
  assert.equal(s.calls.rate,0); assert.equal(s.calls.verify.length,0);
  const unset=setup({secret:''});assert.equal((await unset.handler(unset.request())).status,401);
});
test('normalizes the full phone and returns only the permitted fields', async () => {
  assert.equal(normalizePhone('012-387 1066'),'60123871066');
  assert.equal(normalizePhone('+60 12 387 1066'),'60123871066');
  const s=setup({verifyResult:{...result, customer_name:'DO NOT EXPOSE', phone:'60123871066', secret:'private', form_last4:'1066'}});
  const response=await s.handler(s.request());
  assert.equal(response.status,200);assert.deepEqual(await response.json(),result);
  assert.deepEqual(s.calls.verify,[[ref,'60123871066']]);
  assert.equal(response.headers.get('cache-control'),'no-store');
  assert.equal(response.headers.get('access-control-allow-origin'),null);
});
test('mismatch returns only the form last four; missing results have no metadata', async () => {
  const mismatch={...result,match:false,form_last4:'6789'};
  const s=setup({verifyResult:{...mismatch, phone:'secret'}});
  assert.deepEqual(await (await s.handler(s.request())).json(),mismatch);
  const missing=setup({verifyResult:{found:false, vehicle_label:'hidden', phone:'secret'}});
  assert.deepEqual(await (await missing.handler(missing.request())).json(),{found:false});
});
test('rejects browser calls and preflights without any CORS headers', async () => {
  const s=setup();
  for (const [method, headers, expected] of [['POST',{Origin:'https://e2auto.my'},403],['OPTIONS',{},405],['GET',{},405]]) {
    const response=await s.handler(s.request(undefined,headers,method));assert.equal(response.status,expected);
    for (const name of response.headers.keys()) assert.ok(!name.startsWith('access-control-'));
  }
  assert.equal(s.calls.verify.length,0);
});
test('valid auth consumes global quota before parsing; denial and database failures fail closed', async () => {
  const s=setup({allowed:false});const response=await s.handler(s.request());
  assert.equal(response.status,429);assert.equal(response.headers.get('retry-after'),'60');assert.equal(s.calls.verify.length,0);
  const failed=setup({fail:true});const r=await failed.handler(failed.request());
  assert.equal(r.status,503);assert.deepEqual(await r.json(),{found:false});
});
test('invalid UUID, phone, JSON and oversized bodies cannot reach verification', async () => {
  const s=setup();
  for (const body of [{ref:'bad',phone:'0123871066'},{ref,phone:123},{ref,phone:''},{ref,phone:'0'},null,'{bad','x'.repeat(2049)]) {
    assert.equal((await s.handler(s.request(body))).status,400);
  }
  assert.equal((await s.handler(s.request(undefined,{'content-type':'text/plain'}))).status,400);
  assert.equal(s.calls.verify.length,0);assert.equal(s.calls.rate,8);
});
test('a chunked request cannot bypass the body limit', async () => {
  const s=setup();
  const request=new Request('https://example.test',{method:'POST',headers:{'x-e2-verify-key':key,'content-type':'application/json'},duplex:'half',
    body:new ReadableStream({start(c){c.enqueue(new Uint8Array(1024));c.enqueue(new Uint8Array(1025));c.close();}})});
  assert.equal((await s.handler(request)).status,400);assert.equal(s.calls.verify.length,0);
});
test('malformed database output fails closed without private error details', async () => {
  const s=setup({verifyResult:{...result,match:false,form_last4:'60123456789'}});
  const response=await s.handler(s.request());assert.equal(response.status,503);assert.deepEqual(await response.json(),{found:false});
});
