import {pathToFileURL} from 'node:url';
import {previousFailedAttempt,loadRecoverySnapshot,recoveryMessage} from './stock-recovery.mjs';
const repository='Bennychow1979/e2-auto-web';
export function notificationConfig(env=process.env){
 const token=env.E2AUTO_CHECK_BOT_TOKEN,chatId=env.E2AUTO_CHECK_CHAT_ID;
 if(!/^\d+:[A-Za-z0-9_-]{20,}$/.test(token||'')||! /^-?\d+$/.test(chatId||''))throw Error('Configure E2AUTO_CHECK_BOT_TOKEN and E2AUTO_CHECK_CHAT_ID in GitHub Actions encrypted secrets before stock cutover.');
 return {token,chatId};
}
async function telegram(config,method,body,request){
 try{
  const response=await request('https://api.telegram.org/bot'+config.token+'/'+method,{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const result=await response.json();if(!response.ok||result.ok!==true)throw Error('Rejected');return result.result;
 }catch{throw Error('Telegram notification request failed; check encrypted secrets and bot access. Credentials are not included in this error.');}
}
export async function verifyNotificationTarget(config,{request=fetch}={}){
 const bot=await telegram(config,'getMe',{},request);if(bot.username?.toLowerCase()!=='e2auto_check_bot')throw Error('Configured Telegram bot is not E2auto_check_bot');
 const chat=await telegram(config,'getChat',{chat_id:config.chatId},request);if(String(chat.id)!==config.chatId)throw Error('Telegram destination mismatch');return {bot:'E2auto_check_bot',configured:true};
}
export async function notifyStockFailure(config,{runId,attempt='1',request=fetch}={}){
 if(!/^\d+$/.test(String(runId))||!/^\d+$/.test(String(attempt)))throw Error('Valid GitHub run and attempt are required');
 await verifyNotificationTarget(config,{request});
 const url='https://github.com/'+repository+'/actions/runs/'+runId+'/attempts/'+attempt;
 const text='⚠️ E2 库存发布失败或上线验收未通过\n请先查看失败记录，确认线上快照时间；不要将本次更新视为已成功发布。\n超出文件上限时会停止发布，不会截断或删车凑长度。\n'+url;
 const sent=await telegram(config,'sendMessage',{chat_id:config.chatId,text,disable_web_page_preview:true},request);if(!Number.isSafeInteger(sent.message_id))throw Error('Telegram delivery receipt missing');return {sent:true,messageId:sent.message_id};
}
export async function notifyStockRecovery(config,{runId,attempt,token,directory,receiptPath,request=fetch,githubRequest=fetch,loadSnapshot=loadRecoverySnapshot}={}){
 const failedAttempt=await previousFailedAttempt({runId,attempt,token,request:githubRequest});
 if(failedAttempt===null)return {sent:false,reason:'no-unresolved-failed-attempt'};
 const snapshot=await loadSnapshot(directory,receiptPath);
 await verifyNotificationTarget(config,{request});
 const text=recoveryMessage({runId,attempt,failedAttempt,snapshot});
 const sent=await telegram(config,'sendMessage',{chat_id:config.chatId,text,disable_web_page_preview:true},request);
 if(!Number.isSafeInteger(sent.message_id))throw Error('Telegram delivery receipt missing');
 return {sent:true,messageId:sent.message_id,recoveredAttempt:failedAttempt};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{const config=notificationConfig(),run={runId:process.env.GITHUB_RUN_ID,attempt:process.env.GITHUB_RUN_ATTEMPT};const result=process.argv[2]==='--check'?await verifyNotificationTarget(config):process.argv[2]==='--recovered'?await notifyStockRecovery(config,{...run,token:process.env.GITHUB_TOKEN,directory:process.argv[3],receiptPath:process.argv[4]}):await notifyStockFailure(config,run);console.log(JSON.stringify(result));}
 catch(error){console.error(error.message);process.exitCode=1;}
}
