import {t} from './i18n.mjs';
import {db,customer,savedRows,setSaved} from './saved-data.js';
import {rememberSave,clearSave,saveReturnURL} from './saved-intent.js?v=mail-save-20261119';
import {createFavourites} from './showroom-favourites.mjs';

export function setupShowroomSave(){
  const root=document.getElementById('filterResults'),note=document.getElementById('showroomSaveStatus');
  const dialog=document.getElementById('saveAccountDialog');
  let pendingId=null,continuing=false;
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
    pendingId=id;continuing=false;rememberSave(id);
    dialog.querySelectorAll('[data-save-auth]').forEach(link=>{link.href=saveReturnURL(link.href)});dialog.showModal();
  }});
  root.addEventListener('click',event=>{
    const button=event.target.closest('[data-save-vehicle]');
    if(button&&root.contains(button)){event.preventDefault();void favourites.toggle(button.dataset.saveVehicle)}
  });

  dialog.querySelectorAll('[data-save-auth]').forEach(link=>link.addEventListener('click',()=>{continuing=true}));
  document.getElementById('closeSaveAccount').onclick=()=>dialog.close();
  dialog.addEventListener('close',()=>{if(!continuing&&pendingId)clearSave(pendingId);pendingId=null});
  db?.auth.onAuthStateChange(event=>{
    if(event==='SIGNED_OUT')favourites.reset();
    else if(event==='SIGNED_IN'){favourites.reset();setTimeout(favourites.refresh,0)}
  });
  window.addEventListener('focus',favourites.refresh);
  window.addEventListener('pageshow',favourites.refresh);
  void favourites.refresh();
  return ()=>paint(favourites.state());
}
