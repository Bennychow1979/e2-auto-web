import {db,configured,check,esc,friendlyError} from './e2-data.js?v=inspector-1';
import {inspectionPhotos} from './inspection-photos.js?v=1';
const $=id=>document.getElementById(id);
const statuses=['Pending inspection','Inspecting','Repair required','Repair booked','In repair','Ready','Cancelled'];
const checks={cushion:'Cushion / upholstery · 座椅／坐垫',windscreen:'Windscreen / glass · 大镜／挡风玻璃',engine:'Engine · 引擎',transmission:'Transmission · 变速箱',brakes:'Brakes · 刹车',tyres:'Tyres · 轮胎',body:'Body / paint · 车身',electrical:'Electrical / A/C · 电器冷气',road_test:'Road test · 路试'};
const results={unchecked:'Not checked · 未检查',pass:'Pass · 合格',attention:'Needs attention · 需处理',not_applicable:'Not applicable · 不适用'};
let data={vehicles:[],staff:[],jobs:[]},session=null,current=null,busy=false,epoch=0,newId=null,dirty=false;
const photos=inspectionPhotos({db,check,esc,lock,isCurrent:id=>!!session&&current?.id===id});
const closed=j=>['Ready','Cancelled'].includes(j.status);
const vehicle=id=>data.vehicles.find(v=>v.id===id);
const person=id=>data.staff.find(s=>s.id===id)?.name||'Former / inactive staff';
const vehicleName=v=>v?`${v.plate} · ${v.label} · ${v.year}`:'Vehicle unavailable';
const options=(rows,value,label)=>rows.map(r=>`<option value="${esc(value(r))}">${esc(label(r))}</option>`).join('');
function note(id,text,error=false){$(id).textContent=text;$(id).classList.toggle('error',error)}
function lock(value){busy=value;for(const id of ['refresh','newJob','createJob','closeCreate','closeEditor','signOut'])$(id).disabled=value;$('editFields').disabled=value||!!(current&&closed(current));$('photoFields').disabled=value||!!(current&&closed(current));$('newVehicle').disabled=value;$('newAssignee').disabled=value;}
function gate(text){photos.reset();epoch++;data={vehicles:[],staff:[],jobs:[]};current=null;session=null;dirty=false;$('jobs').replaceChildren();$('history').replaceChildren();$('editForm').reset();$('createForm').reset();$('vehicleDetails').textContent='';$('checklist').replaceChildren();$('workshopSelect').replaceChildren();$('newWorkshopField').hidden=true;$('workshop').required=false;$('workshopMessage').textContent='';$('editor').close();$('createDialog').close();$('workspace').hidden=true;$('signIn').hidden=false;$('signOut').hidden=true;note('message',text,true)}
async function load(){const ticket=++epoch;try{
 if(!configured)throw Error('Workspace connection is not configured.');
 const auth=check(await db.auth.getSession()).session;if(!auth){gate('Sign in with an Inspector or Admin account.');return;}
 const [workspace,workshops]=await Promise.all([db.rpc('e2_inspection_workspace'),db.rpc('e2_inspection_workshops').catch(error=>({error}))]);const rows=check(workspace);if(ticket!==epoch)return;
 rows.workshops=workshops.error?[]:check(workshops);rows.workshopListUnavailable=!!workshops.error;
 session=auth;data=rows;$('workspace').hidden=false;$('signIn').hidden=true;$('signOut').hidden=false;
 $('vehiclesLink').hidden=data.staff.find(x=>x.id===auth.user.id)?.role==='inspector';
 note('message',`${auth.user.email} · Inspection and repair workspace`);render();
 }catch(e){if(ticket===epoch)gate(friendlyError(e));}}
