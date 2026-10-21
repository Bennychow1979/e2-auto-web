import {db,check,esc,friendlyError} from './e2-data.js?v=ops-1';

const labels={invoice_copy:'Invoice copy / 发票附件',appointment:'PUSPAKOM appointment / 预约单',job_sheet:'Job sheet / 工作单',handover:'Handover photo / 交车照片',receipt:'Petrol receipt / 油费收据',invoice:'Repair invoice / 维修账单',payment:'Payment evidence / 付款凭证'};
export function filePanel(root,{parent,kinds,files,onSaved,onBusy,onSelect=()=>{}}){
 let busy=false,disposed=false;
 const urls=[];
 root.innerHTML=`<h3>Documents / 附件存档</h3><div class="fileList"></div>${kinds.length?`<form class="fileTools"><label>Document type / 文件类型<select name="kind">${kinds.map(k=>`<option value="${k}">${labels[k]}</option>`).join('')}</select></label><p>JPG, PNG, WebP or PDF · up to 10 MB each. / 每份最多 10 MB。</p><div class="buttonRow"><button type="button" data-source="file">Choose file / 选择文件</button><button type="button" data-source="camera">Take photo / 拍照</button><input name="file" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" hidden><input name="camera" type="file" accept="image/*" capture="environment" hidden></div><p class="selected"></p><button type="submit" disabled>Upload & archive / 上传存档</button><p role="status"></p></form>`:''}`;
 const list=root.querySelector('.fileList');
 list.innerHTML=files.length?files.map(f=>`<div class="fileCard" data-file="${esc(f.id)}"><strong>${esc(labels[f.kind]||f.kind)}</strong><small>${esc(f.filename)} · ${Math.ceil(f.byte_size/1024)} KB · ${esc(f.state)}</small>${f.state==='ready'?'<button type="button" class="quiet">Open / 查看附件</button>':'<small>Upload unfinished. Retry using the same selected file. / 上传未完成。</small>'}</div>`).join(''):'<p class="muted">No archived files yet. / 暂无附件。</p>';
 list.querySelectorAll('button').forEach(button=>button.onclick=async()=>{
  const card=button.closest('[data-file]'),f=files.find(v=>v.id===card.dataset.file);
  button.disabled=true;
  try{
   const blob=check(await db.storage.from('operations-files').download(f.path));
   if(disposed)return;
   const url=URL.createObjectURL(blob);urls.push(url);
   if(f.mime_type.startsWith('image/')){const img=new Image();img.src=url;img.alt=f.filename;card.append(img);}
   const link=document.createElement('a');link.href=url;link.download=f.filename;link.textContent='Download / 下载';card.append(link);
   if(f.mime_type==='application/pdf'){const open=document.createElement('a');open.href=url;open.target='_blank';open.rel='noopener';open.textContent='Open PDF ↗';card.append(open);}
   button.remove();
  }catch(e){button.textContent=friendlyError(e);button.disabled=false;}
 });
 const form=root.querySelector('form');
 let selected=null,request=null,choose=()=>{},upload=async()=>{};
 if(form){
  const status=form.querySelector('[role=status]'),submit=form.querySelector('button[type=submit]');
  choose=file=>{
   if(!file)return;
   selected=file;
   request=files.find(f=>f.state==='uploading'&&f.kind===form.elements.kind.value&&f.filename===file.name&&f.byte_size===file.size&&f.mime_type===file.type)?.id||crypto.randomUUID();
   onSelect(file);form.querySelector('.selected').textContent=file.name;submit.disabled=false;status.textContent='';
  };
  for(const input of form.querySelectorAll('input[type=file]'))input.onchange=()=>choose(input.files?.[0]);
  form.querySelectorAll('[data-source]').forEach(b=>b.onclick=()=>form.elements[b.dataset.source].click());
  form.elements.kind.onchange=()=>{request=crypto.randomUUID();};
  upload=async()=>{
   if(!selected||busy)return;
   if(!['image/jpeg','image/png','image/webp','application/pdf'].includes(selected.type)||selected.size<1||selected.size>10*1024*1024){status.textContent='Choose JPG, PNG, WebP or PDF up to 10 MB. iPhone: use a JPG photo or export to PDF. / 请用 JPG、PNG、WebP 或 PDF，最多 10 MB。';return;}
   busy=true;onBusy(true);form.querySelectorAll('input,select,button').forEach(el=>el.disabled=true);status.textContent='Uploading and archiving… / 正在上传存档…';
   try{
    const f=check(await db.rpc('e2_reserve_ops_file',{request_id:request,job_id:parent.job_id||null,claim_id:parent.claim_id||null,file_kind:form.elements.kind.value,file_name:selected.name,file_mime:selected.type,file_bytes:selected.size}));
    const result=await db.storage.from('operations-files').upload(f.path,selected,{contentType:selected.type,upsert:false});
    if(result.error&&String(result.error.statusCode||result.error.status)!=='409')throw result.error;
    check(await db.rpc('e2_finish_ops_file',{file_id:f.id}));
    selected=null;request=null;status.textContent='Archived / 已存档';
    await onSaved();
   }catch(e){status.textContent=friendlyError(e);}
   finally{busy=false;onBusy(false);form.querySelectorAll('input,select,button').forEach(el=>el.disabled=false);submit.disabled=!selected;}
  };
 }
 if(form)form.onsubmit=event=>{event.preventDefault();void upload();};
 return {choose:file=>choose(file),upload:()=>upload(),dispose(){disposed=true;urls.forEach(URL.revokeObjectURL);},pending:()=>!!selected,busy:()=>busy};
}
