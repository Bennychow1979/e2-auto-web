// Simulation only. No Telegram SDK, credentials, external network or delivery worker.
import {runnerMessage} from '../../runner-message.mjs';
export function notificationPreview({now=()=>Date.now(),runnerRoles={}}={}){
 let offset=0;
 const jobs=new Map(),messages=new Map();
 const clock=()=>now()+offset;
 function sync(rows){
  for(const row of rows){
   const old=jobs.get(row.id),version=row.dispatch_version;
   if(old&&old.dispatch_version!==version)for(const m of messages.values())if(m.job_id===row.id)m.resolved=true;
   const job={...row,previewDispatchedAt:old?.dispatch_version===version?old.previewDispatchedAt:clock()};
   jobs.set(row.id,job);
   const key=`${job.id}:${version}:assignment`;
   if(!messages.has(key))messages.set(key,{id:key,job_id:job.id,dispatch_version:version,kind:'assignment',recipient:job.assigned_to,recipient_name:job.runner_name,created_at:new Date(clock()).toISOString(),resolved:false,
    text:runnerMessage(job),
    url:`/operations.html?previewRole=${runnerRoles[job.assigned_to]||'runner'}&job=${encodeURIComponent(job.id)}`});
   if(job.accepted_at||job.status!=='assigned')for(const m of messages.values())if(m.job_id===job.id)m.resolved=true;
  }
  tick();
 }
 function tick(){
  for(const j of jobs.values()){
   if(j.accepted_at||j.status!=='assigned'||clock()-j.previewDispatchedAt<15*60000)continue;
   const key=`${j.id}:${j.dispatch_version}:overdue`;
   if(!messages.has(key))messages.set(key,{id:key,job_id:j.id,dispatch_version:j.dispatch_version,kind:'overdue',recipient:'admin',recipient_name:'Admin',created_at:new Date(clock()).toISOString(),resolved:false,
    text:`15 minutes without acceptance / 超过15分钟未接单\n${j.plate} · ${j.runner_name}\n${j.origin} → ${j.destination}\nPlease follow up with the Runner. / 请联系 Runner 跟进。`,
    url:`/operations.html?previewRole=admin&job=${encodeURIComponent(j.id)}`});
  }
 }
 return {
  sync,
  advance(){offset+=15*60000;tick();},
  view(role,user){tick();const admin=['admin','super_admin'].includes(role);return {mode:'simulation',now:new Date(clock()).toISOString(),messages:[...messages.values()].filter(m=>admin||role==='account'&&m.kind==='assignment'||role==='runner'&&m.recipient===user&&jobs.get(m.job_id)?.assigned_to===user&&jobs.get(m.job_id)?.dispatch_version===m.dispatch_version).sort((a,b)=>b.created_at.localeCompare(a.created_at))};}
 };
}