function render(){const query=$('search').value.toLowerCase(),filter=$('filter').value,today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kuala_Lumpur'}).format(new Date());
 const jobs=data.jobs.filter(j=>(filter==='all'||(filter==='open'?!closed(j):j.status===filter))&&[vehicleName(vehicle(j.vehicle_id)),j.findings,j.workshop].join(' ').toLowerCase().includes(query));
 $('count').textContent=`${jobs.length} records · ${data.jobs.filter(j=>!closed(j)).length} open`;
 $('jobs').innerHTML=jobs.map(j=>`<article class="job"><div><span class="badge">${esc(j.status)}</span><h2>${esc(vehicle(j.vehicle_id)?.plate)}</h2><p>${esc(vehicleName(vehicle(j.vehicle_id)))}</p><p>Responsible: ${esc(person(j.assigned_to))}</p>${j.workshop?`<p class="${!closed(j)&&j.repair_date<today?'overdue':''}">${esc(j.workshop)} · ${esc(j.repair_date||'Date pending')}${j.repair_time?' · '+esc(j.repair_time.slice(0,5)):''}</p>`:''}<p>${esc(j.findings.slice(0,180))}</p></div><button data-job="${j.id}">${closed(j)?'View record':'Manage inspection'} ↗</button></article>`).join('')||'<p>No matching inspections. Start an inspection to record checks for a vehicle.</p>';
 document.querySelectorAll('[data-job]').forEach(b=>b.onclick=()=>{if(!busy)open(data.jobs.find(j=>j.id===b.dataset.job));});}
const cleanWorkshop=value=>String(value||'').trim().replace(/\s+/g,' ');
function workshopNames(){const unique=new Map();for(const raw of [...(data.workshops||[]),...data.jobs.map(j=>j.workshop)]){const name=cleanWorkshop(raw);if(name&&!unique.has(name.toLowerCase()))unique.set(name.toLowerCase(),name);}return [...unique.values()].sort((a,b)=>a.localeCompare(b));}
function renderWorkshops(selected=''){
 const names=workshopNames(),name=cleanWorkshop(selected);if(name&&!names.some(n=>n.toLowerCase()===name.toLowerCase()))names.push(name);
 $('workshopSelect').innerHTML='<option value="">No workshop selected / 未选择</option>'+options(names.map((name,index)=>({name,index})),r=>String(r.index),r=>r.name)+'<option value="new">+ Add new workshop / 新增维修厂</option>';
 const index=names.findIndex(n=>n.toLowerCase()===name.toLowerCase());$('workshopSelect').value=index<0?'':String(index);$('workshop').value=name;$('workshop').required=false;$('newWorkshopField').hidden=true;
 note('workshopMessage',data.workshopListUnavailable?'Workshop history is temporarily unavailable. You can choose from loaded records or enter a name. / 暂时无法加载维修厂历史名单，可选现有记录中的名称或自行输入。':'Choose a saved workshop, or add a new one. New names join the list after Save inspection. / 选择已存维修厂，或新增；保存检查记录后才加入名单。',data.workshopListUnavailable);
 $('workshopSelect').onchange=()=>{dirty=true;const value=$('workshopSelect').value,isNew=value==='new';$('newWorkshopField').hidden=!isNew;$('workshop').required=isNew;$('workshop').value=value===''||isNew?'':names[Number(value)];if(isNew)$('workshop').focus();};
}
function savedWorkshop(){const name=cleanWorkshop($('workshop').value);return workshopNames().find(n=>n.toLowerCase()===name.toLowerCase())||name;}
function assigneeOptions(selected){let rows=[...data.staff];if(selected&&!rows.some(s=>s.id===selected))rows.push({id:selected,name:'Former / inactive staff'});return options(rows,s=>s.id,s=>s.name);}
async function open(job){current={...job};dirty=false;const ticket=epoch;$('vehicleDetails').textContent=vehicleName(vehicle(job.vehicle_id));$('status').innerHTML=options(statuses,s=>s,s=>s);$('status').value=job.status;$('assignee').innerHTML=assigneeOptions(job.assigned_to);$('assignee').value=job.assigned_to;
 $('checklist').innerHTML=Object.entries(checks).map(([key,label])=>`<label>${label}<select data-check="${key}" aria-label="${label}">${options(Object.entries(results),r=>r[0],r=>r[1])}</select></label>`).join('');document.querySelectorAll('[data-check]').forEach(s=>s.value=job.checklist[s.dataset.check]||'unchecked');
 for(const [id,key] of [['findings','findings'],['workshop','workshop'],['repairDate','repair_date'],['repairTime','repair_time'],['repairNotes','repair_notes'],['completionNotes','completion_notes']])$(id).value=job[key]||'';
 renderWorkshops(job.workshop);
 note('editMessage',closed(job)?'Closed record · Start a new inspection for further work.':'');$('history').textContent='Loading history…';lock(false);$('editor').showModal();void photos.open(job);
 try{const rows=check(await db.from('e2_vehicle_inspection_events').select('action,snapshot,created_at').eq('inspection_id',job.id).order('created_at',{ascending:false}));if(ticket!==epoch||current?.id!==job.id)return;
 $('history').innerHTML=rows.map(r=>`<div class="historyItem"><strong>${esc(r.action)}</strong> · ${esc(new Date(r.created_at).toLocaleString('en-MY',{timeZone:'Asia/Kuala_Lumpur'}))} MY<br>${esc(r.snapshot.findings||'')}${r.snapshot.repair_notes?'\n'+esc(r.snapshot.repair_notes):''}${r.snapshot.completion_notes?'\n'+esc(r.snapshot.completion_notes):''}</div>`).join('');
 }catch(e){if(ticket===epoch&&current?.id===job.id)$('history').textContent=friendlyError(e);}}
