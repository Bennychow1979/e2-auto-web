import {readFile} from 'node:fs/promises';
import {join} from 'node:path';

const repository='Bennychow1979/e2-auto-web';
export async function previousFailedAttempt({runId,attempt,token,request=fetch}){
 if(!/^\d+$/.test(String(runId))||!/^\d+$/.test(String(attempt))||!Number.isSafeInteger(Number(attempt))||Number(attempt)<1)throw Error('Valid GitHub run and attempt are required');
 for(let number=Number(attempt)-1;number>=1;number--){
  let run;
  try{
   const response=await request(`https://api.github.com/repos/${repository}/actions/runs/${runId}/attempts/${number}`,{
    redirect:'error',signal:AbortSignal.timeout(15000),headers:{Accept:'application/vnd.github+json',...(token?{Authorization:'Bearer '+token}:{})}
   });
   if(!response.ok)throw Error();run=await response.json();
  }catch{throw Error('Could not verify previous publication attempt; no recovery notification sent.');}
  if(String(run.id)!==String(runId)||run.run_attempt!==number||run.status!=='completed')throw Error('Previous publication attempt is not a matching completed run.');
  // A later success has already resolved earlier failures; do not notify again.
  if(run.conclusion==='success')return null;
  if(run.conclusion==='failure')return number;
 }
 return null;
}

export function recoverySnapshot(stock,receipt,manifest){
 const lines=stock.trim().split(/\r?\n/),header=JSON.parse(lines[0]),end=JSON.parse(lines.at(-1));
 const rows=lines.slice(1,-1).filter(line=>line.trim()&&!line.startsWith('#')).map(line=>JSON.parse(line));
 if(receipt?.published!==true||!receipt.builtAt||receipt.builtAt!==manifest?.builtAt||receipt.builtAt!==header.built_at)throw Error('Recovery requires the successful live publication receipt for this artifact.');
 if(header.format!=='e2-stock-v1'||header.complete!==true||!Number.isFinite(Date.parse(header.snapshot_at))||end.end!=='e2-stock-v1'||end.vehicles!==rows.length||header.vehicles!==rows.length||rows.some(row=>!Array.isArray(row)||row.length!==8))throw Error('Recovery requires a complete stock snapshot.');
 const available=rows.filter(row=>row[5]==='Available').length,reserved=rows.filter(row=>row[5]==='Reserved').length;
 if(available+reserved!==rows.length||header.counts?.Available!==available||header.counts?.Reserved!==reserved)throw Error('Recovery snapshot counts do not match.');
 return {snapshotAt:header.snapshot_at,available,reserved};
}

export async function loadRecoverySnapshot(directory,receiptPath){
 const [stock,receipt,manifest]=await Promise.all([
  readFile(join(directory,'stock.txt'),'utf8'),readFile(receiptPath,'utf8'),readFile(join(directory,'vehicle-pages-manifest.json'),'utf8')
 ]);
 return recoverySnapshot(stock,JSON.parse(receipt),JSON.parse(manifest));
}

export function recoveryMessage({runId,attempt,failedAttempt,snapshot}){
 const time=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kuala_Lumpur',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date(snapshot.snapshotAt));
 return `✅ E2 库存发布已恢复成功\n第 ${failedAttempt} 次失败后，第 ${attempt} 次重跑已成功发布并通过线上验收。\n此前这次运行的失败通知已解除。\n库存快照：${time} MYT\nAvailable：${snapshot.available}｜Reserved：${snapshot.reserved}｜完整清单：是\nhttps://github.com/${repository}/actions/runs/${runId}/attempts/${attempt}`;
}
