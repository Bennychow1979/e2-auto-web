import {db,customer,savedRows,setSaved} from './saved-data.js';
import {pendingSave,clearSave} from './saved-intent.js';
import {getVehicles,coverURL,esc,rm} from './e2-data.js';
import {ct,accountURL,setupCustomerLanguage} from './customer-language.mjs?v=flow-20261113';
setupCustomerLanguage();
const $=id=>document.getElementById(id);let epoch=0,busy=false;
function savedCard(row,c){
 const name=c?c.brand+' '+c.model:ct('unavailable vehicle');
 const details=c?'<p>'+ct('PLATE')+' · '+esc(c.plate)+'</p><p class="price">'+rm(c.price)+'</p>':'';
 const link=c?'<a href="'+esc(accountURL('car.html?id='+encodeURIComponent(c.id)))+'">'+ct('View car ↗')+'</a>':'<a href="'+esc(accountURL('showroom.html#cars'))+'">'+ct('Explore cars ↗')+'</a>';
 return '<article class="savedCard"><div class="savedImage" data-cover="'+row.vehicle_id+'">'+ct(c?'Photo unavailable':'No longer listed')+'</div><div class="savedDetails"><span class="savedStatus">'+esc(ct(c?.stock_status||'Unavailable'))+'</span><h3>'+esc(c?name:ct('Vehicle no longer listed'))+'</h3><p>'+esc(c?[c.year,c.variant].filter(Boolean).join(' · '):ct('This vehicle is no longer on the public showroom.'))+'</p>'+details+'<div class="savedActions">'+link+'<button class="quiet" data-remove="'+row.vehicle_id+'" aria-label="'+esc(ct('Remove {car} from saved cars',{car:name}))+'">'+ct('Remove')+'</button></div></div></article>';
}
function gate(){epoch++;$('savedGrid').replaceChildren();$('savedAccount').hidden=true;$('savedGate').hidden=false}
async function load(){
 if(busy)return;busy=true;const run=++epoch;$('refreshSaved').disabled=true;$('savedMessage').textContent=ct('Loading your saved cars…');
 try{
  const user=await customer();if(run!==epoch)return;if(!user){gate();$('savedMessage').textContent='';return}
  $('savedGate').hidden=true;let message='';const intent=pendingSave();
  if(intent){try{await setSaved(intent,true);message='Your car has been saved.'}catch(e){message=e.message||'Could not save this car. Open the vehicle and try again.'}clearSave()}
  const rows=await savedRows();const cars=rows.length?await getVehicles():[];if(run!==epoch)return;
  const byId=new Map(cars.map(c=>[c.id,c]));$('savedAccount').hidden=false;$('savedCount').textContent=ct(rows.length===1?'{count} saved car':'{count} saved cars',{count:rows.length});
  $('savedGrid').innerHTML=rows.length?rows.map(row=>savedCard(row,byId.get(row.vehicle_id))).join(''):'<div class="savedEmpty"><h2>'+ct('Your next favourite is out there.')+'</h2><p>'+ct('Tap ♡ Save car on a vehicle’s page to add it here.')+'</p><a href="'+esc(accountURL('showroom.html#cars'))+'">'+ct('Explore the selection ↗')+'</a></div>';
  $('savedMessage').textContent=ct(message);
  document.querySelectorAll('[data-remove]').forEach(button=>button.onclick=async()=>{if(busy)return;busy=true;button.disabled=true;try{await setSaved(button.dataset.remove,false);busy=false;await load();if(run===epoch-1)$('savedMessage').textContent=ct('Car removed from your saved cars.')}catch(e){$('savedMessage').textContent=ct(e.message||'Could not remove. Try again.')}finally{busy=false;button.disabled=false}});
  await Promise.allSettled(rows.map(async row=>{const c=byId.get(row.vehicle_id);if(!c)return;const url=await coverURL(c);if(run!==epoch||!url)return;const el=document.querySelector('[data-cover="'+c.id+'"]');if(el){const img=document.createElement('img');img.src=url;img.alt=c.brand+' '+c.model;img.loading='lazy';img.onerror=()=>{el.textContent=ct('Photo unavailable')};el.replaceChildren(img)}}));
 }catch(e){if(run===epoch){$('savedGrid').replaceChildren();$('savedMessage').textContent=ct(e.message||'Could not load saved cars. Please try again.');$('savedAccount').hidden=false}}
 finally{busy=false;$('refreshSaved').disabled=false}
}
$('refreshSaved').onclick=load;
db?.auth.onAuthStateChange(event=>{if(event==='SIGNED_OUT'){gate();$('savedMessage').textContent=ct('Sign in to view your saved cars.')}else if(event==='SIGNED_IN')setTimeout(load,0)});
window.addEventListener('focus',load);setInterval(()=>{if(!document.hidden)load()},240000);await load();
