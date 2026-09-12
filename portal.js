import {db,configured,check,esc,rm,mileageText,getVehicles,coverURL,photoURLs,compressPhoto,friendlyError} from './e2-data.js';
const $=id=>document.getElementById(id), form=$('vehicleForm'), fields=$('vehicleFields');
let cars=[], current=null, role=null, busy=false, dirty=false, recovery=false, authEpoch=0;
const base=[{brand:'Honda',model:'CR-V',variant:'TC-P 2WD'},{brand:'Perodua',model:'Myvi',variant:''}];
const value=name=>form.elements.namedItem(name).value;
const identity=name=>value(name)==='__manual__'?value(name+'Manual').trim():value(name);
function message(id,text,error=false){$(id).textContent=text;$(id).classList.toggle('error',error)}
function editorError(error){message('editorMessage',friendlyError(error),true)}
function setBusy(state){busy=state;fields.disabled=state||current?.publication==='published';$('saveVehicle').disabled=fields.disabled;$('closeEditor').disabled=state;$('publishVehicle').disabled=state||!current||dirty||!current.photos.length;$('photoInput').disabled=state||dirty||!current||current.publication==='published'||current.photos.length>=20;document.querySelectorAll('#photos button').forEach(b=>b.disabled=state||dirty||current?.publication==='published'||b.dataset.boundary==='true');}
function selectOptions(name,choices,selected=''){
  const select=form.elements.namedItem(name), manual=form.elements.namedItem(name+'Manual');
  const items=[...new Set(choices.filter(Boolean))].sort();
  if(selected&&!items.includes(selected))items.push(selected);
  select.innerHTML='<option value="">Select '+name+'</option>'+items.map(v=>'<option>'+esc(v)+'</option>').join('')+'<option value="__manual__">Other / enter manually</option>';
  select.value=selected;manual.value='';manual.hidden=true;manual.required=false;manual.disabled=true;
}
function choices(name){const all=[...base,...cars];if(name==='brand')return all.map(c=>c.brand);if(name==='model')return all.filter(c=>c.brand===identity('brand')).map(c=>c.model);return all.filter(c=>c.brand===identity('brand')&&c.model===identity('model')).map(c=>c.variant)}
function identityChanged(name){const select=form.elements.namedItem(name),manual=form.elements.namedItem(name+'Manual');manual.hidden=select.value!=='__manual__';manual.disabled=manual.hidden;manual.required=!manual.hidden;
  if(name==='brand'){selectOptions('model',choices('model'));selectOptions('variant',[])}
  if(name==='model')selectOptions('variant',choices('variant'));
  form.elements.namedItem('model').disabled=!identity('brand');form.elements.namedItem('variant').disabled=!identity('model');
}
['brand','model','variant'].forEach(name=>{form.elements.namedItem(name).addEventListener('change',()=>identityChanged(name));form.elements.namedItem(name+'Manual').addEventListener('input',()=>identityChanged(name))});
form.addEventListener('input',()=>{dirty=true;setBusy(false);$('saveHint').textContent='Unsaved changes · Save draft before publishing or previewing.'});
form.addEventListener('change',()=>{dirty=true;setBusy(false)});
async function refresh(){
  const epoch=authEpoch;message('stockMessage','Loading inventory…');
  try{const rows=await getVehicles({staff:true});if(epoch!==authEpoch)return;cars=rows;renderStock();message('stockMessage',cars.length+' vehicles · Changes are stored in your E2 database.');}
  catch(error){if(epoch===authEpoch)message('stockMessage',friendlyError(error),true)}
}
function renderStock(){
  const query=$('stockSearch').value.toLowerCase().replace(/\s/g,'');
  const found=cars.filter(c=>(c.plate+c.brand+c.model+c.variant).toLowerCase().replace(/\s/g,'').includes(query));
  $('stockList').innerHTML=found.map(c=>'<article class="stockItem"><div class="noPhoto" data-cover="'+c.id+'">'+(c.photos.length?'Loading photo…':'No photos yet')+'</div><div><span class="stockState">'+esc(c.publication==='published'?'Published · '+c.stock_status:'Draft · private')+'</span><h2>'+esc(c.brand+' '+c.model)+'</h2><p>'+esc(c.plate+' · '+c.year+' · '+c.variant)+'</p><small>'+esc(mileageText(c))+' · '+Number(c.engine_litres).toFixed(1)+' L</small><p class="stockPrice">'+rm(c.price)+'</p></div>'+(role==='admin'?'<button class="primary" data-edit="'+c.id+'">Manage vehicle ↗</button>':'<span>View only</span>')+'</article>').join('')||'<p>No vehicles found. '+(role==='admin'?'Add your first vehicle to begin.':'')+'</p>';
  const epoch=authEpoch;
  for(const car of found)coverURL(car).then(url=>{if(!url||epoch!==authEpoch)return;const holder=document.querySelector('[data-cover="'+car.id+'"]');if(holder){const img=document.createElement('img');img.src=url;img.alt=car.brand+' '+car.model;img.loading='lazy';holder.replaceChildren(img)}}).catch(()=>{});
  document.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>openEditor(cars.find(c=>c.id===b.dataset.edit)));
}
async function renderPhotos(){
  const id=current?.id;const photos=current?await photoURLs(current.photos):[];
  if(current?.id!==id)return;
  $('photos').innerHTML=photos.map((p,i)=>'<div>'+(p.url?'<img src="'+esc(p.url)+'" alt="Vehicle photo '+(i+1)+'">':'<div class="noPhoto">Photo unavailable</div>')+'<small>'+(i===0?'COVER PHOTO':'PHOTO '+(i+1))+'</small>'+(current.publication==='draft'?'<button type="button" data-remove="'+p.id+'">Remove photo '+(i+1)+'</button>':'')+'</div>').join('');setBusy(busy);
  document.querySelectorAll('[data-remove]').forEach(b=>b.onclick=()=>removePhoto(b.dataset.remove));
  if(current?.publication==='draft')document.querySelectorAll('#photos>div').forEach((node,i)=>{if(!i)return;const button=document.createElement('button');button.type='button';button.textContent='Set as cover';button.disabled=busy||dirty;button.onclick=()=>setCover(photos[i].id);node.append(button)});
  if(current?.publication==='draft')document.querySelectorAll('#photos>div').forEach((node,i)=>{
    const controls=document.createElement('div');controls.className='photoOrderControls';
    for(const [delta,label] of [[-1,'← Earlier'],[1,'Later →']]){
      const button=document.createElement('button');button.type='button';button.textContent=label;
      button.dataset.boundary=String(i+delta<0||i+delta>=photos.length);
      button.setAttribute('aria-label','Move photo '+(i+1)+(delta<0?' earlier':' later'));
      button.onclick=()=>movePhoto(photos[i].id,delta);controls.append(button);
    }
    node.querySelector('small').after(controls);
  });
  setBusy(busy);
}
function populate(car){
  form.reset();current=car;dirty=false;
  selectOptions('brand',choices('brand'),car?.brand||'');selectOptions('model',choices('model'),car?.model||'');selectOptions('variant',choices('variant'),car?.variant||'');
  form.elements.namedItem('model').disabled=!car;form.elements.namedItem('variant').disabled=!car;
  for(const name of ['plate','year','engine_litres','transmission','fuel_type','mileage','price','body_type','stock_status','description'])if(car)form.elements.namedItem(name).value=car[name]??'';
  if(car)form.elements.namedItem('engine_litres').value=Number(car.engine_litres).toFixed(1);
  form.elements.namedItem('mileage_confirmed').checked=car?.mileage_confirmed||false;
  $('editorTitle').textContent=car?car.brand+' '+car.model:'Add vehicle';$('editorStatus').textContent=car?.publication==='published'?'PUBLISHED ON WEBSITE':'DRAFT · PRIVATE';
  $('saveHint').textContent=car?.publication==='published'?'Move this vehicle to draft to edit its details or photos.':car?'Details saved. You can add photos and preview this draft.':'Save vehicle details before adding photos.';
  $('publishVehicle').textContent=car?.publication==='published'?'Move to draft':'Publish to website';
  if(car)$('previewVehicle').href='car.html?id='+car.id+'&preview=1';else $('previewVehicle').removeAttribute('href');
  $('photos').replaceChildren();setBusy(false);
}
async function openEditor(car=null){populate(car);message('editorMessage','');$('vehicleEditor').showModal();try{await renderPhotos()}catch(error){editorError(error)}}
function closeEditor(){if(busy)return;if(dirty&&!confirm('Discard unsaved vehicle details? Uploaded photos are already saved.'))return;$('vehicleEditor').close();current=null;dirty=false}
$('closeEditor').onclick=closeEditor;$('vehicleEditor').addEventListener('cancel',e=>{e.preventDefault();closeEditor()});
$('addVehicle').onclick=()=>openEditor();$('stockSearch').oninput=renderStock;$('refreshStock').onclick=refresh;
form.onsubmit=async event=>{
  event.preventDefault();if(busy||role!=='admin')return;
  const mileage=value('mileage')===''?null:Number(value('mileage'));
  const confirmed=form.elements.namedItem('mileage_confirmed').checked;
  if(confirmed&&mileage===null){editorError(new Error('Enter the mileage before marking it confirmed.'));return}
  const data={plate:value('plate').toUpperCase().replace(/\s/g,''),brand:identity('brand'),model:identity('model'),variant:identity('variant'),year:Number(value('year')),engine_litres:Number(value('engine_litres')),transmission:value('transmission'),fuel_type:value('fuel_type'),mileage,mileage_confirmed:confirmed,price:Number(value('price')),body_type:value('body_type'),stock_status:value('stock_status'),description:value('description').trim()};
  setBusy(true);message('editorMessage','Saving vehicle details…');
  try{
    const saved=check(await (current?db.from('vehicles').update(data).eq('id',current.id).eq('updated_at',current.updated_at):db.from('vehicles').insert({...data,id:crypto.randomUUID()})).select().maybeSingle());
    if(!saved)throw new Error('This vehicle changed in another session. Close and refresh before editing again.');
    saved.photos=current?.photos||[];populate(saved);await renderPhotos();await refresh();message('editorMessage','Saved to the database. Add photos, then publish when ready.');
  }catch(error){editorError(error)}finally{setBusy(false)}
};
async function syncCurrent(){const rows=await getVehicles({staff:true,id:current.id});if(!rows.length)throw new Error('Vehicle is no longer accessible.');current=rows[0];await renderPhotos();await refresh()}
$('photoInput').onchange=async()=>{
  if(busy||!current||current.publication!=='draft')return;
  const files=[...$('photoInput').files];$('photoInput').value='';
  if(files.length+current.photos.length>20){editorError(new Error('Maximum 20 photos. Choose fewer files.'));return}
  setBusy(true);let completed=0;
  try{
    for(const file of files){
      message('editorMessage','Preparing and uploading photo '+(completed+1)+' of '+files.length+'…');
      const blob=await compressPhoto(file),path=current.id+'/'+crypto.randomUUID()+'.webp';
      check(await db.storage.from('vehicle-photos').upload(path,blob,{contentType:'image/webp',cacheControl:'300',upsert:false}));
      const used=new Set(current.photos.map(p=>p.position));let position=0;while(used.has(position))position++;
      const result=await db.from('vehicle_photos').insert({vehicle_id:current.id,path,position}).select().single();
      if(result.error){await db.storage.from('vehicle-photos').remove([path]);throw result.error}
      current.photos.push(result.data);completed++;
    }
    await syncCurrent();message('editorMessage',completed+' photos uploaded and saved. First photo is the cover.');
  }catch(error){editorError(new Error(completed+' photos saved. '+friendlyError(error)));try{await syncCurrent()}catch{}}
  finally{setBusy(false)}
};
async function removePhoto(id){
  if(busy)return;const photo=current.photos.find(p=>p.id===id);if(!photo)return;
  setBusy(true);
  try{
    const removed=check(await db.from('vehicle_photos').delete().eq('id',id).select());
    if(!removed.length)throw new Error('Photo could not be removed. Refresh and check your access.');
    const cleanup=await db.storage.from('vehicle-photos').remove([photo.path]);await syncCurrent();
    message('editorMessage',cleanup.error?'Photo removed from vehicle. Stored-file cleanup needs a retry from the storage dashboard.':'Photo removed.');
  }catch(error){editorError(error)}finally{setBusy(false)}
}
async function setCover(id){
  if(busy||dirty)return;setBusy(true);
  try{check(await db.rpc('e2_set_cover',{photo_id:id}));await syncCurrent();message('editorMessage','Cover photo saved.');}
  catch(error){editorError(error)}finally{setBusy(false)}
}
async function movePhoto(id,delta){
  if(busy||dirty||current?.publication!=='draft')return;
  const expected=current.photos.map(p=>p.id),from=expected.indexOf(id),to=from+delta;
  if(from<0||to<0||to>=expected.length)return;
  const ordered=[...expected];[ordered[from],ordered[to]]=[ordered[to],ordered[from]];
  setBusy(true);message('editorMessage','Saving photo order…');
  try{
    check(await db.rpc('e2_reorder_photos',{target_vehicle:current.id,ordered_ids:ordered,expected_ids:expected}));
    await syncCurrent();message('editorMessage','Photo order saved. The first photo is the cover.');
    setBusy(false);
    const buttons=document.querySelectorAll('.photoOrderControls');
    buttons[to]?.querySelector('button:not(:disabled)')?.focus({preventScroll:true});
  }catch(error){editorError(error);try{await syncCurrent()}catch{}}
  finally{setBusy(false)}
}
$('publishVehicle').onclick=async()=>{
  if(busy||!current||dirty)return;const publication=current.publication==='published'?'draft':'published';setBusy(true);
  try{
    const row=check(await db.from('vehicles').update({publication}).eq('id',current.id).eq('updated_at',current.updated_at).select().maybeSingle());
    if(!row)throw new Error('This vehicle changed in another session. Close and refresh first.');
    row.photos=current.photos;populate(row);await renderPhotos();await refresh();
    message('editorMessage',publication==='published'?'Published. This vehicle now appears in the showroom.':'Moved to draft. New visitors cannot see this vehicle. Previously opened photos may remain visible for up to five minutes.');
  }catch(error){editorError(error)}finally{setBusy(false)}
};
async function showSession(session){
  const epoch=++authEpoch;
  if(!session){role=null;cars=[];$('stockList').replaceChildren();$('workspace').hidden=true;$('entry').hidden=false;$('vehicleEditor').close();return}
  if(recovery)return;
  try{
    const membership=check(await db.from('staff_memberships').select('role,active').eq('user_id',session.user.id).maybeSingle());if(epoch!==authEpoch)return;
    if(!membership?.active||!['admin','sales'].includes(membership.role)){$('entry').hidden=false;$('workspace').hidden=true;await db.auth.signOut();throw new Error('This account has no inventory access. Ask the E2 administrator to activate your staff membership.')}
    role=membership.role;$('profileName').textContent=session.user.email;$('profileRole').textContent=role==='admin'?'Admin':'Salesman · view only';$('addVehicle').hidden=role!=='admin';$('entry').hidden=true;$('workspace').hidden=false;await refresh();
  }catch(error){message('authMessage',friendlyError(error),true)}
}
$('loginForm').onsubmit=async e=>{
  e.preventDefault();const button=$('loginForm').querySelector('button[type=submit]');button.disabled=true;message('authMessage','Signing in…');
  try{check(await db.auth.signInWithPassword({email:$('loginForm').elements.email.value.trim(),password:$('loginForm').elements.password.value}));$('loginForm').elements.password.value='';message('authMessage','')}
  catch(error){message('authMessage',friendlyError(error),true)}finally{button.disabled=false}
};
$('signOut').onclick=async()=>{if(busy){message('stockMessage','Wait for the current save or upload to finish before signing out.');return}try{check(await db.auth.signOut());await showSession(null)}catch(error){message('stockMessage',friendlyError(error),true)}};
$('resetPassword').onclick=async()=>{
  const email=$('loginForm').elements.email;if(!email.reportValidity())return;
  $('resetPassword').disabled=true;
  try{check(await db.auth.resetPasswordForEmail(email.value.trim(),{redirectTo:new URL('portal.html',location.href).href}));message('authMessage','If this account is eligible, a password reset email will arrive shortly.')}
  catch(error){message('authMessage',friendlyError(error),true)}finally{$('resetPassword').disabled=false}
};
$('passwordForm').onsubmit=async e=>{
  e.preventDefault();const f=$('passwordForm');if(f.elements.password.value!==f.elements.confirm.value){message('authMessage','The passwords do not match.',true);return}
  f.querySelector('button').disabled=true;
  try{check(await db.auth.updateUser({password:f.elements.password.value}));f.reset();recovery=false;f.hidden=true;$('loginForm').hidden=false;await db.auth.signOut();message('authMessage','Password saved. Sign in with your new password.')}
  catch(error){message('authMessage',friendlyError(error),true)}finally{f.querySelector('button').disabled=false}
};
if(!configured){message('connectionState','正式账号连接准备中 · Sign-in will be available after the E2 database project is connected.');}
else{
  message('connectionState','E2 staff sign-in');$('loginForm').querySelector('button[type=submit]').disabled=false;$('resetPassword').disabled=false;
  db.auth.onAuthStateChange((event,session)=>{
    if(event==='PASSWORD_RECOVERY'){recovery=true;$('entry').hidden=false;$('workspace').hidden=true;$('loginForm').hidden=true;$('passwordForm').hidden=false;message('authMessage','Choose a new password of at least 12 characters.');return}
    if(['INITIAL_SESSION','SIGNED_IN','SIGNED_OUT'].includes(event))setTimeout(()=>showSession(session),0);
  });
}
window.addEventListener('beforeunload',e=>{if(dirty||busy){e.preventDefault();e.returnValue=''}});
