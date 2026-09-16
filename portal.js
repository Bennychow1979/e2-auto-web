import {enablePhotoDrag} from './photo-sort.js?v=drag-1';
import {db,configured,check,esc,rm,mileageText,getVehicles,coverURL,photoURLs,compressPhoto,friendlyError} from './e2-data.js?v=customer-1';
const MAX_PHOTOS=30;
const $=id=>document.getElementById(id), form=$('vehicleForm'), fields=$('vehicleFields');
const canManageStock=()=>['super_admin','admin'].includes(role);
const roleLabels={super_admin:'Super Admin',admin:'Admin',office_admin:'Office Admin',sales:'Salesman · view only',account:'Account · public stock only',customer:'Customer · public stock only'};
let cars=[], current=null, role=null, busy=false, dirty=false, recovery=false, authEpoch=0;
// BMW model labels supplied by E2, 2026-09-16. Models only; specifications remain separately entered.
const bmwModels=["1 M","116i","118i","120i","125i","130i","135i","2002","218i","220i","235i","316i","318Ci","318i","320Ci","320d","320d GT","320i","323Ci","323i","325Ci","325d","325i","328Ci","328i","328i GT","330Ci","330e","330i","330Li","335Ci","335i","340i","420i","428i","428i Gran Coupe","430i","440i","435i","520d","520i","523d","523i","525d","525i","528i","530d","530e","530i","535i","540i","545i","550i","630Ci","630i","635CSi","640Ci","640i","640i Gran Coupe","645Ci","650Ci","650i","728i","730i","730Ld","730Li","735i","735iL","740i","740Le","740Li","745Li","750e","750i","750Li","760Li","840D","840i","850Ci","850i","ActiveHybrid 3","ActiveHybrid 5","ActiveHybrid 7 L","Alpina B3","E3","i3","i4","i5","i7","i8","iX","iX1","iX2","iX3","M2","M3","M4","M5","M6","M6 Gran Coupe","M8","M140i","X1","X2","X3","X4","X4 M","X5","X5 M","X6","X6 M","XM","X7","Z3","Z4","Z4 coupe","Z4 M"];
const subaruModels=["1600","BRZ","Crosstrek","Dias Wagon","Domingo","Exiga","FORESTER","Impreza","Legacy","Levorg","Outback","WRX","XV"];
const fordModels=["Anglia","Capri","Cortina","Courier","Econovan","Ecosport","Escape","Escort","Everest","Explorer","F150","Falcon","Fiesta","Focus","FREDA","Galaxie","GT","Kuga","Laser","Lynx","Mondeo","Mustang","Prefect","RANGER","Ranger Raptor","Roller Team","S-MAX","Spectron","Telstar","Transit"];
const mazdaModels=["121","2","3","323","5","6","626","808","8","929","Atenza","Autozam AZ-3","Axela","B2200","B2500","Biante","Bongo","BT-50","Capella","Carol","CX-3","CX-5","CX-7","CX-8","CX-9","CX-30","CX-60","CX-80","E2800","Familia","Fighter","Lantis","Luce","MPV","MX-3","MX-5","MX-30","Persona","Premacy","Roadster","RX-7","RX-8","Tribute"];
const mercedesModels=["190E","200","200D","200E","200TE","220 COUPE","220E","230","230CE","230E","230TE","240D","250S","260E","280CE","280SE","280SL","280SLC","280TE","300CE","300E","300GE","300SE","300SEL","300SL","300TE","320CE","350 SLC","380 SLC","420SL","420 SEC","500 SEC","A35","A45","A150","A160","A170","A180","A190","A200","A250","AMG GT","AMG GT S","B Sports Tourer","B170","B180","B200","B220","Brabus EK4","C180","C200","C200 AMG","C200K","C220","C230","C240","C250","C270","C280","C300","C320","C350E","C43","C63","CL55","CL 63","CL500","CLA180","CLA200","CLA220","CLA250","CLA35","CLA45","CLC180","CLC200","CLE 53","CLE 200","CLE 300","CLK200","CLK230","CLK240","CLK270","CLK280","CLK320","CLK55","CLS53","CLS55","CLS63","CLS220","CLS250","CLS350","CLS400","CLS450","CLS500","E43","E53","E55","E63","E200","E220","E230","E240","E250","E270","E280","E300","E320","E350","E350e AMG","E350e Exclusive","E400","E450","E500","EQA","EQB","EQC","EQE","EQS","EQV","G55","G63","G350","G400","G580","G-Class","GL63","GL350","GL400","GL450","GL500","GLA180","GLA200","GLA220","GLA250","GLA45","GLA35","GLB35","GLB180","GLB200","GLB250","GLC43","GLC63","GLC200","GLC220D","GLC250","GLC300","GLC350","GLE250D","GLE350D","GLE400","GLE400 Coupe","GLE43","GLE450 Coupe","GLE53","GLE63 S AMG","GLS350","GLS400D","GLS450","GLS600","GLS63 AMG","MB100","MB140D","ML270","ML280","ML300","ML320","ML350","R280L","R300L","R350","R350L","R500L","S55","S63","S65","S280","S300L","S320","S320L","S350L","S400 Hybrid","S400L Hybrid","S420","S430","S450L","S500L","S560","S580","S600","S650","S-Class","SEL","SL43","SL55","SL63","SL65 AMG","SL320","SL350","SL400 AMG","SL500","SLC 43","SLC 180","SLC 200","SLC 300","SLK55","SLK200","SLK230","SLK250","SLK280","SLK350","SLS AMG","Sprinter","V220","V230","V250","V280","V300","Vanoe","Viano","Vito","X250 D","X350 D"];
const nissanModels=["180SX","370Z","720","AD Resort","Almera","BE 1","Bluebird","Caravan","Cedric","Cefiro","Cube","Dayz","Dualis","Elgrand","Fairlady Z","Figaro","Frontier","Fuga","Grand Livina","GTR","Juke","Kicks","Latio","Laurel","Leaf","Liberty S","Livina","March","Moco","Murano","Navara","Note","Nv200","Patrol","Prairie Joy","Presage","Pulsar","Roox","Safari","Sakura","Sentra","SERENA","Silvia","Skyline","Stagea","Sunny","Sylphy","Teana","Terrano","Urvan","Vanette","X-Gear","X-Trail"];
const peroduaModels=["Alza","Aruz","Ativa","Axia","Axia Rahmah","Axia SE","Axia Style","Bezza","Bezza AV","Bezza X","Kancil","Kelisa","Kembara","Kenari","Myvi","MyVi AV","MyVi Gen 3","Nautica","QV-E","Rusa","Traz","Viva"];
const protonModels=["Arena","eMas 5","eMas 7","Ertiga","Exora","Gen2","Inspira","Iriz","Iswara","Juara","Perdana","Persona","Preve","Putra","S70","Saga","Saga FLX","Saga MC3","Saga Premium","Saga Premium S","Saga VVT","Satria","Savvy","Suprima S","Tiara","Waja","Wira","X50","X70","X90"];
const toyotaModels=["86","1000","AE86","Alphard","Altezza","Altis","Aqua","Aristo","Avanza","Avensis","BB","Belta","BZ4X","C-HR","Caldina","Camroad","CAMRY","Celica","Celsior","Century","Chaser","Copen","Corolla","Corolla GR","Corolla Cross","Corona","Cressida","Cresta","Crown","Cygnus","Cynos","Esquire","Estima","FJ Cruiser","Fortuner","Gaia","GR86","GR Supra","GR Yaris","GRMN Yaris","Granace","Granvia","Harrier","Hiace","Hilux","Hilux GR Sport","Innova","Innova Zenix","Ipsum","Iq","Isis","Ist","Kluger","Land Cruiser","LiteAce","Mark II","Mark X","Master Ace Surf","Mega Cruiser","Motorhome","MR2","MRS","Nadia","Noah","Opa","Passo","Picnic","Porte","Prado","Previa","Prius","Prius c","Progres","Publica","Rav 4","Roomy","Rush","Sera","Sienta","Soarer","Spacio","Spade","Sprinter","Starlet","Supra","Tank","Townace","Unser","Urban Cruiser","Vanguard","Vellfire","Veloz","VIOS","Vitz","Voltz","Voxy","Wald","Will","Windom","Wish","Yaris","Yaris Cross"];
const base=[{brand:'Honda',model:'CR-V',variant:'TC-P 2WD'},...bmwModels.map(model=>({brand:'BMW',model,variant:''})),...subaruModels.map(model=>({brand:'SUBARU',model,variant:''})),...fordModels.map(model=>({brand:'FORD',model,variant:''})),...mazdaModels.map(model=>({brand:'MAZDA',model,variant:''})),...mercedesModels.map(model=>({brand:'MERCEDES-BENZ',model,variant:''})),...nissanModels.map(model=>({brand:'NISSAN',model,variant:''})),...peroduaModels.map(model=>({brand:'Perodua',model,variant:''})),...protonModels.map(model=>({brand:'PROTON',model,variant:''})),...toyotaModels.map(model=>({brand:'TOYOTA',model,variant:''}))];
const value=name=>form.elements.namedItem(name).value;
const identity=name=>value(name)==='__manual__'?value(name+'Manual').trim():value(name);
function message(id,text,error=false){$(id).textContent=text;$(id).classList.toggle('error',error)}
function editorError(error){message('editorMessage',friendlyError(error),true)}
function setBusy(state){busy=state;fields.disabled=state||current?.publication==='published';$('saveVehicle').disabled=fields.disabled;$('closeEditor').disabled=state;$('publishVehicle').disabled=state||!current||dirty||!current.photos.length;$('photoInput').disabled=state||dirty||!current||current.publication==='published'||current.photos.length>=MAX_PHOTOS;document.querySelectorAll('#photos button').forEach(b=>b.disabled=state||dirty||current?.publication==='published'||b.dataset.boundary==='true');}
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
  $('stockList').innerHTML=found.map(c=>'<article class="stockItem"><div class="noPhoto" data-cover="'+c.id+'">'+(c.photos.length?'Loading photo…':'No photos yet')+'</div><div><span class="stockState">'+esc(c.publication==='published'?'Published · '+c.stock_status:'Draft · private')+'</span><h2>'+esc(c.brand+' '+c.model)+'</h2><p>'+esc(c.plate+' · '+c.year+' · '+c.variant)+'</p><small>'+esc(mileageText(c))+' · '+Number(c.engine_litres).toFixed(1)+' L</small><p class="stockPrice">'+rm(c.price)+'</p></div>'+(canManageStock()?'<button class="primary" data-edit="'+c.id+'">Manage vehicle ↗</button>':'<span>View only</span>')+'</article>').join('')||'<p>No vehicles found. '+(canManageStock()?'Add your first vehicle to begin.':'')+'</p>';
  const epoch=authEpoch;
  for(const car of found)coverURL(car).then(url=>{if(!url||epoch!==authEpoch)return;const holder=document.querySelector('[data-cover="'+car.id+'"]');if(holder){const img=document.createElement('img');img.src=url;img.alt=car.brand+' '+car.model;img.loading='lazy';holder.replaceChildren(img)}}).catch(()=>{});
  document.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>openEditor(cars.find(c=>c.id===b.dataset.edit)));
}
async function renderPhotos(){
  const id=current?.id;const photos=current?await photoURLs(current.photos):[];
  if(current?.id!==id)return;
  $('photos').innerHTML=photos.map((p,i)=>'<div data-photo-id="'+p.id+'">'+(p.url?'<img src="'+esc(p.url)+'" alt="Vehicle photo '+(i+1)+'">':'<div class="noPhoto">Photo unavailable</div>')+'<small>'+(i===0?'COVER PHOTO':'PHOTO '+(i+1))+'</small>'+(current.publication==='draft'?'<button type="button" data-remove="'+p.id+'">Remove photo '+(i+1)+'</button>':'')+'</div>').join('');setBusy(busy);
  document.querySelectorAll('[data-remove]').forEach(b=>b.onclick=()=>removePhoto(b.dataset.remove));
  if(current?.publication==='draft')document.querySelectorAll('#photos>div').forEach((node,i)=>{if(!i)return;const button=document.createElement('button');button.type='button';button.textContent='Set as cover';button.disabled=busy||dirty;button.onclick=()=>setCover(photos[i].id);node.append(button)});
  if(current?.publication==='draft')document.querySelectorAll('#photos>div').forEach((node,i)=>{
    const handle=document.createElement('button');handle.type='button';handle.className='photoDragHandle';handle.textContent='⠿ Drag to move';handle.setAttribute('aria-label','Drag photo '+(i+1)+' to reorder');node.querySelector('small').after(handle);
    const controls=document.createElement('div');controls.className='photoOrderControls';
    for(const [delta,label] of [[-1,'← Earlier'],[1,'Later →']]){
      const button=document.createElement('button');button.type='button';button.textContent=label;
      button.dataset.boundary=String(i+delta<0||i+delta>=photos.length);
      button.setAttribute('aria-label','Move photo '+(i+1)+(delta<0?' earlier':' later'));
      button.onclick=()=>movePhoto(photos[i].id,delta);controls.append(button);
    }
    handle.after(controls);
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
  event.preventDefault();if(busy||!canManageStock())return;
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
  if(files.length+current.photos.length>MAX_PHOTOS){editorError(new Error('Maximum '+MAX_PHOTOS+' photos. Choose fewer files.'));return}
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
  await savePhotoOrder(ordered,expected,id);
}
async function savePhotoOrder(ordered,expected,id){
  if(busy||dirty||current?.publication!=='draft')return;
  setBusy(true);message('editorMessage','Saving photo order…');
  try{
    check(await db.rpc('e2_reorder_photos',{target_vehicle:current.id,ordered_ids:ordered,expected_ids:expected}));
    await syncCurrent();message('editorMessage','Photo order saved. The first photo is the cover.');
    setBusy(false);
    document.querySelector('[data-photo-id="'+id+'"] .photoDragHandle')?.focus({preventScroll:true});
  }catch(error){editorError(error);try{await syncCurrent()}catch{}}
  finally{setBusy(false)}
}
enablePhotoDrag($('photos'),{
  canStart:()=>!busy&&!dirty&&current?.publication==='draft',
  onActive:state=>setBusy(state),
  onDrop:savePhotoOrder
});
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
  if(!session){$('manageLoans').hidden=true;$('manageCustomers').hidden=true;$('myProfileLink').hidden=true;$('manageUsers').hidden=true;role=null;cars=[];$('stockList').replaceChildren();$('workspace').hidden=true;$('entry').hidden=false;$('vehicleEditor').close();return}
  if(recovery)return;
  try{
    const membership=check(await db.from('staff_memberships').select('role,active').eq('user_id',session.user.id).maybeSingle());if(epoch!==authEpoch)return;
    if(!membership?.active||!Object.hasOwn(roleLabels,membership.role)){$('entry').hidden=false;$('workspace').hidden=true;await db.auth.signOut();throw new Error('This account has no inventory access. Ask the E2 administrator to activate your staff membership.')}
    role=membership.role;if(role==='office_admin'){location.replace('intake-workspace.html');return}$('manageLoans').hidden=!['super_admin','admin','sales'].includes(role);$('manageCustomers').hidden=!['super_admin','admin'].includes(role);$('myProfileLink').hidden=role==='customer';$('profileName').textContent=session.user.email;$('profileRole').textContent=roleLabels[role];$('manageUsers').hidden=role!=='super_admin';$('addVehicle').hidden=!canManageStock();$('entry').hidden=true;$('workspace').hidden=false;await refresh();
  }catch(error){message('authMessage',friendlyError(error),true)}
}
$('loginForm').onsubmit=async e=>{
  e.preventDefault();const button=$('loginForm').querySelector('button[type=submit]');button.disabled=true;message('authMessage','Signing in…');
  try{check(await db.auth.signInWithPassword({email:$('loginForm').elements.email.value.trim(),password:$('loginForm').elements.password.value}));$('loginForm').elements.password.value='';message('authMessage','')}
  catch(error){message('authMessage',friendlyError(error),true)}finally{button.disabled=false}
};
$('signOut').onclick=async()=>{if(busy){message('stockMessage','Wait for the current save or upload to finish before signing out.');return}try{check(await db.auth.signOut());await showSession(null)}catch(error){message('stockMessage',friendlyError(error),true)}};
let resetSending=false,resetWaitUntil=0;
try{const stored=Number(sessionStorage.getItem('e2-reset-wait'));if(Number.isFinite(stored)&&stored>Date.now())resetWaitUntil=Math.min(stored,Date.now()+60000)}catch{}
function updateResetButton(){
  const seconds=Math.max(0,Math.ceil((resetWaitUntil-Date.now())/1000));
  $('resetPassword').disabled=!configured||resetSending||seconds>0;
  $('resetPassword').textContent=resetSending?'Requesting email…':seconds?'Request again in '+seconds+'s':'Forgot password?';
}
setInterval(updateResetButton,1000);
$('resetPassword').onclick=async()=>{
  if(resetSending||Date.now()<resetWaitUntil)return;
  const email=$('loginForm').elements.email;if(!email.reportValidity())return;
  resetSending=true;resetWaitUntil=Date.now()+60000;
  try{sessionStorage.setItem('e2-reset-wait',String(resetWaitUntil))}catch{}
  updateResetButton();
  try{check(await db.auth.resetPasswordForEmail(email.value.trim(),{redirectTo:new URL('portal.html',location.href).href}));message('authMessage','If this account is eligible, a password reset email has been requested. Check your inbox and Spam / Junk folder for E2 Auto. Use the newest email link.')}
  catch(error){message('authMessage',friendlyError(error),true)}finally{resetSending=false;updateResetButton()}
};
$('passwordForm').onsubmit=async e=>{
  e.preventDefault();const f=$('passwordForm');if(f.elements.password.value!==f.elements.confirm.value){message('authMessage','The passwords do not match.',true);return}
  f.querySelector('button').disabled=true;
  try{check(await db.auth.updateUser({password:f.elements.password.value}));f.reset();recovery=false;f.hidden=true;$('loginForm').hidden=false;await db.auth.signOut();message('authMessage','Password saved. Sign in with your new password.')}
  catch(error){message('authMessage',friendlyError(error),true)}finally{f.querySelector('button').disabled=false}
};
if(!configured){message('connectionState','正式账号连接准备中 · Sign-in will be available after the E2 database project is connected.');}
else{
  message('connectionState','E2 staff sign-in');$('loginForm').querySelector('button[type=submit]').disabled=false;updateResetButton();
  db.auth.onAuthStateChange((event,session)=>{
    if(event==='PASSWORD_RECOVERY'){recovery=true;$('entry').hidden=false;$('workspace').hidden=true;$('loginForm').hidden=true;$('passwordForm').hidden=false;message('authMessage','Choose a new password of at least 12 characters.');return}
    if(['INITIAL_SESSION','SIGNED_IN','SIGNED_OUT'].includes(event))setTimeout(()=>showSession(session),0);
  });
}
window.addEventListener('beforeunload',e=>{if(dirty||busy){e.preventDefault();e.returnValue=''}});
