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
