import test from 'node:test';
import assert from 'node:assert/strict';
import {notificationConfig,verifyNotificationTarget,notifyStockFailure} from '../../scripts/notify-stock-publication.mjs';
const config={token:'123456789:syntheticTokenForOfflineTests',chatId:'123'};
test('configuration is required and errors never print credentials',()=>{assert.throws(()=>notificationConfig({}),/encrypted secrets/);assert.deepEqual(notificationConfig({E2AUTO_CHECK_BOT_TOKEN:config.token,E2AUTO_CHECK_CHAT_ID:config.chatId}),config);});
test('read-only preflight verifies exact bot and destination without sending or polling messages',async()=>{
 const seen=[];assert.deepEqual(await verifyNotificationTarget(config,{request:async(url,options)=>{const method=url.split('/').at(-1);seen.push(method);assert.equal(options.redirect,'error');return new Response(JSON.stringify({ok:true,result:method==='getMe'?{username:'E2auto_check_bot'}:{id:123}}));}}),{bot:'E2auto_check_bot',configured:true});assert.deepEqual(seen,['getMe','getChat']);
});
test('failure alert carries only a public run link and requires a Telegram delivery receipt',async()=>{
 const messages=[];const result=await notifyStockFailure(config,{runId:'12345',attempt:'2',request:async(url,options)=>{const method=url.split('/').at(-1),body=JSON.parse(options.body);if(method==='sendMessage')messages.push(body);return new Response(JSON.stringify({ok:true,result:method==='getMe'?{username:'E2auto_check_bot'}:method==='getChat'?{id:123}:{message_id:987}}));}});
 assert.deepEqual(result,{sent:true,messageId:987});assert.equal(messages.length,1);assert.equal(messages[0].chat_id,'123');assert(messages[0].text.includes('/actions/runs/12345/attempts/2'));assert(!messages[0].text.includes(config.token));assert(!messages[0].text.includes('已成功发布\n'));
});
test('wrong bot and provider failure cannot silently report delivery or expose token',async()=>{
 await assert.rejects(verifyNotificationTarget(config,{request:async()=>new Response(JSON.stringify({ok:true,result:{username:'another_bot'}}))}),/not E2auto_check_bot/);
 await assert.rejects(notifyStockFailure(config,{runId:'123',request:async()=>{throw Error(config.token);}}),e=>!e.message.includes(config.token)&&e.message.includes('failed'));
});

import {notifyStockRecovery} from '../../scripts/notify-stock-publication.mjs';
import {previousFailedAttempt,recoverySnapshot} from '../../scripts/stock-recovery.mjs';
const builtAt='2026-11-26T16:06:31.361Z',snapshotAt='2026-11-26T16:06:30.298Z';
function completeStock(){return [JSON.stringify({format:'e2-stock-v1',snapshot_at:snapshotAt,built_at:builtAt,complete:true,vehicles:1,counts:{Available:1,Reserved:0}}),'# public data',JSON.stringify([2020,'Honda','City',null,'TEST123','Available',30000,'https://e2auto.my/cars/test/']),JSON.stringify({end:'e2-stock-v1',vehicles:1})].join('\n');}
function attemptResponse(number,conclusion='failure'){return new Response(JSON.stringify({id:12345,run_attempt:number,status:'completed',conclusion}));}
const receipt={published:true,builtAt},manifest={builtAt};
test('first publication and a rerun of a successful attempt never send recovery',async()=>{
 const forbidden=()=>{throw Error('must not call');};
 assert.deepEqual(await notifyStockRecovery(config,{runId:'12345',attempt:'1',request:forbidden,githubRequest:forbidden,loadSnapshot:forbidden}),{sent:false,reason:'no-unresolved-failed-attempt'});
 assert.equal(await previousFailedAttempt({runId:'12345',attempt:'3',request:async()=>attemptResponse(2,'success')}),null);
});
test('matching failed history is required; cancellations and bad API responses are not assumed failures',async()=>{
 assert.equal(await previousFailedAttempt({runId:'12345',attempt:'2',request:async()=>attemptResponse(1,'cancelled')}),null);
 assert.equal(await previousFailedAttempt({runId:'12345',attempt:'3',request:async url=>url.endsWith('/2')?attemptResponse(2,'cancelled'):attemptResponse(1)}),1);
 await assert.rejects(previousFailedAttempt({runId:'12345',attempt:'2',token:'secret',request:async()=>{throw Error('secret');}}),e=>!e.message.includes('secret')&&e.message.includes('Could not verify'));
 await assert.rejects(previousFailedAttempt({runId:'12345',attempt:'2',request:async()=>attemptResponse(5)}),/matching completed/);
});
test('recovery requires a matching live receipt and complete counted stock',()=>{
 assert.deepEqual(recoverySnapshot(completeStock(),receipt,manifest),{snapshotAt,available:1,reserved:0});
 for(const badReceipt of [{published:false,builtAt},{published:true,builtAt:'stale'},{}])assert.throws(()=>recoverySnapshot(completeStock(),badReceipt,manifest),/successful live/);
 assert.throws(()=>recoverySnapshot(completeStock().replace('"complete":true','"complete":false'),receipt,manifest),/complete stock/);
 assert.throws(()=>recoverySnapshot(completeStock().replace('"Available":1','"Available":2'),receipt,manifest),/counts/);
 assert.throws(()=>recoverySnapshot(completeStock().split('\n').slice(0,-1).join('\n'),receipt,manifest),/complete stock/);
});
test('recovered notification includes MYT snapshot, counts and successful attempt without secrets',async()=>{
 const messages=[];
 const result=await notifyStockRecovery(config,{runId:'12345',attempt:'2',githubRequest:async()=>attemptResponse(1),loadSnapshot:async()=>recoverySnapshot(completeStock(),receipt,manifest),request:async(url,options)=>{
  const method=url.split('/').at(-1);if(method==='sendMessage')messages.push(JSON.parse(options.body));
  return new Response(JSON.stringify({ok:true,result:method==='getMe'?{username:'E2auto_check_bot'}:method==='getChat'?{id:123}:{message_id:988}}));
 }});
 assert.deepEqual(result,{sent:true,messageId:988,recoveredAttempt:1});assert.equal(messages.length,1);
 const text=messages[0].text;assert.match(text,/已恢复成功/);assert.match(text,/27\/11\/2026, 00:06:30 MYT/);assert.match(text,/Available：1/);assert.match(text,/attempts\/2/);assert(!text.includes(config.token));
});
test('failed live validation prevents any Telegram request; uncertain delivery is never resent automatically',async()=>{
 const args={runId:'12345',attempt:'2',githubRequest:async()=>attemptResponse(1)};
 await assert.rejects(notifyStockRecovery(config,{...args,loadSnapshot:async()=>{throw Error('bad receipt');},request:()=>{throw Error('must not send');}}),/bad receipt/);
 let sends=0;
 await assert.rejects(notifyStockRecovery(config,{...args,loadSnapshot:async()=>recoverySnapshot(completeStock(),receipt,manifest),request:async(url)=>{
  const method=url.split('/').at(-1);if(method==='sendMessage'){sends++;throw Error(config.token);}
  return new Response(JSON.stringify({ok:true,result:method==='getMe'?{username:'E2auto_check_bot'}:{id:123}}));
 }}),e=>!e.message.includes(config.token));assert.equal(sends,1);
});
