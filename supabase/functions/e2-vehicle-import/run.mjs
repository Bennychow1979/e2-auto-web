import {createHash} from 'node:crypto';
import {normalizePlate} from '../e2-drive-photos/core.mjs';
import {MASTERLIST,VERSION,period,folderPlate,sourceRows,makePlan} from './plan.mjs';
export const fingerprint=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

// All network/storage boundaries are injected so the complete workflow is testable offline.
export async function runImport({drive,store,loadWorkbook,root,actor,now=new Date(),retry=false}) {
  const result={created:[],blocked:[],existing:0,unchanged:0,remaining:0};
  try {
  const when=period(now),folders=(await drive.list(root)).filter(f=>f.mimeType==='application/vnd.google-apps.folder'&&!f.trashed&&f.parents?.includes(root));
  const inventory=await store.inventory(),existing=new Set(inventory.map(c=>normalizePlate(c.plate))),jobs=await store.jobs();
  const pending=folders.filter(f=>{
    if(existing.has(folderPlate(f.name))){result.existing++;return false}
    // Completed folders stay completed, even after a folder rename or a vehicle's plate edit.
    if(jobs.get(f.id)?.status==='completed'){result.unchanged++;return false}
    return true;
  });
  if(!pending.length)return result;
  // Read workbook metadata only until a changed candidate requires its actual rows.
  const source=await drive.metadata(MASTERLIST);
  if(source.trashed||source.mimeType!=='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'||!source.md5Checksum)
    throw Error('MASTERLIST must be the original readable XLSX file.');
  const sourceKey=fingerprint([VERSION,when,source.md5Checksum,source.version]);
  const candidates=[];
  for(const folder of pending) {
    const old=jobs.get(folder.id);
    // Child metadata must be compared: a folder's own timestamp does not track photo edits.
    let files;
    try{files=await drive.list(folder.id)}catch{throw Error('Vehicle photo folders are unavailable. Check Drive access.')}
    const stamp=fingerprint([sourceKey,folder.name,files.map(f=>[f.id,f.name,f.md5Checksum,f.size,f.mimeType,f.capabilities?.canDownload,f.trashed]).sort((a,b)=>a[0].localeCompare(b[0]))]);
    if(!retry&&old?.fingerprint===stamp&&old.status==='blocked'){result.unchanged++;continue}
    candidates.push({folder,files,stamp,old});
  }
  if(!candidates.length)return result;
  const workbook=await loadWorkbook(await drive.workbook(MASTERLIST,source.md5Checksum));
  const rows=sourceRows(workbook,when,new Set(candidates.map(c=>folderPlate(c.folder.name)).filter(Boolean)));
  // Keep each request bounded; the portal continues batches without AI/browser photo inspection.
  for(const {folder,files,stamp,old} of candidates.slice(0,3)) {
    let plan;
    try {
      if(folders.filter(f=>folderPlate(f.name)===folderPlate(folder.name)).length>1)throw Error('Multiple Drive folders have the same plate.');
      plan=makePlan(folder,rows.get(folderPlate(folder.name)),files,when);
    }catch(error) {
      const job={folder_id:folder.id,fingerprint:stamp,status:'blocked',plate:folderPlate(folder.name),issue:error.message};
      await store.save(job);
      if(old?.issue!==job.issue||old?.status!=='blocked')result.blocked.push({plate:job.plate||folder.name,issue:job.issue});
      continue;
    }
    // Source, folder and photo metadata must still agree immediately before the atomic write.
    const latestSource=await drive.metadata(MASTERLIST);
    if(latestSource.md5Checksum!==source.md5Checksum)throw Error('MASTERLIST changed. Saved drafts remain safe; retry the remaining vehicles.');
    const latestFolder=await drive.metadata(folder.id);
    if(latestFolder.name!==folder.name||latestFolder.trashed||!latestFolder.parents?.includes(root))throw Error('Vehicle folder changed. Retry with the latest folder list.');
    const latestFiles=await drive.list(folder.id);
    for(const item of plan.items) {
      const f=latestFiles.find(f=>f.id===item.file_id);
      if(!f||f.md5Checksum!==item.checksum||Number(f.size)!==item.size_bytes||f.mimeType!==item.mime_type||f.capabilities?.canDownload!==true)throw Error('Photo metadata changed before saving. Retry this vehicle.');
    }
    // RPC repeats deduplication with a table lock and commits car + all photos + receipt together.
    const saved=await store.commit({actor,folder:folder.id,stamp,source:sourceKey,plan});
    if(saved.status==='existing'){result.existing++;continue}
    const check=await store.verify(saved.vehicle_id);
    if(check.publication!=='draft'||Number(check.price)!==plan.vehicle.price||check.photos.length!==plan.items.length||check.photos[0]?.file_id!==plan.items[0].file_id)
      throw Error('Draft verification needs attention for '+plan.vehicle.plate+'. Do not import it again.');
    result.created.push({plate:plan.vehicle.plate,price:plan.vehicle.price,photos:plan.items.length,id:saved.vehicle_id,review:plan.review,skipped:plan.skipped});
  }
  result.remaining=Math.max(0,candidates.length-3);
  return result;
  }catch(error){return {...result,error:error.message,remaining:0}}
}
