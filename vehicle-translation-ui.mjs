const messages={
  setup_required:'Automatic translation is not connected yet. Your original description is saved.',
  configuration_required:'Translation connection needs attention. Your original description is saved.',
  billing_required:'Translation is paused because the service has no available credit. Your original description is saved.',
  invalid_output:'The translation did not pass its checks. Your original description is saved.',
  refused:'This description could not be translated. Review the wording and save again.'
};
export function translationStatus(job) {
  if(!job)return 'Automatic translation is not connected yet. Your original description is saved.';
  if(job.status==='empty')return 'Write in BM, English or 华语. Save once to generate the other languages.';
  if(messages[job.error_code])return messages[job.error_code];
  if(job.status==='ready')return 'BM / EN / 华语 are ready for this saved description.';
  if(job.status==='failed')return 'Translation could not finish. Your original description is saved; you can retry.';
  if(job.status==='pending'&&job.error_code)return 'Translation will retry automatically. Your original description is saved.';
  return 'Generating BM / EN / 华语… You can close this window; translation continues in the background.';
}
export function setupVehicleTranslations({db,getCurrent,canRetry,isDirty}) {
  const section=document.getElementById('vehicleTranslation'),status=document.getElementById('translationStatus');
  const retry=document.getElementById('retryTranslation'),refreshButton=document.getElementById('refreshTranslation');
  const preview=document.getElementById('translationPreview');
  let timer=null,epoch=0,attempt=0;
  const stop=()=>{epoch++;clearTimeout(timer);timer=null;};
  async function refresh({poll=false}={}) {
    clearTimeout(timer);
    if(!poll){epoch++;attempt=0;}
    const expected=epoch,car=getCurrent();
    retry.hidden=true;preview.hidden=true;
    section.hidden=!car;
    if(!car)return;
    if(isDirty()){status.textContent='Save your changes to update the translations.';return;}
    status.textContent='Checking translations…';
    try {
      const result=await db.from('vehicle_translation_jobs').select('vehicle_id,source_text,status,attempts,error_code,updated_at').eq('vehicle_id',car.id).maybeSingle();
      if(expected!==epoch||getCurrent()?.id!==car.id)return;
      if(isDirty()){status.textContent='Save your changes to update the translations.';return;}
      if(result.error){status.textContent=translationStatus(null);return;}
      const job=result.data?.source_text===car.description?result.data:null;
      status.textContent=translationStatus(job);
      retry.hidden=!canRetry()||!job||job.status!=='failed';
      if(job?.status==='ready') {
        const translated=await db.from('vehicle_description_translations').select('source_text,en,ms,zh').eq('vehicle_id',car.id).maybeSingle();
        if(expected!==epoch||isDirty()||translated.error||translated.data?.source_text!==car.description)return;
        for(const lang of ['en','ms','zh'])document.getElementById('translation-'+lang).textContent=translated.data[lang];
        preview.hidden=false;
      }else if(job&&['pending','queued','processing'].includes(job.status)&&job.error_code!=='setup_required'&&attempt++<40) {
        timer=setTimeout(()=>{if(document.getElementById('vehicleEditor').open)refresh({poll:true});},1500);
      }
    }catch{if(expected===epoch)status.textContent='Translation status is temporarily unavailable. Your original description is saved.';}
  }
  retry.onclick=async()=>{
    const car=getCurrent();if(!car||!canRetry()||isDirty())return;
    const expected=++epoch;clearTimeout(timer);retry.disabled=true;
    try {
      const result=await db.rpc('e2_retry_vehicle_translation',{target:car.id});
      if(expected!==epoch||getCurrent()?.id!==car.id)return;
      if(result.error){status.textContent=result.error.message||'Unable to retry. Refresh and try again.';return;}
      await refresh();
    }catch{if(expected===epoch)status.textContent='Unable to retry. Refresh and try again.';}
    finally{retry.disabled=false;}
  };
  refreshButton.onclick=()=>refresh();
  return {refresh,stop,markDirty(){stop();retry.hidden=true;preview.hidden=true;status.textContent='Save your changes to update the translations.';}};
}
