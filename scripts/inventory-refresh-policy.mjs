// Pure planning only: no network, scheduler, webhook, Notion or inventory writes.
export function refreshPolicy({mode='manual',backupMinutes=1440,debounceSeconds=30,targetMinutes=10}={}){
 if(!['manual','scheduled','events-with-backup'].includes(mode))throw Error('Unknown refresh policy.');
 if(!Number.isInteger(backupMinutes)||backupMinutes<60||backupMinutes>1440||!Number.isInteger(debounceSeconds)||debounceSeconds<0||debounceSeconds>300||!Number.isInteger(targetMinutes)||targetMinutes<1||targetMinutes>2880)throw Error('Invalid refresh interval.');
 return Object.freeze({mode,backupMs:backupMinutes*60000,debounceMs:debounceSeconds*1000,targetMs:targetMinutes*60000,enabled:false});
}
export function createRefreshPlanner(policy=refreshPolicy(),saved=null){
 let sequence=0,pending=null,lastDeployed=null,lastFailure=null,inFlight=null,lastObserved=-1,lastReconciled=null,attempt=0;
 if(saved){
  if(saved.version!==1||!Number.isSafeInteger(saved.sequence)||saved.sequence<0||!Number.isSafeInteger(saved.lastObserved)||saved.lastObserved< -1||!Number.isSafeInteger(saved.attempt)||saved.attempt<0)throw Error('Invalid planner checkpoint.');
  for(const key of ['lastDeployed','lastFailure','lastReconciled'])if(saved[key]!==null&&(!Number.isFinite(saved[key])||saved[key]<0))throw Error('Invalid checkpoint time.');
  if(saved.pending&&(!Number.isSafeInteger(saved.pending.generation)||saved.pending.generation!==saved.sequence||!Number.isFinite(saved.pending.firstAt)||!Number.isFinite(saved.pending.latestAt)||saved.pending.firstAt<0||saved.pending.latestAt<saved.pending.firstAt))throw Error('Invalid pending checkpoint.');
  if(saved.inFlight&&(!Number.isSafeInteger(saved.inFlight.jobId)||saved.inFlight.jobId<1||saved.inFlight.jobId>saved.attempt||!Number.isSafeInteger(saved.inFlight.generation)||saved.inFlight.generation<0||saved.inFlight.generation>saved.sequence||!Number.isFinite(saved.inFlight.startedAt)||saved.inFlight.startedAt<0||typeof saved.inFlight.reconcile!=='boolean'))throw Error('Invalid build checkpoint.');
  ({sequence,pending,lastDeployed,lastFailure,inFlight,lastObserved,lastReconciled,attempt}=structuredClone(saved));
 }
 const freshness=now=>{
  const reason=lastFailure!==null?'build-failed':lastDeployed===null?'no-confirmed-deployment':pending?'inventory-change-pending':policy.mode!=='manual'&&(lastReconciled===null||now-lastReconciled>=policy.backupMs)?'reconcile-overdue':'current';
  return {state:reason==='current'?'current':'stale',reason,lastSuccessfulDeploymentAt:lastDeployed,lastSuccessfulReconcileAt:lastReconciled,preservePrevious:true};
 };
 return {
  // Revision is a trustworthy source sequence, never a browser timestamp or
  // a requested stock status. Every build rereads the full published projection.
  observe({revision,at,committed}){if(!Number.isSafeInteger(revision)||revision<0||!Number.isFinite(at)||at<0)throw Error('Invalid source event.');if(committed!==true||revision<=lastObserved)return false;lastObserved=revision;sequence++;pending={generation:sequence,firstAt:pending?Math.min(pending.firstAt,at):at,latestAt:pending?Math.max(pending.latestAt,at):at};return true},
  plan(now,{manual=false}={}){
   if(!Number.isFinite(now))throw Error('Invalid planning time.');
   const overdue=!!pending&&now-pending.firstAt>policy.targetMs;
   if(inFlight)return {action:'wait',reason:'build-in-flight',overdue};
   const eventDue=policy.mode==='events-with-backup'&&pending&&now>=Math.min(pending.latestAt+policy.debounceMs,pending.firstAt+policy.debounceMs);
   const backupDue=policy.mode!=='manual'&&(lastReconciled===null||now-lastReconciled>=policy.backupMs);
   if(!manual&&!eventDue&&!backupDue)return {action:'wait',reason:pending?'awaiting-policy':'current',overdue};
   inFlight={jobId:++attempt,generation:sequence,startedAt:now,reconcile:backupDue};
   return {action:'build-candidate',reason:manual?'manual':eventDue?'event':'backup',jobId:attempt,generation:sequence,overdue,requiresFreshPublicSnapshot:true,requiresPredeploySnapshotCheck:true,mayDeploy:false};
  },
  complete({jobId,generation,at,success,deployed=false,projectionCurrent=false}){
   if(!inFlight||jobId!==inFlight.jobId||generation!==inFlight.generation)throw Error('Unknown build completion.');
   if(!Number.isFinite(at)||at<inFlight.startedAt||typeof success!=='boolean'||typeof deployed!=='boolean'||typeof projectionCurrent!=='boolean'||(deployed&&!success))throw Error('Invalid build result.');
   const obsolete=generation!==sequence,reconcile=inFlight.reconcile;inFlight=null;
   if(!success){lastFailure=at;return {accepted:false,reason:'failed',preservePrevious:true}}
   if(obsolete)return {accepted:false,reason:'newer-event',preservePrevious:true};
   if(deployed&&!projectionCurrent){lastFailure=at;return {accepted:false,reason:'projection-changed',preservePrevious:true};}
   // A passing candidate is not evidence of a deployment or inventory write.
   if(deployed){lastDeployed=at;pending=null;lastFailure=null;if(reconcile)lastReconciled=at;}
   return {accepted:true,deployed,inventoryMutated:false};
  },
  status(now=Date.now()){if(!Number.isFinite(now)||now<0)throw Error('Invalid status time.');return {sequence,pending:pending?{...pending}:null,lastDeployed,lastFailure,lastReconciled,inFlight:inFlight?{...inFlight}:null,freshness:freshness(now)}},
  checkpoint(){return structuredClone({version:1,sequence,pending,lastDeployed,lastFailure,inFlight,lastObserved,lastReconciled,attempt})}
 };
}
