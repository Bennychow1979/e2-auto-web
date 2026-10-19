import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHandler,notification} from '../functions/e2-viewing-notify/handler.mjs';
const id='11111111-1111-4111-8111-111111111111';
const job={viewing_id:id,lease_id:id,customer_name:'Test\nName',vehicle_label:'BMW <218>',date:'2026-10-22',time:'10:30:00',salesperson:id,sales_name:'Alex',status:'Requested'};
function setup({jobs=[job],fetchImpl,finish,configured=true,claimDispatch=true}={}){
  const calls={fetch:[],finish:[],claim:0,dispatch:0,sleep:[]};
  const handler=createHandler({botToken:configured?'123:TEST_ONLY_TOKEN':'',channel:'-1001234567890',sleep:async ms=>calls.sleep.push(ms),
    fetchImpl:async(...args)=>{calls.fetch.push(args);return fetchImpl?fetchImpl(...args):Response.json({ok:true,result:{message_id:42}})},
    store:{claimDispatch:async()=>{calls.dispatch++;return claimDispatch},claim:async()=>{calls.claim++;return jobs[calls.claim-1]||null},finish:async(...args)=>{calls.finish.push(args);return finish?finish(...args):true}}
  });
  const request=(headers={},body={dispatch_id:id})=>new Request('https://example.test',{method:'POST',headers:{Authorization:'Bearer e2view_'+'a'.repeat(64),...headers},body:JSON.stringify(body)});
  return {handler,calls,request};
}
test('message includes owner, Malaysia time and a login-protected deep link without phone',()=>{
  const payload=notification({...job,phone:'60123456789'},'-100123');
  assert.match(payload.text,/Assigned Salesman: Alex/);assert.match(payload.text,/Malaysia time/);
  assert.match(payload.text,/Test Name/);assert.doesNotMatch(payload.text,/60123456789/);
  assert.equal(payload.parse_mode,undefined);assert.equal(payload.protect_content,true);
  assert.equal(payload.reply_markup.inline_keyboard[0][0].url,'https://e2auto.my/bookings.html?viewing='+id);
  assert.match(notification({...job,salesperson:null},'-100123').text,/UNASSIGNED/);
});
test('rejects missing auth, browser origin, malformed body and expired capabilities',async()=>{
  const s=setup();assert.equal((await s.handler(s.request({Authorization:''}))).status,401);
  assert.equal((await s.handler(s.request({Origin:'https://e2auto.my'}))).status,403);
  assert.equal((await s.handler(s.request({},{}))).status,400);
  assert.equal(s.calls.claim,0);assert.equal(s.calls.fetch.length,0);
  const used=setup({claimDispatch:false});assert.equal((await used.handler(used.request())).status,403);
  assert.equal(used.calls.claim,0);
});
test('missing credentials do not consume pending jobs',async()=>{
  const s=setup({configured:false});assert.equal((await s.handler(s.request())).status,503);assert.equal(s.calls.claim,0);
});
test('successful delivery records receipt and uses only the fixed Telegram endpoint',async()=>{
  const s=setup();const response=await s.handler(s.request());assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{processed:1});assert.equal(s.calls.fetch.length,1);
  assert.match(s.calls.fetch[0][0],/^https:\/\/api.telegram.org\/bot123:TEST_ONLY_TOKEN\/sendMessage$/);
  assert.deepEqual(s.calls.finish[0][1],{outcome:'sent',telegram_message:42});
});
test('Telegram throttling honors retry_after and stops the batch',async()=>{
  const s=setup({jobs:[job,job],fetchImpl:async()=>Response.json({ok:false,error_code:429,parameters:{retry_after:120}},{status:429})});
  await s.handler(s.request());assert.equal(s.calls.fetch.length,1);
  assert.deepEqual(s.calls.finish[0][1],{outcome:'retry',retry_seconds:120,failure_code:'rate_limit'});
});
test('network timeout and server ambiguity are not automatically resent',async()=>{
  for(const fetchImpl of [async()=>{throw Error('Token secret leaked in an upstream URL')},async()=>Response.json({ok:false},{status:500}),async()=>new Response('bad json')]){
    const s=setup({jobs:[job,job],fetchImpl});const r=await s.handler(s.request());
    assert.equal(s.calls.fetch.length,1);assert.equal(s.calls.finish[0][1].outcome,'uncertain');
    assert.doesNotMatch(await r.text(),/Token|secret|Test Name/);
  }
});
test('permission failure requires attention instead of an infinite retry',async()=>{
  const s=setup({fetchImpl:async()=>Response.json({ok:false,error_code:403},{status:403})});await s.handler(s.request());
  assert.equal(s.calls.finish[0][1].outcome,'failed');
});
test('recording failure never sends again and returns no sensitive error',async()=>{
  const s=setup({finish:async()=>{throw Error('secret and customer')}});const response=await s.handler(s.request());
  assert.equal(response.status,500);assert.equal(s.calls.fetch.length,1);assert.equal(s.calls.finish.length,1);
  assert.doesNotMatch(await response.text(),/secret|customer/);
});
test('closed requests skip obsolete notifications',async()=>{
  const s=setup({jobs:[{...job,status:'Cancelled'},{...job,status:'Completed'}]});await s.handler(s.request());
  assert.equal(s.calls.fetch.length,0);assert.deepEqual(s.calls.finish.map(c=>c[1].outcome),['skipped','skipped']);
});
test('bounded batches and pacing protect the channel',async()=>{
  const s=setup({jobs:Array(20).fill(job)});await s.handler(s.request());
  assert.equal(s.calls.fetch.length,8);assert.equal(s.calls.sleep.length,7);assert(s.calls.sleep.every(ms=>ms>=1000));
});
