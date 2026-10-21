import {db,configured,check,esc,friendlyError,rm} from './e2-data.js?v=ops-1';
import {filePanel} from './operations-files.js?v=3';
import {runnerMessage,whatsappURL} from './runner-message.mjs';
import {normalizeWhatsApp} from './profile-utils.js';
const $=id=>document.getElementById(id);
const names={assigned:'Assigned / 已派工',car_out:'Car out / 已出车',arrived:'Arrived / 已到达',returning:'Returning / 回程',collected:'Collected / 已取车',car_in:'Car in / 已回店',delivering:'Delivering / 送件中',completed:'Completed / 已完成',cancelled:'Cancelled / 已取消',draft:'Draft / 草稿',submitted:'Awaiting Admin / 待审批',returned:'Returned / 退回补充',approved:'Approved / 待会计核对',verified:'Verified / 待付款记录',paid:'Paid / 已记录付款',petrol:'Petrol claim / 油费报销',repair:'Repair bill / 维修账单',puspakom:'PUSPAKOM',carsome_pickup:'Carsome pickup / 取车',carro_pickup:'Carro pickup / Carro 取车',send_invoice:'Send invoice / 送发票',workshop:'Workshop / 维修厂',delivery:'Delivery / 送车',other:'Other / 其他'};
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kuala_Lumpur',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const time=value=>value?new Date(value).toLocaleString('en-MY',{timeZone:'Asia/Kuala_Lumpur',dateStyle:'medium',timeStyle:'short'}):'—';
const localTime=value=>value?new Date(new Date(value).getTime()+8*3600000).toISOString().slice(0,16):'';
const badge=status=>`<span class="badge ${esc(status)}">${esc(names[status]||status)}</span>`;
let data,view='jobs',currentJob,currentClaim,dispatch,claimRequest,panels={},busy=0,dirty=new Set(),accessEpoch=0,pendingClaimFile=null;
let draftHandoff=null;
const admin=()=>['admin','super_admin'].includes(data?.role);
const canDispatch=()=>['admin','super_admin','account'].includes(data?.role);
const canEdit=c=>!c||c.created_by===data.user_id&&['draft','returned'].includes(c.status);
async function rpc(name,args={}){return check(await db.rpc(name,args));}
function error(id,e){$(id).textContent=friendlyError(e);$(id).classList.add('error');}
async function action(id,fn){
 if(busy)return;
 busy++;const buttons=[...document.querySelectorAll('dialog[open] button')].map(b=>[b,b.disabled]);buttons.forEach(([b])=>b.disabled=true);$(id).textContent='';
 try{await fn();}catch(e){error(id,e);}finally{busy--;buttons.forEach(([b,disabled])=>{if(b.isConnected)b.disabled=disabled;});}
}
async function reload(){const epoch=accessEpoch,result=await rpc('e2_operations_workspace');if(epoch!==accessEpoch)throw Error('Your login changed. / 登录身份已改变。');data=result;render();}
function clearAccess(){
 endDraftHandoff();
 accessEpoch++;Object.values(panels).forEach(p=>p.dispose());panels={};dirty.clear();data=null;
 document.querySelectorAll('dialog').forEach(d=>d.close());
 whatsappDraft=null;$('whatsappText').value='';$('whatsappOpen').removeAttribute('href');$('whatsappRecipient').textContent='';
 $('runnerWhatsAppForm').reset();$('runnerWhatsAppForm').hidden=true;$('editRunnerWhatsApp').hidden=true;
 for(const id of ['runnerWhatsAppIdentity','runnerWhatsAppFormat','runnerWhatsAppSaveStatus','whatsappCopyStatus','whatsappNote'])$(id).textContent='';
 $('whatsappPreviewLink').removeAttribute('href');
 for(const id of ['records','summary','jobSummary','claimSummary','jobFiles','claimFiles','jobHistory','claimHistory','notificationPreview','jobNotifications','acceptance'])$(id).replaceChildren();
 for(const id of ['dispatchForm','claimForm','movementForm','reviewForm'])$(id).reset();
 $('workspace').hidden=true;$('createJob').hidden=true;$('signOut').hidden=true;$('signIn').hidden=false;
 $('message').textContent='Sign in with your staff account. / 请使用员工账号登录。';
}
function render(){
 const isAdmin=admin(),role=data.role;
 $('roleCaption').textContent=`E2 WORKSPACE · ${role.replace('_',' ').toUpperCase()}`;
 $('pageTitle').textContent=role==='runner'?'My jobs / 我的任务':role==='account'?'Dispatch. Check. Record. / 派工、核对与付款':role==='inspector'?'Repair bills / 维修账单':'Jobs & bills / 派工与费用';
 $('pageIntro').textContent=role==='runner'?'Only jobs assigned to you. Record movement, archive documents and submit petrol claims. / 仅显示你的派工。':role==='account'?'Assign Runner jobs, verify approved expenses and record payment. / 安排 Runner 派工，核对获批费用及实际付款。':'Keep each vehicle, document and approval together. / 每辆车的任务、附件与审批统一存档。';
 $('createJob').hidden=!canDispatch();$('createRepair').hidden=!isAdmin&&role!=='inspector';
 $('stockLink').hidden=!isAdmin;$('inspectionLink').hidden=!isAdmin&&role!=='inspector';
 $('jobsTab').hidden=role==='inspector';if(role==='inspector')view='claims';
 $('workspace').hidden=false;$('signOut').hidden=false;$('message').textContent='';
 const openJobs=data.jobs.filter(j=>!['car_in','completed','cancelled'].includes(j.status)).length;
 const summaries=role==='inspector'
  ?['draft','submitted','returned'].map(status=>[data.claims.filter(c=>c.status===status).length,names[status]])
  :[[openJobs,'Active jobs / 进行中'],[data.claims.filter(c=>['submitted','approved','verified'].includes(c.status)).length,'Pending expenses / 待处理'],[rm(data.claims.filter(c=>c.status==='paid').reduce((n,c)=>n+Number(c.amount),0),2),'Recorded paid / 已付款记录']];
 $('summary').innerHTML=summaries.map(([value,label])=>`<div class="summaryCard"><span>${label}</span><strong>${value}</strong></div>`).join('');
 const states=view==='jobs'?['assigned','car_out','arrived','returning','collected','car_in','delivering','completed','cancelled']:['draft','submitted','returned','approved','verified','paid'];
 const selected=$('filter').value;$('filter').innerHTML='<option value="all">All / 全部</option>'+states.map(s=>`<option value="${s}">${names[s]}</option>`).join('');$('filter').value=states.includes(selected)?selected:'all';
 const plate=$('plateFilter').value,plates=[...new Set([...data.jobs,...data.claims,...data.inspections].map(r=>r.plate))].sort();
 $('plateFilter').innerHTML='<option value="all">All plates / 全部车牌</option>'+plates.map(p=>`<option value="${esc(p)}">${esc(p)}</option>`).join('');$('plateFilter').value=plates.includes(plate)?plate:'all';
 renderRecords();
 renderNotifications();
}
function acceptanceText(j){return j.accepted_at?`Accepted / 已接单 · ${time(j.accepted_at)}`:j.status==='cancelled'?'Cancelled / 已取消':j.status==='assigned'?'Awaiting acceptance / 待接单':'Acceptance not recorded / 未记录接单';}
function messageCard(m){return `<article class="notificationCard"><strong>${m.kind==='overdue'?'Admin reminder / Admin 超时提醒':'Telegram → '+esc(m.recipient_name)}</strong><small>SIMULATED ONLY / 仅模拟，未真实发送 · ${time(m.created_at)}${m.resolved?' · Resolved / 已处理':''}</small><p>${esc(m.text)}</p><a href="${esc(m.url)}">View job / 查看任务 ↗</a></article>`;}
function renderNotifications(){
 const preview=data.notification_preview,root=$('notificationPreview');root.hidden=!['admin','super_admin','account','runner'].includes(data.role);
 if(root.hidden){root.replaceChildren();return;}
 if(preview?.mode!=='simulation'){root.innerHTML='<strong>Telegram notifications are off / Telegram 通知未启用</strong><p>Admin must notify the Runner directly. Confirm acceptance in this workspace. Automatic 15-minute reminders are not enabled. / 请 Admin 另行通知 Runner，并在这里确认接单；15分钟自动提醒暂未启用。</p>';return;}
 const logOpen=root.querySelector('details')?.open;
 const overdue=preview.messages.filter(m=>m.kind==='overdue'&&!m.resolved);
 root.innerHTML=`<h2>Telegram automatic notifications / Telegram 自动通知预览</h2><p>Simulation only. No Bot connected and no messages sent. / 仅模拟，未连接 Bot，不会发送消息。</p><p>New or edited job → assigned Runner · No acceptance after 15 minutes → Admin · Accepted or cancelled → stop reminders. / 新增或修改派工自动通知对应 Runner；15分钟未接单提醒 Admin；接单或取消后停止提醒。</p>${admin()?`<p class="${overdue.length?'reviewNotice':''}" role="status">${overdue.length} jobs overdue / 项任务超过15分钟未接单</p><button id="advancePreviewTime" type="button" class="quiet">Simulate +15 minutes / 模拟经过15分钟</button>`:'<p>Opening a notification does not accept a job. Review the job, then confirm acceptance. / 查看通知不等于接单，请查看任务后确认。</p>'}<details><summary>Notification log / 通知记录 (${preview.messages.length})</summary>${preview.messages.map(messageCard).join('')||'<p>No notifications / 暂无通知</p>'}</details>`;
 if(admin())$('advancePreviewTime').onclick=()=>action('message',async()=>{await rpc('e2_preview_advance_time');await reload();});
 root.querySelector('details').open=!!logOpen;
}
function renderRecords(){
 $('jobsTab').setAttribute('aria-pressed',view==='jobs');$('claimsTab').setAttribute('aria-pressed',view==='claims');
 const q=$('search').value.trim().toLowerCase(),status=$('filter').value;
 const rows=(view==='jobs'?data.jobs:data.claims).filter(r=>(status==='all'||r.status===status)&&($('plateFilter').value==='all'||r.plate===$('plateFilter').value)&&[r.plate,r.runner_name,r.supplier,r.invoice_no,r.origin,r.destination].filter(Boolean).join(' ').toLowerCase().includes(q));
 $('resultCount').textContent=`${rows.length} ${view==='jobs'?'jobs / 项任务':'expenses / 项费用'}`;
 $('records').innerHTML=rows.length?rows.map(r=>`<article class="record" data-id="${esc(r.id)}"><div>${badge(r.status)}<h2>${esc(r.plate)} · ${esc(names[r.kind])}</h2>${view==='jobs'?`<p>${esc(r.origin)} → ${esc(r.destination)}</p><p>${esc(r.runner_name)} · ${time(r.appointment_at)}</p>`:`<p>${esc(r.supplier)} · ${esc(r.invoice_no||'—')}</p><p class="amount">${rm(r.amount,2)}</p><p>${esc(r.submitted_name)} · ${esc(r.expense_date)}</p>`}</div><button class="quiet" data-open="${esc(r.id)}">Open / 查看 ↗</button></article>`).join(''):'<div class="empty">Nothing here yet. / 暂无记录。</div>';
 $('records').querySelectorAll('[data-open]').forEach(b=>b.onclick=()=>view==='jobs'?openJob(b.dataset.open):openClaim(b.dataset.open));
 if(view==='jobs')for(const row of rows){const p=document.createElement('p');p.className='acceptanceStatus';p.textContent=acceptanceText(row);$('records').querySelector(`[data-id="${row.id}"]>div`).append(p);}
}
function history(root,parent,key){$(root).innerHTML=data.events.filter(e=>e[key]===parent).map(e=>`<div class="historyRow"><small>${time(e.created_at)} · ${esc(e.actor_name||e.actor.slice(0,8))}</small><strong>${esc(e.action)}</strong><div>${esc(Object.entries(e.detail||{}).map(([k,v])=>`${k}: ${typeof v==='object'?JSON.stringify(v):v}`).join('\n'))}</div></div>`).join('')||'<p>No activity yet. / 暂无记录。</p>';}
function show(id){dirty.delete(id);$(id).showModal();$(id).scrollTop=0;}
function close(id,force=false){
 if(busy)return false;
 const panel=panels[id];
 if(!force&&(dirty.has(id)||panel?.pending())&&!confirm('Discard unsaved changes or selected files? / 放弃未保存的内容或待上传文件？'))return false;
 $(id).close();panel?.dispose();delete panels[id];dirty.delete(id);return true;
}
function mountFiles(dialogId,root,parent,kinds){
 panels[dialogId]?.dispose();
 const [key,id]=Object.entries(parent)[0];
 panels[dialogId]=filePanel($(root),{parent,kinds,files:data.files.filter(f=>f[key]===id),onBusy:on=>{busy+=on?1:-1;},onSelect:file=>{if(dialogId==='claimDialog')$('claimCaptureNote').textContent='Selected / 已选：'+file.name;},onSaved:async()=>{await reload();mountFiles(dialogId,root,parent,kinds);history(dialogId==='jobDialog'?'jobHistory':'claimHistory',id,key);}});
}
function locationOptions(field,value=''){
 const select=$(field+'Select'),input=$('dispatchForm').elements[field],wrapper=$(field+'NewField');
 const values=[...new Set([...(data.locations??data.jobs.flatMap(j=>[j.origin,j.destination])),...(value?[value]:[])])].sort((a,b)=>a.localeCompare(b));
 select.innerHTML='<option value="">Choose location / 选择地点</option>'+values.map((v,i)=>`<option value="place-${i}">${esc(v)}</option>`).join('')+'<option value="new">＋ New location / 新增地点</option>';
 const index=values.indexOf(value);select.value=index>=0?'place-'+index:'';input.value=value;wrapper.hidden=true;input.required=false;
 select.onchange=()=>{const fresh=select.value==='new';wrapper.hidden=!fresh;input.required=fresh;input.value=fresh?'':select.value?values[Number(select.value.slice(6))]:'';if(fresh)input.focus();};
}
function renderDispatchVehicles(selected=$('dispatchForm').elements.vehicle_id.value){
 const select=$('dispatchForm').elements.vehicle_id;
 const normalize=value=>String(value??'').toLowerCase().replace(/[\s-]+/g,'');
 const query=normalize($('dispatchVehicleSearch').value);
 const vehicles=data.vehicles.filter(v=>normalize(v.plate+' '+v.label).includes(query));
 select.innerHTML='<option value="">Choose vehicle / 请选择车辆</option>'+vehicles.map(v=>`<option value="${v.id}">${esc(v.plate)} · ${esc(v.label||'Awaiting import / 等待导入')}</option>`).join('');
 select.value=vehicles.some(v=>v.id===selected)?selected:'';
 $('dispatchVehicleResults').textContent=vehicles.length?`${vehicles.length} matching vehicles / 辆匹配车辆`:data.role==='account'?'No matching vehicle. Ask Admin to create or restore its vehicle record first. / 没有匹配车辆，请 Admin 先新增或恢复车辆档案。':'No matching stock vehicle. / 库存里没有匹配车辆。';
 $('addDispatchVehicle').hidden=!!vehicles.length||!query||!admin()||dispatch?.revision!=null;
}
$('dispatchVehicleSearch').oninput=()=>renderDispatchVehicles();
function endDraftHandoff(){
 draftHandoff=null;$('dispatchDraftDialog').close();$('dispatchDraftFrame').removeAttribute('src');
}
$('addDispatchVehicle').onclick=()=>{
 if(!admin()||dispatch?.revision!=null||busy)return;
 const token=crypto.randomUUID(),url=new URL('portal.html',location.href);
 draftHandoff={token,jobId:dispatch.id,epoch:accessEpoch,receiving:false};
 url.searchParams.set('dispatchDraft',token);
 url.searchParams.set('plate', $('dispatchVehicleSearch').value.trim());
 if(['127.0.0.1','localhost'].includes(location.hostname)){
  const previewRole=new URLSearchParams(location.search).get('previewRole');
  if(previewRole)url.searchParams.set('previewRole',previewRole);
 }
 $('dispatchDraftMessage').textContent='';$('dispatchDraftFrame').src=url.href;$('dispatchDraftDialog').showModal();
};
function requestDraftClose(){
 if(draftHandoff&&!draftHandoff.ready){endDraftHandoff();$('addDispatchVehicle').focus();return;}
 if(draftHandoff)$('dispatchDraftFrame').contentWindow?.postMessage({type:'e2-dispatch-close',token:draftHandoff.token},location.origin);
}
$('closeDispatchDraft').onclick=requestDraftClose;
$('dispatchDraftDialog').addEventListener('cancel',event=>{event.preventDefault();requestDraftClose();});
window.addEventListener('message',async event=>{
 const handoff=draftHandoff,message=event.data;
 if(!handoff||event.origin!==location.origin||event.source!==$('dispatchDraftFrame').contentWindow||message?.token!==handoff.token)return;
 if(message.type==='e2-dispatch-ready'){handoff.ready=true;return;}
 if(message.type==='e2-dispatch-cancel'){endDraftHandoff();$('addDispatchVehicle').focus();return;}
 if(message.type!=='e2-dispatch-saved'||handoff.receiving||!admin()||handoff.epoch!==accessEpoch||handoff.jobId!==dispatch?.id||!$('dispatchDialog').open)return;
 if(!/^[0-9a-f-]{36}$/i.test(message.vehicleId||''))return;
 handoff.receiving=true;
 try{
  await reload();
  if(draftHandoff!==handoff||handoff.epoch!==accessEpoch||handoff.jobId!==dispatch?.id)return;
  const vehicle=data.vehicles.find(v=>v.id===message.vehicleId);
  if(!vehicle)throw Error('Draft saved, but unavailable for dispatch. Check access and retry. / 草稿已保存，暂未能选取，请重试。');
  $('dispatchVehicleSearch').value=vehicle.plate;renderDispatchVehicles(vehicle.id);dirty.add('dispatchDialog');
  $('dispatchMessage').textContent='Draft saved and selected. Continue assigning this job. / 车辆草稿已保存并选中，请继续派工。';
  endDraftHandoff();$('dispatchVehicle').focus();
 }catch(e){error('dispatchDraftMessage',e);event.source.postMessage({type:'e2-dispatch-retry',token:handoff.token},location.origin);}
 finally{handoff.receiving=false;}
});
function openDispatch(job=null){
 if(!canDispatch())return;
 dispatch=job?{...job}:{id:crypto.randomUUID(),revision:null};const f=$('dispatchForm');f.reset();
 renderDispatchVehicles(job?.vehicle_id||'');
 f.elements.assigned_to.innerHTML=data.runners.map(v=>`<option value="${v.id}">${esc(v.name)}</option>`).join('');
 for(const key of ['vehicle_id','assigned_to','kind','origin','destination','instructions'])if(job)f.elements[key].value=job[key]||'';
 locationOptions('origin',job?.origin||'');locationOptions('destination',job?.destination||'');
 f.elements.appointment_at.value=localTime(job?.appointment_at);
 f.elements.vehicle_id.disabled=!!job;f.elements.kind.disabled=!!job;
 $('dispatchVehicleSearch').disabled=!!job;
 $('dispatchMessage').textContent=data.runners.length?'':'Create an active Runner account first. / 请先添加启用的 Runner 账号。';
 show('dispatchDialog');
}
function openJob(id){
 currentJob={...data.jobs.find(j=>j.id===id)};const j=currentJob;
 $('jobTitle').textContent=`${j.plate} · ${names[j.kind]}`;
 $('acceptance').textContent=acceptanceText(j);
 $('acceptJob').hidden=data.role!=='runner'||j.assigned_to!==data.user_id||j.status!=='assigned'||!!j.accepted_at;
 $('notifyWhatsApp').hidden=!canDispatch()||j.status!=='assigned'||!!j.accepted_at;
 $('jobNotifications').innerHTML=(data.notification_preview?.messages||[]).filter(m=>m.job_id===j.id).map(messageCard).join('');
 $('jobSummary').innerHTML=`${badge(j.status)}<div class="detailBox"><p>${esc(j.origin)} → ${esc(j.destination)}</p><p>${esc(j.runner_name)} · ${time(j.appointment_at)}</p><p>${esc(j.instructions||'No special instructions / 暂无交代事项')}</p>${j.kind==='send_invoice'?'':`<p>Last odometer / 最近里程：${j.last_mileage??'—'} km</p>`}</div>`;
 const steps=j.kind==='send_invoice'?['assigned','delivering','completed']:['carsome_pickup','carro_pickup'].includes(j.kind)?['assigned','collected','car_in']:['assigned','car_out','arrived','returning','car_in'];
 $('journey').innerHTML=steps.map((s,i)=>`<span class="${s===j.status?'current':i<steps.indexOf(j.status)?'done':''}">${names[s]}</span>`).join('');
 const writable=(admin()||data.role==='runner'&&j.assigned_to===data.user_id)&&!['car_in','completed','cancelled'].includes(j.status);
 $('editDispatch').hidden=!canDispatch()||j.status!=='assigned';$('petrolClaim').hidden=data.role!=='runner'||j.assigned_to!==data.user_id||j.status==='cancelled';
 const next=steps[steps.indexOf(j.status)+1],mf=$('movementForm');mf.reset();mf.hidden=!writable;
 mf.hidden=!writable||(!j.accepted_at&&!admin());
 mf.elements.next_status.innerHTML=(next&&j.accepted_at?`<option value="${next}">${names[next]}</option>`:'')+(admin()?'<option value="cancelled">Cancel job / 取消（必须说明原因）</option>':'');
 $('movementTitle').textContent=j.kind==='send_invoice'?'Delivery progress / 送发票进度':'Record movement / 车辆进出';mf.elements.mileage.closest('label').hidden=j.kind==='send_invoice';
 mf.elements.mileage.min=j.last_mileage||0;$('jobMessage').textContent='';
 mountFiles('jobDialog','jobFiles',{job_id:id},writable?(j.kind==='send_invoice'?['invoice_copy','handover']:['appointment','job_sheet','handover']):[]);history('jobHistory',id,'job_id');
 if(!$('jobDialog').open)show('jobDialog');
}
let whatsappDraft=null;
$('notifyWhatsApp').onclick=()=>action('jobMessage',async()=>{
 const epoch=accessEpoch,id=currentJob.id;
 const prepared=await rpc('e2_prepare_runner_whatsapp',{target:id,expected_revision:currentJob.revision});
 if(epoch!==accessEpoch||currentJob?.id!==id||!canDispatch())return;
 renderWhatsApp(prepared);show('whatsappDialog');
});
function renderWhatsApp(prepared){
 whatsappDraft=prepared;dirty.delete('whatsappDialog');$('runnerWhatsAppForm').reset();$('runnerWhatsAppForm').hidden=true;$('whatsappMessagePanel').hidden=false;
 $('editRunnerWhatsApp').hidden=!admin();$('editRunnerWhatsApp').textContent=prepared.phone?'Edit / reverify number · 修改并重新核实号码':'Add / verify number · 填写并核实号码';
 const simulation=prepared.mode==='simulation',message=runnerMessage(prepared.job);
 $('whatsappText').value=simulation?'[PREVIEW ONLY / 仅预览，未发送]\n'+message:message;
 $('whatsappRecipient').textContent=prepared.phone&&prepared.verified_at?`${prepared.job.runner_name} · +${prepared.phone}\n${simulation?'Preview record · 预览记录 · ':''}Verified / 已核实：${time(prepared.verified_at)}`:`${prepared.job.runner_name} · No verified WhatsApp number / 尚无已核实号码`;
 $('whatsappOpen').hidden=simulation||!prepared.phone||!prepared.verified_at;
 $('whatsappOpen').removeAttribute('href');
 // A button (not a prebuilt external link) forces all opens through the fresh
 // assignment/contact check below, including when users try middle-clicking.
 $('whatsappPreviewLink').hidden=!simulation;
 if(simulation)$('whatsappPreviewLink').href=prepared.preview_job_url;
 $('whatsappNote').textContent=(!prepared.phone||!prepared.verified_at?'Ask Admin to verify this Runner’s WhatsApp number first. / 请 Admin 先核实此 Runner 的 WhatsApp 号码。\n':'')+(simulation?'Preview only: WhatsApp cannot open or send here. The link below opens the local Runner preview. / 仅预览，不会打开或发送 WhatsApp；下方链接进入本机 Runner 接单页。':'Review the recipient and message, then open WhatsApp and press Send yourself. Opening WhatsApp does not mean sent or accepted. / 核对后打开 WhatsApp，由你按发送；打开不代表已发送或已接单。');
 $('whatsappCopyStatus').textContent='';
}
function contactFormState(){
 let number='';try{number=normalizeWhatsApp($('runnerWhatsAppPhone').value);}catch{}
 $('runnerWhatsAppFormat').textContent=number?'Will save / 将保存：+'+number:'Enter a valid number with country code, e.g. +60… or Malaysian 01… / 请输入有效国际号码，或马来西亚 01… 号码。';
 $('saveRunnerWhatsApp').disabled=!number||!$('runnerWhatsAppConfirmed').checked;
}
$('editRunnerWhatsApp').onclick=()=>{
 if(!admin()||!whatsappDraft||busy)return;
 $('runnerWhatsAppForm').reset();$('runnerWhatsAppPhone').value=whatsappDraft.phone?'+'+whatsappDraft.phone:'';
 $('runnerWhatsAppIdentity').textContent='Runner: '+whatsappDraft.job.runner_name+' · Job: '+whatsappDraft.job.plate;
 $('runnerWhatsAppSaveStatus').textContent='';$('runnerWhatsAppForm').hidden=false;$('whatsappMessagePanel').hidden=true;$('editRunnerWhatsApp').hidden=true;
 contactFormState();$('runnerWhatsAppPhone').focus();
};
$('runnerWhatsAppPhone').oninput=()=>{$('runnerWhatsAppConfirmed').checked=false;contactFormState();};
$('runnerWhatsAppConfirmed').onchange=contactFormState;
$('cancelRunnerWhatsApp').onclick=()=>{renderWhatsApp(whatsappDraft);$('editRunnerWhatsApp').focus();};
$('runnerWhatsAppForm').onsubmit=event=>{
 event.preventDefault();
 action('runnerWhatsAppSaveStatus',async()=>{
  if(!admin()||!whatsappDraft||!$('runnerWhatsAppConfirmed').checked)throw Error('Admin must confirm the Runner number / 需要 Admin 核实号码');
  const before=whatsappDraft,epoch=accessEpoch,number=normalizeWhatsApp($('runnerWhatsAppPhone').value);
  if(!number)throw Error('WhatsApp number required / 请填写号码');
  const saved=await rpc('e2_verify_job_runner_whatsapp',{target:before.job.id,expected_revision:before.job.revision,phone:number,confirmed:true,expected_verified_at:before.verified_at||null});
  if(epoch!==accessEpoch||!admin()||!$('whatsappDialog').open)return;
  renderWhatsApp(saved);$('whatsappCopyStatus').textContent='Saved and verified. Back to this Job notification; no message sent. / 已核实保存，已返回此 Job 通知；未发送消息。';
  $('whatsappDialog').scrollTop=0;$('whatsappCopy').focus();
 });
};
$('whatsappCopy').onclick=async()=>{
 try{await navigator.clipboard.writeText($('whatsappText').value);$('whatsappCopyStatus').textContent='Copied, not sent / 已复制，未发送';}
 catch{$('whatsappText').focus();$('whatsappText').select();$('whatsappCopyStatus').textContent='Select and copy the message / 请复制选中的内容';}
};
// Refresh the recipient/revision before opening an external manual-send link.
$('whatsappOpen').onclick=async event=>{
 event.preventDefault();
 if(!whatsappDraft||!canDispatch())return;
 const before=whatsappDraft,epoch=accessEpoch;
 try{
  const latest=await rpc('e2_prepare_runner_whatsapp',{target:before.job.id,expected_revision:before.job.revision});
  if(epoch!==accessEpoch||!$('whatsappDialog').open)return;
  if(latest.mode==='simulation'||!latest.phone||!latest.verified_at||latest.phone!==before.phone)throw Error('Recipient changed. Close and reopen this preview / 收件人已变更，请重新打开预览');
  window.location.assign(whatsappURL(latest.phone,runnerMessage(latest.job)));
  $('whatsappCopyStatus').textContent='WhatsApp requested. Send manually; acceptance remains pending. / 已请求打开 WhatsApp，请手动发送；仍需 Runner 确认接单。';
 }catch(e){$('whatsappOpen').hidden=true;error('whatsappCopyStatus',e);}
};
function renderRepairChoices(selected=''){
 const q=$('repairPlateSearch').value.trim().toLowerCase(),select=$('claimForm').elements.inspection_id;
 const rows=data.inspections.filter(i=>i.plate.toLowerCase().includes(q));
 select.innerHTML='<option value="">Choose vehicle / 请先选择车牌</option>'+rows.map(i=>`<option value="${i.id}">${esc(i.plate)} · ${esc(i.workshop||'Workshop pending')} · ${esc(i.status)}</option>`).join('');
 select.value=rows.some(i=>i.id===selected)?selected:'';
 $('repairPlateHint').textContent=rows.length?`${rows.length} inspection records / 项检查记录`:'No matching inspection. Create a vehicle inspection first. / 没有对应检查记录，请先建立车辆检查。';
 updateClaimVehicle();
}
function updateClaimVehicle(){
 const i=data.inspections.find(i=>i.id===$('claimForm').elements.inspection_id.value),j=data.jobs.find(j=>j.id===$('claimForm').dataset.job);
 const plate=currentClaim?.plate||i?.plate||j?.plate;
 $('claimVehicle').textContent=plate?`Recorded against vehicle / 记录车辆：${plate}`:'Choose the vehicle before saving or uploading / 保存或上传前请先选择车牌';
}
function openClaim(id=null,jobId=null){
 pendingClaimFile=null;
 currentClaim=id?{...data.claims.find(c=>c.id===id)}:null;claimRequest=currentClaim?.id||crypto.randomUUID();
 const preferred=new URLSearchParams(location.search).get('inspection');
 const c=currentClaim||{kind:jobId?'petrol':'repair',job_id:jobId,expense_date:today(),inspection_id:data.inspections.some(i=>i.id===preferred)?preferred:null};
 const f=$('claimForm');f.reset();f.dataset.kind=c.kind;f.dataset.job=c.job_id||'';
 $('claimTitle').textContent=names[c.kind];$('claimSummary').innerHTML=currentClaim?`${badge(c.status)} <strong>${esc(c.plate)}</strong>${c.review_note?`<p class="reviewNotice">${esc(c.review_note)}</p>`:''}${c.paid_at?`<p>Paid / 已付款：${esc(c.payment_date)} · ${esc(c.payment_reference)}</p>`:''}`:'<p>Save a draft, archive the receipt, then submit for approval. / 保存草稿、上传凭证后提交。</p>';
 $('inspectionField').hidden=c.kind!=='repair';
 $('repairPlateSearch').value='';f.elements.inspection_id.required=c.kind==='repair';
 renderRepairChoices(c.inspection_id||'');
 for(const key of ['supplier','invoice_no','expense_date','amount','description','inspection_id'])if(c[key]!=null)f.elements[key].value=c[key];
 updateClaimVehicle();
 f.elements.expense_date.max=today();f.elements.inspection_id.disabled=!!currentClaim;
 $('claimFields').disabled=!canEdit(currentClaim);$('saveClaim').hidden=!canEdit(currentClaim);
 $('claimMessage').textContent='';$('reviewForm').reset();
 const actions=[];
 if(currentClaim){
  if(canEdit(c))actions.push(['submit','Submit to Admin / 提交审批']);
  if(admin()&&c.status==='submitted')actions.push(['approve','Approve / 批准'],['return','Return / 退回']);
  if(data.role==='account'&&['approved','verified'].includes(c.status)){actions.push(['query','Return to Admin / 退回 Admin']);if(c.status==='approved')actions.unshift(['verify','Verified / 核对通过']);else actions.unshift(['paid','Record payment / 记录付款']);}
 }
 $('reviewForm').hidden=!actions.length;$('reviewNoteField').hidden=actions.length===1&&actions[0][0]==='submit';
 $('paymentFields').hidden=data.role!=='account'||c.status!=='verified';
 $('reviewForm').elements.payment_date.max=today();$('reviewForm').elements.payment_date.value=today();
 $('claimActions').innerHTML=actions.map(([key,label])=>`<button type="submit" name="action" value="${key}" ${['return','query'].includes(key)?'class="quiet"':''}>${label}</button>`).join('');
 if(currentClaim&&!canEdit(c)&&data.role==='inspector')$('claimMessage').textContent='Submitted bills are read-only. Ask Admin to return this bill for additional files. / 已提交账单只能查看，需补照片请 Admin 退回；新账单请点「新增维修账单」。';
 if(currentClaim){mountFiles('claimDialog','claimFiles',{claim_id:id},canEdit(c)?[c.kind==='petrol'?'receipt':'invoice']:data.role==='account'&&c.status==='verified'?['payment']:[]);history('claimHistory',id,'claim_id');}
 else{
 $('claimFiles').innerHTML='<h3>Upload invoice / receipt · 上传账单／收据</h3><div class="fileTools"><p>Choose a file or take a photo now. Complete the vehicle and amount, then save and upload. / 可先选文件或拍照，再填写车牌和金额，保存并上传。</p><div class="buttonRow"><button type="button" id="chooseNewInvoice">Choose file / 选择文件</button><button type="button" id="takeNewInvoice">Take photo / 拍照</button></div><input id="newInvoiceFile" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" hidden><input id="newInvoiceCamera" type="file" accept="image/*" capture="environment" hidden><p id="newInvoiceSelected">No file selected / 未选文件</p><button type="button" id="saveUploadInvoice" disabled>Save & upload / 保存并上传</button></div>';
 $('chooseNewInvoice').onclick=()=>$('newInvoiceFile').click();$('takeNewInvoice').onclick=()=>$('newInvoiceCamera').click();
 for(const id of ['newInvoiceFile','newInvoiceCamera'])$(id).onchange=()=>{const file=$(id).files?.[0];if(!file)return;pendingClaimFile=file;dirty.add('claimDialog');$('newInvoiceSelected').textContent=file.name;$('claimCaptureNote').textContent='Selected / 已选：'+file.name;$('saveUploadInvoice').disabled=false;};
 $('saveUploadInvoice').onclick=()=>$('claimForm').requestSubmit();
 $('claimHistory').textContent='';panels.claimDialog?.dispose();delete panels.claimDialog;}
 $('claimCaptureActions').hidden=!!currentClaim&&!canEdit(c)&&!(data.role==='account'&&c.status==='verified');$('claimCaptureNote').textContent='';
 $('claimChooseFile').onclick=()=>{const input=currentClaim?$('claimFiles').querySelector('input[name=file]'):$('newInvoiceFile');input?.click();};
 $('claimTakePhoto').onclick=()=>{const input=currentClaim?$('claimFiles').querySelector('input[name=camera]'):$('newInvoiceCamera');input?.click();};
 dirty.delete('claimDialog');if(!$('claimDialog').open)show('claimDialog');
}
$('createJob').onclick=()=>openDispatch();
$('acceptJob').onclick=()=>action('jobMessage',async()=>{await rpc('e2_accept_runner_job',{target:currentJob.id,expected_revision:currentJob.revision});await reload();openJob(currentJob.id);});
$('createRepair').onclick=()=>openClaim();
$('editDispatch').onclick=()=>{if(close('jobDialog'))openDispatch(currentJob);};
$('petrolClaim').onclick=()=>{if(close('jobDialog'))openClaim(null,currentJob.id);};
$('dispatchForm').onsubmit=event=>{event.preventDefault();action('dispatchMessage',async()=>{
 const f=event.target,details=Object.fromEntries(new FormData(f));details.vehicle_id=f.elements.vehicle_id.value;details.kind=f.elements.kind.value;details.appointment_at=details.appointment_at?details.appointment_at+':00+08:00':null;
 const saved=await rpc('e2_save_runner_job',{request_id:dispatch.id,expected_revision:dispatch.revision,details});await reload();dirty.delete('dispatchDialog');$('dispatchDialog').close();openJob(saved.id);
});};
$('movementForm').onsubmit=event=>{event.preventDefault();action('jobMessage',async()=>{
 if(panels.jobDialog?.pending())throw Error('Upload the selected file before changing the job status. / 请先上传附件再更新状态。');
 const f=event.target;await rpc('e2_move_runner_job',{target:currentJob.id,expected_revision:currentJob.revision,next_status:f.elements.next_status.value,mileage:f.elements.mileage.value===''?null:Number(f.elements.mileage.value),note:f.elements.note.value});await reload();dirty.delete('jobDialog');openJob(currentJob.id);
});};
$('claimForm').onsubmit=event=>{event.preventDefault();action('claimMessage',async()=>{
 const selectedFile=pendingClaimFile;
 const f=event.target,details=Object.fromEntries(new FormData(f));details.kind=f.dataset.kind;details.job_id=f.dataset.job||null;details.inspection_id=details.kind==='repair'?f.elements.inspection_id.value:null;
 const saved=await rpc('e2_save_ops_claim',{request_id:claimRequest,expected_revision:currentClaim?.revision??null,details});await reload();openClaim(saved.id);if(selectedFile){panels.claimDialog.choose(selectedFile);await panels.claimDialog.upload();}$('claimMessage').textContent=selectedFile?'Draft saved. Check the attachment status below, then submit to Admin. / 草稿已保存，请确认下方附件已存档后提交审批。':'Draft saved. Upload the invoice or receipt before submitting. / 草稿已保存，请上传凭证后提交。';
});};
$('reviewForm').onsubmit=event=>{event.preventDefault();action('claimMessage',async()=>{
 if(dirty.has('claimDialog'))throw Error('Save the edited draft first. / 请先保存修改。');
 if(panels.claimDialog?.pending())throw Error('Upload the selected file first. / 请先上传所选附件。');
 const f=event.target,kind=event.submitter.value;
 await rpc('e2_action_ops_claim',{target:currentClaim.id,expected_revision:currentClaim.revision,action:kind,note:f.elements.note.value,payment_date:kind==='paid'?f.elements.payment_date.value||null:null,payment_reference:kind==='paid'?f.elements.payment_reference.value:null});
 await reload();if(data.claims.some(c=>c.id===currentClaim.id))openClaim(currentClaim.id);else{$('claimDialog').close();panels.claimDialog?.dispose();delete panels.claimDialog;$('message').textContent='Returned to Admin for review. / 已退回 Admin。';}
});};
for(const id of ['dispatchDialog','jobDialog','claimDialog','whatsappDialog']){
 $(id).addEventListener('cancel',event=>{event.preventDefault();close(id);});
 $(id).querySelector('[data-close]').onclick=()=>close(id);
 $(id).querySelectorAll('form').forEach(form=>{if(form.id!=='reviewForm')form.addEventListener('input',()=>dirty.add(id));});
}
for(const id of ['jobsTab','claimsTab'])$(id).onclick=()=>{view=id==='jobsTab'?'jobs':'claims';$('filter').value='all';render();};
$('search').oninput=renderRecords;$('filter').onchange=renderRecords;$('plateFilter').onchange=renderRecords;
$('repairPlateSearch').oninput=()=>renderRepairChoices($('claimForm').elements.inspection_id.value);$('claimForm').elements.inspection_id.onchange=updateClaimVehicle;
$('refresh').onclick=()=>action('message',reload);
$('signOut').onclick=async()=>{if(busy)return;for(const id of Object.keys(panels)){panels[id].dispose();}check(await db.auth.signOut());location.replace('portal.html');};
addEventListener('beforeunload',event=>{if(busy||dirty.size||Object.values(panels).some(p=>p.pending())){event.preventDefault();event.returnValue='';}});
db?.auth.onAuthStateChange?.((event,session)=>{
 if(event==='SIGNED_OUT'){clearAccess();}
 else if(event==='SIGNED_IN'&&data&&session?.user?.id!==data.user_id){clearAccess();setTimeout(()=>start().catch(e=>error('message',e)),0);}
});
async function start(){
 if(!configured)throw Error('Workspace connection is unavailable. / 工作区连接未配置。');
 const session=check(await db.auth.getSession());if(!session.session){$('signIn').hidden=false;throw Error('Sign in with your staff account. / 请使用员工账号登录。');}
 await reload();const inspection=data.inspections.find(i=>i.id===new URLSearchParams(location.search).get('inspection'));if(['account','inspector'].includes(data.role)||inspection){view='claims';if(inspection)$('search').value=inspection.plate;render();}
 const job=new URLSearchParams(location.search).get('job');if(job){if(data.jobs.some(j=>j.id===job))openJob(job);else $('message').textContent='Job unavailable for this account. / 此账号无权查看该任务。';}
}
start().catch(e=>{error('message',e);$('workspace').hidden=true;$('signIn').hidden=false;});
setInterval(()=>{if(data&&['runner','admin','super_admin'].includes(data.role)&&!document.hidden&&!busy&&!dirty.size&&!document.querySelector('dialog[open]'))action('message',reload);},15000);
