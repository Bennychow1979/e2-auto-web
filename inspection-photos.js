// Defect evidence stays in a private bucket. Opening a photo downloads it with
// the current staff session; no permanent or public image URL is generated.
export function inspectionPhotos({db,check,esc,lock,isCurrent}){
 const $=id=>document.getElementById(id),bucket=()=>db.storage.from('inspection-defects');
 let job=null,version=0,files=[],rows=[],urls=[],running=false;
 const message=text=>$('photoMessage').textContent=text;
 function selection(){const pending=files.filter(f=>!f.done);$('selectedDefects').textContent=pending.length?`${pending.length} photos selected / 已选照片：${pending.map(f=>f.file.name).join(', ')}`:'No photos selected / 未选择照片';$('clearDefects').disabled=!pending.length;}
 function reset(){version++;job=null;files=[];rows=[];for(const url of urls)URL.revokeObjectURL(url);urls=[];$('defectFiles').value='';$('defectCamera').value='';$('defectCaption').value='';$('defectCategory').value='';$('defectGallery').replaceChildren();selection();message('');}
 function render(){
  $('defectGallery').innerHTML=rows.map(p=>`<article class="defectCard"><strong>${esc(p.filename)}</strong><p>${esc([...$('defectCategory').options].find(o=>o.value===p.category)?.textContent||p.category)} · ${esc(new Date(p.created_at).toLocaleString('en-MY',{timeZone:'Asia/Kuala_Lumpur'}))} MY</p><p>${esc(p.caption)}</p><button type="button" class="quiet" data-defect="${esc(p.id)}">View photo / 查看照片</button><div class="defectImage"></div></article>`).join('')||'<p>No archived photos / 暂无存档照片</p>';
 }
 async function refresh(target,ticket){
  const result=check(await db.from('e2_inspection_photos').select('id,category,caption,filename,path,created_at').eq('inspection_id',target).eq('state','ready').order('created_at',{ascending:false}));
  if(ticket!==version||!isCurrent(target))return;
  rows=result;render();
 }
 async function open(record){reset();job=record;const ticket=version;
  $('photoFields').disabled=['Ready','Cancelled'].includes(record.status);
  message('Loading archived photos…');
  try{await refresh(record.id,ticket);if(ticket===version)message(['Ready','Cancelled'].includes(record.status)?'Closed record · archived photos remain available.':'');}
  catch(e){if(ticket===version)message('Could not load photos: '+e.message);}
 }
 $('chooseDefects').onclick=()=>$('defectFiles').click();
 $('takeDefectPhoto').onclick=()=>$('defectCamera').click();
 for(const id of ['defectFiles','defectCamera'])$(id).onchange=()=>{
  const selected=[...$(id).files];$(id).value='';
  if(!selected.length)return; // Cancelling either picker must retain previous selections.
  if(files.filter(f=>!f.done).length+selected.length>30)return message('Select up to 30 photos / 最多选择30张照片');
  files.push(...selected.map(file=>({file,id:crypto.randomUUID(),metadata:null,done:false})));
  selection();message('Upload to archive / 点击上传才会存档');
 };
 $('clearDefects').onclick=()=>{if(running)return;files=[];selection();message('Selection cleared; archived photos are retained / 已清除选择，存档照片保留');};
 $('uploadDefects').onclick=async()=>{
  if(running||!job||!isCurrent(job.id)||['Ready','Cancelled'].includes(job.status))return;
  if(!files.length)return message('Choose photos first / 请先选择照片');
  if(!$('defectCategory').value)return message('Choose the affected area / 请选择需要维修的部位');
  const target=job.id,ticket=version;running=true;lock(true);
  try{
   for(const entry of files){
    if(entry.done)continue;
    const file=entry.file,b=new Uint8Array(await file.slice(0,12).arrayBuffer());
    const mime=b[0]===255&&b[1]===216&&b[2]===255?'image/jpeg':
     [137,80,78,71,13,10,26,10].every((v,i)=>b[i]===v)?'image/png':
     String.fromCharCode(...b.slice(0,4))==='RIFF'&&String.fromCharCode(...b.slice(8,12))==='WEBP'?'image/webp':null;
    if(!mime||file.size<1||file.size>10485760||file.name.length>160)throw Error('Use JPG, PNG or WebP up to 10 MB each. Export HEIC as JPG first.');
    if(ticket!==version||!isCurrent(target))return;
    message(`Uploading ${file.name}… Keep this page open.`);
    entry.metadata??={request_id:entry.id,target,photo_category:$('defectCategory').value,photo_caption:$('defectCaption').value.trim(),file_name:file.name,file_mime:mime,file_bytes:file.size};
    const reserved=check(await db.rpc('e2_reserve_inspection_photo',entry.metadata));
    if(reserved.state!=='ready'){
     const result=await bucket().upload(reserved.path,file,{contentType:mime,upsert:false});
     if(result.error&&!['409','Duplicate'].includes(String(result.error.statusCode||result.error.code)))throw result.error;
     check(await db.rpc('e2_finish_inspection_photo',{photo_id:entry.id}));
    }
    entry.done=true;
   }
   if(ticket!==version||!isCurrent(target))return;
   await refresh(target,ticket);$('defectFiles').value='';$('defectCamera').value='';$('defectCaption').value='';files=[];selection();message('Photos uploaded and archived / 照片已上传并存档');
  }catch(e){if(ticket===version)message('Upload not completed: '+e.message+' Retry to continue; completed photos are retained.');}
  finally{running=false;lock(false);}
 };
 $('defectGallery').onclick=async e=>{
  const button=e.target.closest('[data-defect]');if(!button||!job)return;
  const photo=rows.find(p=>p.id===button.dataset.defect);if(!photo)return;
  const ticket=version,target=job.id;button.disabled=true;
  try{
   const blob=check(await bucket().download(photo.path));
   if(ticket!==version||!isCurrent(target))return;
   const url=URL.createObjectURL(blob);urls.push(url);
   const image=document.createElement('img');image.alt=photo.caption||'Archived defect photo';image.src=url;image.loading='lazy';
   image.onerror=()=>{image.remove();button.disabled=false;message('This photo could not be displayed. Try opening it again.');};
   button.nextElementSibling.replaceChildren(image);button.textContent='Photo opened / 已显示照片';
  }catch(e){if(ticket===version){button.disabled=false;message('Could not open photo: '+e.message);}}
 };
 return {open,reset,hasPending:()=>files.some(f=>!f.done)};
}
