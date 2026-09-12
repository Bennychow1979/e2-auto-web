'use strict';
(()=>{
const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const seed=()=>({
cars:[
{id:'c1',brand:'Toyota',model:'RAV4',spec:'2.0 — sample spec',cc:2000,fuel:'PETROL',transmission:'Auto',plate:'DEMO01',year:2018,price:89900,status:'Available',img:'https://images.unsplash.com/photo-1615887110697-0819ec23465f?auto=format&fit=crop&w=800&q=80'},
{id:'c2',brand:'Polestar',model:'2',spec:'Electric — sample spec',cc:0,fuel:'ELECTRIC',transmission:'Single-speed (EV)',plate:'DEMO02',year:2022,price:168000,status:'Reserved',img:'https://images.unsplash.com/photo-1617727553401-3ec4e92f32a5?auto=format&fit=crop&w=800&q=80'},
{id:'c3',brand:'BMW',model:'M4',spec:'3.0 — sample spec',cc:3000,fuel:'PETROL',transmission:'DCT',plate:'DEMO03',year:2019,price:238000,status:'Available',img:'https://images.unsplash.com/photo-1614026480209-cd9934144671?auto=format&fit=crop&w=800&q=80'}],
leads:[
{id:'l1',name:'Sample customer 01',car:'c1',owner:'A',stage:'New enquiry',note:'Interested in a family SUV. Discuss a suitable viewing time.'},
{id:'l2',name:'Sample customer 02',car:'c2',owner:'A',stage:'Viewing arranged',note:'Ask about trade-in details during the viewing.'},
{id:'l3',name:'Sample customer 03',car:'c3',owner:'B',stage:'Contacted',note:'Requested more vehicle information.'}],
visits:[{id:'v1',lead:'l2',when:'',status:'To confirm',note:'Confirm date and time with customer.'}]
});
let data=seed(),role='',view='overview',edit=null,toastTimer;
const stages=['New enquiry','Contacted','Viewing arranged','Negotiating','Won','Closed'];
const fuelTypes=['PETROL','DIESEL','HYBRID','ELECTRIC'];
const transmissions=['Auto','Manual','CVT','DCT','Single-speed (EV)'];
const vehicleName=c=>c?[c.brand,c.model].filter(Boolean).join(' '):'Vehicle unavailable';
const carName=id=>vehicleName(data.cars.find(c=>c.id===id));
const ownLeads=()=>data.leads.filter(l=>role==='admin'||l.owner==='A');
const visits=()=>data.visits.filter(v=>ownLeads().some(l=>l.id===v.lead));
const canLead=id=>ownLeads().some(l=>l.id===id);
const money=n=>'RM'+Number(n).toLocaleString('en-MY');
const badge=s=>'<span class="status '+(s==='Reserved'||s==='New enquiry'||s==='To confirm'?'warm':s==='Sold'||s==='Closed'||s==='Cancelled'?'neutral':'')+'">'+esc(s)+'</span>';
const button=(label,action,id='',cls='textButton')=>'<button class="'+cls+'" data-action="'+action+'" data-id="'+esc(id)+'">'+label+'</button>';
const head=(label,title,desc,action='')=>'<div class="pageHead"><div><span class="eyebrow">'+label+'</span><h1>'+title+'</h1><p>'+desc+'</p></div>'+action+'</div>';
function notify(message){clearTimeout(toastTimer);$('toast').textContent=message;$('toast').hidden=false;toastTimer=setTimeout(()=>$('toast').hidden=true,3500)}
function enter(r){role=r;view='overview';$('entry').hidden=true;$('workspace').hidden=false;$('avatar').textContent=r==='admin'?'A':'S';$('profileName').textContent=r==='admin'?'Demo Admin':'Demo Sales A';$('profileRole').textContent=r==='admin'?'ADMIN · DEMO':'SALESMAN · DEMO';$('teamNav').hidden=r!=='admin';render();window.scrollTo(0,0)}
function leadRow(l){return '<article class="listRow"><div><h3>'+esc(l.name)+'</h3><p>'+esc(carName(l.car))+' · Sales '+esc(l.owner)+'</p><p>'+esc(l.note)+'</p></div><div class="actions">'+badge(l.stage)+button('Update','lead',l.id)+button('Book viewing','visitNew',l.id)+'</div></article>'}
function visitRow(v){const l=data.leads.find(l=>l.id===v.lead);return '<article class="listRow"><div><h3>'+esc(l?.name||'Sample customer')+'</h3><p>'+esc(carName(l?.car))+' · '+(v.when?esc(v.when.replace('T',' · '))+' MYT':'Date &amp; time to be confirmed')+'</p><p>'+esc(v.note)+'</p></div><div class="actions">'+badge(v.status)+button('Edit viewing','visit',v.id)+'</div></article>'}
function overview(){const ls=ownLeads();const active=ls.filter(l=>!['Won','Closed'].includes(l.stage));const vs=visits().filter(v=>!['Completed','Cancelled'].includes(v.status));return head(role==='admin'?'YOUR SHOWROOM, AT A GLANCE':'YOUR DAY, IN FOCUS',role==='admin'?'A clearer overview.':'Make the next move.',role==='admin'?'Manage the sample inventory and keep the team moving.':'Demo Sales A · Your assigned enquiries and viewings.',button(role==='admin'?'Add a vehicle':'Add an enquiry',role==='admin'?'carNew':'leadNew','','primary'))+
'<div class="metrics"><div class="metric"><small>Available cars</small><strong>'+data.cars.filter(c=>c.status==='Available').length+'</strong><p>Sample inventory</p></div><div class="metric"><small>'+ (role==='admin'?'Open enquiries':'My open enquiries')+'</small><strong>'+active.length+'</strong><p>Awaiting a next step</p></div><div class="metric"><small>Active viewings</small><strong>'+vs.length+'</strong><p>Including unconfirmed</p></div></div><section class="panel"><div class="sectionTitle"><h2>Customer follow-up</h2>'+button('View all ↗','goLeads')+'</div>'+ (active.slice(0,3).map(leadRow).join('')||'<p class="empty">No open enquiries.</p>')+'</section><section class="panel"><div class="sectionTitle"><h2>Viewing schedule</h2>'+button('View schedule ↗','goVisits')+'</div>'+(vs.map(visitRow).join('')||'<p class="empty">No active viewings.</p>')+'</section>'}
function vehicles(){return head('INVENTORY','Every car, in one place.','Sample cars and prices only. Changes here do not publish to the showroom.',role==='admin'?button('Add vehicle','carNew','','primary'):'')+'<div class="toolbar"><input id="vehicleSearch" type="search" aria-label="Search vehicles" placeholder="Search brand, model, spec or plate…"><select id="vehicleStatus" aria-label="Vehicle status"><option value="">All statuses</option><option>Available</option><option>Reserved</option><option>Sold</option></select></div><div id="vehicleList" class="vehicleGrid"></div>'}
function drawVehicles(){const q=($('vehicleSearch')?.value||'').toLowerCase().trim(),status=$('vehicleStatus')?.value||'';const cars=data.cars.filter(c=>(vehicleName(c)+' '+c.spec+' '+c.plate).toLowerCase().includes(q)&&(!status||c.status===status));$('vehicleList').innerHTML=cars.map(c=>'<article class="vehicleCard"><div class="vehiclePhoto">'+(c.img?'<img src="'+esc(c.img)+'" alt="'+esc(vehicleName(c))+' sample photo" loading="lazy">':'<span class="placeholder">Photo not added</span>')+'<span>SAMPLE VEHICLE</span></div><div class="vehicleInfo">'+badge(c.status)+'<h2>'+esc(vehicleName(c))+'</h2><p>'+esc(c.year)+' · '+esc(c.plate)+'</p><p>'+esc(c.spec)+'<br>'+Number(c.cc).toLocaleString('en-MY')+' cc · '+esc(c.transmission)+' · '+esc(c.fuel)+'</p><div class="vehiclePrice">'+money(c.price)+'</div><div class="vehicleBottom"><p>Illustrative price<br>'+carMedia(c).filter(m=>m.type==='photo').length+' photos · '+carMedia(c).filter(m=>m.type==='video').length+' videos</p>'+button(role==='admin'?'Edit vehicle':'Add enquiry',role==='admin'?'car':'carLead',c.id,'secondary')+'</div></div></article>').join('')||'<p class="empty">No matching vehicles.</p>'}
function leads(){return head('CUSTOMER FOLLOW-UP',role==='admin'?'Keep every enquiry moving.':'Your customers. Your next step.',role==='admin'?'Assign enquiries and follow the team’s progress.':'Only Demo Sales A’s assigned enquiries are shown in this preview.',button('Add enquiry','leadNew','','primary'))+'<div class="toolbar"><input id="leadSearch" type="search" aria-label="Search customers" placeholder="Search sample customer or vehicle…"><select id="leadStage" aria-label="Customer stage"><option value="">All stages</option>'+stages.map(s=>'<option>'+s+'</option>').join('')+'</select></div><section id="leadList" class="panel"></section>'}
function drawLeads(){const q=($('leadSearch')?.value||'').toLowerCase().trim(),stage=$('leadStage')?.value||'';$('leadList').innerHTML=ownLeads().filter(l=>(l.name+' '+carName(l.car)).toLowerCase().includes(q)&&(!stage||l.stage===stage)).map(leadRow).join('')||'<p class="empty">No matching enquiries.</p>'}
function viewings(){return head('VIEWING SCHEDULE','Make time for a closer look.','All times are Malaysia time. Saving a demo booking does not send a message.',button('Book viewing','visitNew','','primary'))+'<section class="panel">'+(visits().map(visitRow).join('')||'<p class="empty">No viewings yet. Book a sample viewing to try the flow.</p>')+'</section>'}
function team(){return head('TEAM & ROLES','The right access.','Proposed permissions for the production system. This page is a workflow preview.')+'<section class="panel"><div class="sectionTitle"><h2>Demo team</h2></div><article class="listRow"><div><h3>Demo Admin</h3><p>All inventory and customer enquiries</p></div>'+badge('Admin')+'</article>'+['A','B'].map(x=>'<article class="listRow"><div><h3>Demo Sales '+x+'</h3><p>'+data.leads.filter(l=>l.owner===x).length+' assigned sample enquiries</p></div>'+badge('Salesman')+'</article>').join('')+'</section><section class="panel"><h2>Role plan</h2><div class="roleMatrix"><table><thead><tr><th>Role</th><th>Vehicles</th><th>Customers</th><th>Finance</th></tr></thead><tbody><tr><td>Admin</td><td>Manage</td><td>All + assign</td><td>By approved policy</td></tr><tr><td>Salesman</td><td>View</td><td>Assigned only</td><td>Own commission summary</td></tr><tr class="planned"><td>Account · Next phase</td><td>View</td><td>Transaction details only</td><td>Receipts, payments, commissions</td></tr><tr class="planned"><td>Customer · Next phase</td><td>Public listings</td><td>Own profile only</td><td>Own orders / application status</td></tr></tbody></table></div><p class="tableNote">正式权限将由后台验证。Real account invitations, passwords, database access and financial records are not enabled in this demo.</p></section>'}
function render(){if(!role)return;if(view==='team'&&role!=='admin')view='overview';$('breadcrumb').textContent=({overview:'Overview',vehicles:'Vehicles',leads:'Customers',viewings:'Viewings',team:'Team & roles'})[view];document.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-current',b.dataset.view===view?'page':'false'));$('page').innerHTML=({overview,vehicles,leads,viewings,team})[view]();if(view==='vehicles')drawVehicles();if(view==='leads')drawLeads()}
function field(label,name,value='',type='text',full=false){return '<label class="field'+(full?' full':'')+'">'+label+'<input name="'+name+'" type="'+type+'" value="'+esc(value)+'" '+(type==='number'?'min="0" step="1" ':'maxlength="100" ')+'required></label>'}
function select(label,name,value,options,full=false){return '<label class="field'+(full?' full':'')+'">'+label+'<select name="'+name+'" required>'+options.map(o=>{const v=typeof o==='string'?o:o.value;return '<option value="'+esc(v)+'" '+(v===value?'selected':'')+'>'+esc(typeof o==='string'?o:o.label)+'</option>'}).join('')+'</select></label>'}
const noteField=value=>'<label class="field full">Follow-up notes (fictional only)<textarea name="note" maxlength="500">'+esc(value)+'</textarea></label>';

let mediaDraft=[],mediaDrag=null,mediaSerial=0;
const objectURLs=new Set();
const carMedia=c=>c.media?c.media.map(m=>({...m})):(c.img?[{id:'seed-'+c.id,type:'photo',url:c.img,name:'Sample vehicle photo'}]:[]);
function releaseUnusedMedia(){const used=new Set([...data.cars.flatMap(c=>(c.media||[]).map(m=>m.url)),...mediaDraft.map(m=>m.url)]);for(const url of objectURLs)if(!used.has(url)){URL.revokeObjectURL(url);objectURLs.delete(url)}}
function mediaSection(){return '<section class="mediaSection"><div class="mediaHeading"><div><h3>Photos &amp; Videos</h3><p id="mediaCount" role="status"></p></div><span class="status warm">LOCAL PREVIEW</span></div><p class="mediaHelp">本机预览 · 不会上传。Save demo changes keeps your selection until refresh; closing without saving discards changes.</p><div id="mediaDrop" class="mediaDrop"><strong>Add a closer look.</strong><p>Drop files here, or choose from your device.</p><div class="mediaPickers"><button type="button" id="choosePhotos" class="secondary">＋ Photos</button><button type="button" id="chooseVideos" class="secondary">＋ Videos</button></div><input id="photoFiles" type="file" accept="image/jpeg,image/png,image/webp" multiple hidden><input id="videoFiles" type="file" accept="video/mp4,video/webm" multiple hidden><small>Photos: JPG / PNG / WebP · 20 MB each · max 20<br>Videos: MP4 / WebM · 100 MB each · max 3</small></div><p id="mediaFeedback" class="mediaFeedback" role="status" aria-live="polite"></p><p class="mediaHelp">Drag a tile to reorder, or use ← / →. The first photo is the cover. Videos play on tap; no autoplay. Original files are previewed without compression.</p><div id="mediaGrid" class="mediaGrid"></div></section>'}
function renderMedia(){
if(!$('mediaGrid'))return;
const photos=mediaDraft.filter(m=>m.type==='photo'),videos=mediaDraft.filter(m=>m.type==='video');
$('mediaCount').textContent=photos.length+' / 20 photos · '+videos.length+' / 3 videos';
$('choosePhotos').disabled=photos.length>=20;$('chooseVideos').disabled=videos.length>=3;
$('mediaGrid').innerHTML=mediaDraft.map((m,i)=>'<article class="mediaTile" draggable="true" data-media-id="'+esc(m.id)+'"><div class="mediaPreview">'+(m.type==='photo'?'<img src="'+esc(m.url)+'" alt="'+esc(m.name)+'" draggable="false">':'<video controls playsinline preload="metadata" src="'+esc(m.url)+'" aria-label="'+esc(m.name)+'"></video>')+'<span class="mediaMark">'+(m.type==='photo'?(m.id===photos[0]?.id?'COVER':'PHOTO'):'VIDEO')+'</span></div><p class="mediaFileName" title="'+esc(m.name)+'">'+esc(m.name)+'</p><p class="mediaError" hidden>Cannot preview this file. Remove it and choose a supported image or playable MP4 / WebM.</p><div class="mediaTileActions"><button type="button" data-media-action="left" data-id="'+esc(m.id)+'" aria-label="Move '+esc(m.name)+' earlier" '+(i===0?'disabled':'')+'>←</button><button type="button" data-media-action="right" data-id="'+esc(m.id)+'" aria-label="Move '+esc(m.name)+' later" '+(i===mediaDraft.length-1?'disabled':'')+'>→</button>'+(m.type==='photo'&&m.id!==photos[0]?.id?'<button type="button" data-media-action="cover" data-id="'+esc(m.id)+'">Set cover</button>':'')+'<button type="button" data-media-action="remove" data-id="'+esc(m.id)+'" aria-label="Remove '+esc(m.name)+'">Remove</button></div></article>').join('')||'<p class="mediaEmpty">No media yet. Add your first photo to set the cover.</p>';
$('mediaGrid').querySelectorAll('img,video').forEach(el=>el.addEventListener('error',()=>{el.closest('.mediaTile').querySelector('.mediaError').hidden=false}));
}
function addMedia(files,expected){
const messages=[];let added=0;
for(const file of Array.from(files)){
const type=['image/jpeg','image/png','image/webp'].includes(file.type)?'photo':['video/mp4','video/webm'].includes(file.type)?'video':null;
if(!type||(expected&&type!==expected)){messages.push(file.name+': unsupported format.');continue}
const limit=type==='photo'?20:3,maxBytes=(type==='photo'?20:100)*1024*1024;
if(!file.size||file.size>maxBytes){messages.push(file.name+': file is empty or exceeds '+(type==='photo'?20:100)+' MB.');continue}
if(mediaDraft.filter(m=>m.type===type).length>=limit){messages.push('Maximum '+limit+' '+(type==='photo'?'photos':'videos')+' per vehicle.');continue}
const url=URL.createObjectURL(file);objectURLs.add(url);mediaDraft.push({id:'local-'+(++mediaSerial),type,url,name:file.name});added++;
}
renderMedia();$('mediaFeedback').textContent=(added?added+' file(s) added. ':'')+[...new Set(messages)].join(' ');
}
function setupMedia(){
$('choosePhotos').onclick=()=>$('photoFiles').click();$('chooseVideos').onclick=()=>$('videoFiles').click();
$('photoFiles').onchange=e=>{addMedia(e.target.files,'photo');e.target.value=''};$('videoFiles').onchange=e=>{addMedia(e.target.files,'video');e.target.value=''};
const drop=$('mediaDrop');drop.ondragover=e=>{e.preventDefault();drop.classList.add('isOver')};drop.ondragleave=()=>drop.classList.remove('isOver');drop.ondrop=e=>{e.preventDefault();drop.classList.remove('isOver');addMedia(e.dataTransfer.files)};
$('mediaGrid').onclick=e=>{const b=e.target.closest('[data-media-action]');if(!b)return;const i=mediaDraft.findIndex(m=>m.id===b.dataset.id);if(i<0)return;const a=b.dataset.mediaAction;if(a==='remove')mediaDraft.splice(i,1);else if(a==='cover'){mediaDraft.unshift(...mediaDraft.splice(i,1))}else{const to=i+(a==='left'?-1:1);if(to<0||to>=mediaDraft.length)return;[mediaDraft[i],mediaDraft[to]]=[mediaDraft[to],mediaDraft[i]]}renderMedia();releaseUnusedMedia()};
$('mediaGrid').ondragstart=e=>{if(e.target.closest('button,video')){e.preventDefault();return}mediaDrag=e.target.closest('[data-media-id]')?.dataset.mediaId;if(mediaDrag)e.dataTransfer.setData('text/plain',mediaDrag)};
$('mediaGrid').ondragover=e=>{if(mediaDrag)e.preventDefault()};
$('mediaGrid').ondrop=e=>{e.preventDefault();const target=e.target.closest('[data-media-id]')?.dataset.mediaId;const from=mediaDraft.findIndex(m=>m.id===mediaDrag),to=mediaDraft.findIndex(m=>m.id===target);if(from>=0&&to>=0&&from!==to){mediaDraft.splice(to,0,...mediaDraft.splice(from,1));renderMedia()}mediaDrag=null};
$('mediaGrid').ondragend=()=>mediaDrag=null;
renderMedia();
}
$('editor').addEventListener('close',()=>{$('editor').querySelectorAll('video').forEach(v=>v.pause());mediaDraft=[];mediaDrag=null;releaseUnusedMedia()});


const OTHER_VEHICLE='__enter_manually__';
function vehicleCatalog(){
const catalog=Object.create(null);catalog.Honda=Object.assign(Object.create(null),{'CR-V':['TC-P 2WD']});catalog.Perodua=Object.assign(Object.create(null),{Myvi:[]});
data.cars.forEach(c=>{if(!c.brand||!c.model)return;catalog[c.brand]??=Object.create(null);catalog[c.brand][c.model]??=[];if(c.spec&&!catalog[c.brand][c.model].includes(c.spec))catalog[c.brand][c.model].push(c.spec)});
return catalog;
}
const identityNames={brand:'BRAND',model:'MODEL',spec:'VARIANT'};
function identityField(key){const label=identityNames[key];return '<div class="field identityField"><label for="vehicle-'+key+'">'+label+'</label><select id="vehicle-'+key+'" name="'+key+'" required></select><label id="manual-'+key+'" class="manualIdentity" hidden>Enter '+label.toLowerCase()+'<input id="custom-'+key+'" name="custom_'+key+'" maxlength="100" disabled></label></div>'}
function identityValue(key){const input=$('vehicle-'+key);return input.value===OTHER_VEHICLE?$('custom-'+key).value.trim():input.value}
function toggleManual(key){
const custom=$('vehicle-'+key).value===OTHER_VEHICLE;
$('manual-'+key).hidden=!custom;$('custom-'+key).disabled=!custom;$('custom-'+key).required=custom;
}
function identityOptions(key,choices,value='',enabled=true){
const select=$('vehicle-'+key),known=choices.includes(value),custom=!!value&&!known;
select.innerHTML='<option value="">Select '+identityNames[key].toLowerCase()+'</option>'+choices.map(v=>'<option value="'+esc(v)+'">'+esc(v)+'</option>').join('')+'<option value="'+OTHER_VEHICLE+'">Other / enter manually</option>';
select.disabled=!enabled;select.value=custom?OTHER_VEHICLE:value;$('custom-'+key).value=custom?value:'';toggleManual(key);
}
function setupVehicleIdentity(obj){
const catalog=vehicleCatalog();
identityOptions('brand',Object.keys(catalog).sort(),obj.brand);
identityOptions('model',Object.keys(catalog[obj.brand]||{}).sort(),obj.model,!!obj.brand);
identityOptions('spec',catalog[obj.brand]?.[obj.model]||[],obj.spec,!!obj.model);
function brandChanged(){toggleManual('brand');const brand=identityValue('brand');identityOptions('model',Object.keys(vehicleCatalog()[brand]||{}).sort(),'',!!brand);identityOptions('spec',[],'',false)}
function modelChanged(){toggleManual('model');const brand=identityValue('brand'),model=identityValue('model');identityOptions('spec',vehicleCatalog()[brand]?.[model]||[],'',!!model)}
$('vehicle-brand').onchange=brandChanged;$('custom-brand').oninput=brandChanged;
$('vehicle-model').onchange=modelChanged;$('custom-model').oninput=modelChanged;
$('vehicle-spec').onchange=()=>toggleManual('spec');
}

function openEditor(kind,id='',prefill=''){
if(kind==='car'&&role!=='admin')return;
let title='',fields='',obj;
if(kind==='car'){obj=data.cars.find(c=>c.id===id)||{plate:'',brand:'',model:'',spec:'',cc:'',fuel:'',transmission:'',year:2022,price:0,status:'Available'};title=id?'Edit sample vehicle':'Add sample vehicle';fields=field('CAR PLATE','plate',obj.plate)+identityField('brand')+identityField('model')+identityField('spec')+'<p class="field full identityHelp">Choose brand → model → variant (SPEC). Options come from the sample catalogue and vehicles saved in this demo. Missing a choice? Select Other / enter manually.</p>'+field('CC','cc',obj.cc,'number')+select('TRANSMISSION','transmission',obj.transmission,[{value:'',label:'Select transmission'},...transmissions])+select('FUEL TYPE','fuel',obj.fuel,[{value:'',label:'Select fuel type'},...fuelTypes],true)+'<p class="field full" style="color:#6b6f76;line-height:1.6;margin:0">CC = engine capacity in cubic centimetres. Use 0 for a fully electric vehicle. All demo specifications are illustrative.</p>'+field('Year','year',obj.year,'number')+field('Illustrative price (RM)','price',obj.price,'number')+select('Status','status',obj.status,['Available','Reserved','Sold'],true);}
if(kind==='lead'){if(id&&!canLead(id))return;obj=data.leads.find(l=>l.id===id)||{name:'',car:prefill||data.cars[0]?.id,owner:'A',stage:stages[0],note:''};title=id?'Update enquiry':'Add sample enquiry';fields=field('Sample customer name','name',obj.name,'text',true)+select('Interested vehicle','car',obj.car,data.cars.map(c=>({value:c.id,label:vehicleName(c)+' · '+c.plate})))+select('Stage','stage',obj.stage,stages)+(role==='admin'?select('Assign to','owner',obj.owner,[{value:'A',label:'Demo Sales A'},{value:'B',label:'Demo Sales B'}],true):'')+noteField(obj.note);}
if(kind==='visit'){if(id&&!visits().some(v=>v.id===id))return;if(!ownLeads().length){notify('Add a sample enquiry before booking a viewing.');return}obj=data.visits.find(v=>v.id===id)||{lead:prefill||ownLeads()[0].id,when:'',status:'To confirm',note:''};title=id?'Edit viewing':'Book sample viewing';fields=select('Customer enquiry','lead',obj.lead,ownLeads().map(l=>({value:l.id,label:l.name+' · '+carName(l.car)})),true)+'<label class="field full">Date &amp; time (Malaysia time)<input name="when" type="datetime-local" value="'+esc(obj.when)+'"><small>Leave blank if the time is not confirmed.</small></label>'+select('Status','status',obj.status,['To confirm','Confirmed','Completed','Cancelled'],true)+noteField(obj.note);}
if(kind==='car'){mediaDraft=carMedia(obj);fields+=mediaSection()}
edit={kind,id};$('editorTitle').textContent=title;$('editorFields').innerHTML=fields;if(kind==='car'){setupVehicleIdentity(obj);setupMedia()}$('editor').showModal();
}
document.querySelectorAll('[data-role]').forEach(b=>b.addEventListener('click',()=>enter(b.dataset.role)));
$('sideNav').addEventListener('click',e=>{const b=e.target.closest('[data-view]');if(b){view=b.dataset.view;render()}});
$('page').addEventListener('input',e=>{if(e.target.id==='vehicleSearch')drawVehicles();if(e.target.id==='leadSearch')drawLeads()});
$('page').addEventListener('change',e=>{if(e.target.id==='vehicleStatus')drawVehicles();if(e.target.id==='leadStage')drawLeads()});
$('page').addEventListener('click',e=>{const b=e.target.closest('[data-action]');if(!b)return;const id=b.dataset.id;switch(b.dataset.action){case 'car':openEditor('car',id);break;case 'carNew':openEditor('car');break;case 'lead':openEditor('lead',id);break;case 'leadNew':openEditor('lead');break;case 'carLead':openEditor('lead','',id);break;case 'visit':openEditor('visit',id);break;case 'visitNew':openEditor('visit','',id);break;case 'goLeads':view='leads';render();break;case 'goVisits':view='viewings';render();break;}});
$('closeEditor').onclick=()=>$('editor').close();
$('editor').addEventListener('click',e=>{if(e.target!==$('editor'))return;const r=$('editor').getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)$('editor').close()});
$('editForm').addEventListener('submit',e=>{
e.preventDefault();if(!edit)return;const f=Object.fromEntries(new FormData(e.currentTarget));for(const k of Object.keys(f))f[k]=f[k].trim();
if(edit.kind==='car'){for(const key of ['brand','model','spec']){f[key]=identityValue(key);delete f['custom_'+key]}}
if((f.name!==undefined&&!f.name)||(f.plate!==undefined&&!f.plate)){notify('Enter a name and sample plate where required.');return}
const id=edit.id||edit.kind+Date.now();
if(edit.kind==='car'){if(role!=='admin')return;if(!['plate','brand','model','spec','cc','transmission','fuel'].every(k=>f[k]!==undefined&&f[k]!=='')){notify('Complete all required vehicle fields.');return}f.plate=f.plate.replace(/\s+/g,'').toUpperCase();if(data.cars.some(c=>c.plate.replace(/\s+/g,'').toUpperCase()===f.plate&&c.id!==id)){notify('That car plate already exists. Use a unique plate.');return}f.cc=Number(f.cc);if(!Number.isInteger(f.cc)||f.cc<0||f.cc>20000||!transmissions.includes(f.transmission)||!fuelTypes.includes(f.fuel)){notify('Enter CC as a whole number from 0–20,000 and select a transmission and fuel type.');return}f.year=Number(f.year);f.price=Number(f.price);if(!Number.isInteger(f.year)||f.year<1900||f.year>2100||!Number.isFinite(f.price)||f.price<=0){notify('Use a year from 1900–2100 and a price above RM0.');return}f.media=mediaDraft.map(m=>({...m}));f.img=f.media.find(m=>m.type==='photo')?.url||'';const idx=data.cars.findIndex(c=>c.id===id);if(idx<0)data.cars.push({id,...f});else data.cars[idx]={...data.cars[idx],...f};}
if(edit.kind==='lead'){if(edit.id&&!canLead(edit.id))return;if(!data.cars.some(c=>c.id===f.car))return;f.owner=role==='admin'?f.owner:'A';const idx=data.leads.findIndex(l=>l.id===id);if(idx<0)data.leads.push({id,...f});else data.leads[idx]={...data.leads[idx],...f};}
if(edit.kind==='visit'){if(!canLead(f.lead))return;if(f.status==='Confirmed'&&!f.when){notify('Choose a date and time before confirming the viewing.');return}const idx=data.visits.findIndex(v=>v.id===id);if(idx<0)data.visits.push({id,...f});else data.visits[idx]={...data.visits[idx],...f};if(['To confirm','Confirmed'].includes(f.status))data.leads.find(l=>l.id===f.lead).stage='Viewing arranged';}
$('editor').close();render();notify('Demo changes saved. Nothing was sent or published.');
});
$('switchRole').onclick=()=>{role='';$('workspace').hidden=true;$('entry').hidden=false;$('toast').hidden=true;window.scrollTo(0,0)};
$('resetDemo').onclick=()=>{data=seed();mediaDraft=[];releaseUnusedMedia();render();notify('Sample data restored.')};
})();