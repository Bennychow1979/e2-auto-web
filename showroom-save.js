import {t} from './i18n.mjs';
import {db,customer,savedRows,setSaved} from './saved-data.js';
import {rememberSave} from './saved-intent.js';
import {createFavourites} from './showroom-favourites.mjs';

export function setupShowroomSave(){
  const root=document.getElementById('filterResults'),note=document.getElementById('showroomSaveStatus');
  const dialog=document.getElementById('saveAccountDialog');
  let pendingId=null;
  function paint(state,message){
    for(const button of root.querySelectorAll('[data-save-vehicle]')){
      const saved=state.ids.has(button.dataset.saveVehicle);
      button.setAttribute('aria-pressed',String(saved));button.disabled=!!state.busy;
      button.setAttribute('aria-busy',String(state.busy===button.dataset.saveVehicle));
      const label=t(saved?'Remove {car} from favourites':'Save {car} as favourite',{car:button.dataset.carName});
      button.setAttribute('aria-label',label);button.title=label;
    }
    if(message!==undefined)note.textContent=t(message);
  }
  const favourites=createFavourites({customer,savedRows,setSaved,onChange:paint,onAuthRequired:id=>{
    pendingId=id;dialog.showModal();
  }});
  root.addEventListener('click',event=>{
    const button=event.target.closest('[data-save-vehicle]');
    if(button&&root.contains(button)){event.preventDefault();void favourites.toggle(button.dataset.saveVehicle)}
  });
  dialog.querySelectorAll('[data-save-auth]').forEach(link=>link.addEventListener('click',()=>{if(pendingId)rememberSave(pendingId)}));
  document.getElementById('closeSaveAccount').onclick=()=>dialog.close();
  dialog.addEventListener('close',()=>{pendingId=null});
  db?.auth.onAuthStateChange(event=>{
    if(event==='SIGNED_OUT')favourites.reset();
    else if(event==='SIGNED_IN'){favourites.reset();setTimeout(favourites.refresh,0)}
  });
  window.addEventListener('focus',favourites.refresh);
  window.addEventListener('pageshow',favourites.refresh);
  void favourites.refresh();
  return ()=>paint(favourites.state());
}