function closeEditor(){if(busy)return;if((dirty||photos.hasPending())&&!confirm('Discard unsaved inspection changes or selected photos?'))return;dirty=false;current=null;photos.reset();$('editor').close();}
for(const id of ['search','filter'])$(id).addEventListener(id==='search'?'input':'change',render);
$('refresh').onclick=()=>{if(!busy)load()};$('closeEditor').onclick=closeEditor;
$('editor').addEventListener('cancel',e=>{e.preventDefault();closeEditor()});$('editForm').oninput=e=>{if(!e.target.closest('.defectPhotos'))dirty=true};
$('newJob').onclick=()=>{if(busy)return;newId=crypto.randomUUID();$('newVehicle').innerHTML='<option value="">Choose a vehicle</option>'+options(data.vehicles.filter(v=>!data.jobs.some(j=>j.vehicle_id===v.id&&!closed(j))),v=>v.id,vehicleName);$('newAssignee').innerHTML=assigneeOptions();$('newAssignee').value=session.user.id;note('createMessage','');$('createDialog').showModal();};
$('closeCreate').onclick=()=>{if(!busy)$('createDialog').close()};$('createDialog').addEventListener('cancel',e=>{if(busy)e.preventDefault()});
$('createForm').onsubmit=async e=>{e.preventDefault();if(busy)return;lock(true);note('createMessage','Saving…');try{const job=check(await db.rpc('e2_start_inspection',{request_id:newId,car:$('newVehicle').value,assignee:$('newAssignee').value}));$('createDialog').close();await load();if(session)await open(job);}catch(e){note('createMessage',friendlyError(e),true)}finally{lock(false)}};
$('editForm').onsubmit=async e=>{e.preventDefault();if(busy||!current||closed(current))return;if(photos.hasPending()){note('editMessage','Upload the selected photos first, or clear the file selection before saving. / 请先上传已选照片，或清除文件选择后再保存。',true);return;}const target={...current},changes={status:$('status').value,assigned_to:$('assignee').value,checklist:Object.fromEntries([...document.querySelectorAll('[data-check]')].map(s=>[s.dataset.check,s.value])),findings:$('findings').value,workshop:savedWorkshop(),repair_date:$('repairDate').value||null,repair_time:$('repairTime').value||null,repair_notes:$('repairNotes').value,completion_notes:$('completionNotes').value};lock(true);note('editMessage','Saving…');try{const saved=check(await db.rpc('e2_save_inspection',{target:target.id,expected_revision:target.revision,changes}));dirty=false;await load();if(session){await open(saved);note('editMessage','Saved. '+(closed(saved)?'This record is now closed.':''));}}catch(e){note('editMessage',friendlyError(e),true)}finally{lock(false)}};
$('signOut').onclick=async()=>{if(busy)return;try{check(await db.auth.signOut());gate('Signed out.')}catch(e){note('message',friendlyError(e),true)}};
db?.auth.onAuthStateChange(e=>{if(e==='SIGNED_OUT')gate('Signed out.')});window.addEventListener('beforeunload',e=>{if(dirty||busy||photos.hasPending()){e.preventDefault();e.returnValue=''}});
window.addEventListener('focus',()=>{if(!busy&&!$('editor').open&&!$('createDialog').open)load()});await load();
