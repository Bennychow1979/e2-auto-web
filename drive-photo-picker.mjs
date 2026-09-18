import {drivePhotoRequest,esc} from './e2-data.js?v=drive-1';

export function setupDrivePhotoPicker({getCurrent,canEdit,setBusy,onSaved,request=drivePhotoRequest}) {
  const panel=document.getElementById('drivePhotoPanel');
  const toggle=document.getElementById('openDrivePhotos');
  const input=document.getElementById('driveFolder');
  const load=document.getElementById('loadDrivePhotos');
  const add=document.getElementById('addDrivePhotos');
  const grid=document.getElementById('drivePhotoChoices');
  const status=document.getElementById('drivePhotoStatus');
  let listing=null,loadedVehicle=null,working=false;
  function say(message,error=false){status.textContent=message;status.classList.toggle('error',error)}
  function update() {
    const allowed=canEdit()&&!working;
    toggle.disabled=!allowed;
    input.disabled=!allowed;load.disabled=!allowed;
    grid.querySelectorAll('input').forEach(box=>box.disabled=!allowed||box.dataset.linked==='true');
    const count=grid.querySelectorAll('input:checked').length;
    add.disabled=!allowed||!count;add.textContent=count?'Add '+count+' selected photo'+(count===1?'':'s'):'Add selected photos';
  }
  function reset() {
    listing=null;loadedVehicle=null;input.value='';grid.replaceChildren();panel.hidden=true;
    toggle.setAttribute('aria-expanded','false');say('');update();
  }
  toggle.onclick=async()=>{
    if(!canEdit())return;
    panel.hidden=!panel.hidden;toggle.setAttribute('aria-expanded',String(!panel.hidden));
    if(panel.hidden)return;
    working=true;setBusy(true);say('Checking Google Drive connection…');
    try{const result=await request({action:'status'});say(result.message,!result.ready)}
    catch(error){say(error.message,true)}
    finally{working=false;setBusy(false);update()}
  };
  input.addEventListener('input',()=>{listing=null;loadedVehicle=null;grid.replaceChildren();say('');update()});
  load.onclick=async()=>{
    if(!canEdit())return;
    const car=getCurrent();working=true;setBusy(true);say('Loading photos for '+car.plate+'…');grid.replaceChildren();listing=null;
    try {
      const result=await request({action:'list',vehicle:car.id,folder:input.value});
      if(getCurrent()?.id!==car.id)return;
      listing=result;loadedVehicle=car.id;
      grid.innerHTML=result.photos.map((p,i)=>'<label class="drivePhotoChoice"><img src="'+esc(p.url)+'" alt="Drive photo '+(i+1)+'" loading="lazy" referrerpolicy="no-referrer"><span><input type="checkbox" value="'+esc(p.id)+'" data-linked="'+p.linked+'" '+(p.linked?'disabled':'')+'> '+esc(p.name)+(p.linked?' · Already linked':'')+'</span></label>').join('');
      grid.querySelectorAll('input').forEach(box=>box.onchange=update);
      grid.querySelectorAll('img').forEach(img=>{
        img.onerror=()=>{const box=img.closest('label').querySelector('input');box.checked=false;box.dataset.linked='true';box.disabled=true;img.replaceWith(document.createTextNode('Preview unavailable — load the folder again.'));update()};
      });
      say(result.photos.length+' photos found.'+(result.skipped?' '+result.skipped+' duplicate or unsupported files omitted.':'')+' Select the photos for this vehicle. Existing photos stay in place.');
    }catch(error){say(error.message,true)}
    finally{working=false;setBusy(false);update()}
  };
  add.onclick=async()=>{
    const car=getCurrent();
    if(!canEdit()||!listing||loadedVehicle!==car?.id)return;
    const selected=new Set([...grid.querySelectorAll('input:checked')].map(box=>box.value));
    const files=listing.photos.filter(p=>selected.has(p.id)).map(p=>({id:p.id,checksum:p.checksum}));
    if(files.length+car.photos.length>30){say('Maximum 30 photos in total. Select fewer photos.',true);return}
    if(!files.length)return;
    working=true;setBusy(true);say('Checking and linking selected photos…');
    let saved=false;
    try {
      const result=await request({action:'attach',vehicle:car.id,folder:listing.folder,files});
      saved=true;listing=null;grid.replaceChildren();
      await onSaved();
      say(result.added+' Drive photos linked to this private draft. Choose the cover and order below.');
    }catch(error){
      say((saved?'Photos were linked, but refreshing failed. Close and refresh the inventory. ':'')+error.message,true);
      if(!saved){try{await onSaved()}catch{}}
    }finally{working=false;setBusy(false);update()}
  };
  return {reset,update};
}
