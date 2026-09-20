export function setupVehicleImport({db,canManage,onFinished}) {
  const button=document.getElementById('importDriveVehicles'),output=document.getElementById('importDriveResult');
  button.onclick=async()=>{
    if(button.disabled||!canManage())return;
    button.disabled=true;output.textContent='Checking Drive folders and the current-month MASTERLIST…';
    const lines=[];
    try {
      let batches=0,result;
      do {
        const response=await db.functions.invoke('e2-vehicle-import',{body:{action:'run'}});
        if(response.error){let detail;try{detail=await response.error.context?.json()}catch{}throw Error(detail?.error||'Import interrupted. Refresh before retrying.')}
        result=response.data;
        for(const car of result.created||[])lines.push(car.plate+' · RM'+Number(car.price).toLocaleString('en-MY')+' · '+car.photos+' photos · Private draft'+(car.skipped?' · '+car.skipped+' unsupported or duplicate files skipped':''));
        for(const car of result.blocked||[])lines.push(car.plate+' · Needs review: '+car.issue);
        if(result.error)throw Error(result.error);
        output.textContent=lines.join('\n')+(result.remaining?'\nContinuing remaining vehicles…':'');
      }while(result.remaining&&++batches<100);
      if(result.remaining)lines.push('Batch limit reached. Run again to continue safely.');
      output.textContent=lines.join('\n')||'No new drafts or changed issues. Existing vehicles were skipped.';
      if(lines.some(line=>line.includes('Private draft')))output.textContent+='\nReview fuel type, stock availability, spec, photos and cover before publishing. Mileage remains unknown.';
    }catch(error){output.textContent=[...lines,error.message].join('\n')}
    finally{button.disabled=false;await onFinished()}
  };
  return {update:()=>{button.hidden=!canManage()}};
}

export async function showImportReview(db,car) {
  const element=document.getElementById('importReview');element.textContent='';element.hidden=true;
  if(!car)return;
  const {data,error}=await db.from('vehicle_import_jobs').select('review_notes').eq('vehicle_id',car.id).eq('status','completed').maybeSingle();
  if(error)throw Error('Import review notes could not be loaded. Refresh before publishing.');
  if(data?.review_notes?.length){element.textContent='IMPORT REVIEW\n'+data.review_notes.join('\n');element.hidden=false}
}
