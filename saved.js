import {db,customer,savedRows,setSaved} from './saved-data.js';
import {pendingSave,clearSave} from './saved-intent.js';
import {getVehicles,coverURL,esc,rm} from './e2-data.js';
const $=id=>document.getElementById(id);let epoch=0,busy=false;
function gate(){epoch++;$('savedGrid').replaceChildren();$('savedAccount').hidden=true;$('savedGate').hidden=false}
async function load(){
 if(busy)return;busy=true;const run=++epoch;$('refreshSaved').disabled=true;$('savedMessage').textContent='Loading your saved cars…';
 try{
  const user=await customer();if(run!==epoch)return;if(!user){gate();$('savedMessage').textContent='';return}
  $('savedGate').hidden=true;let message='';const intent=pendingSave();
  if(intent){try{await setSaved(intent,true);message='Your car has been saved.'}catch(e){message=e.message||'Could not save this car. Open the vehicle and try again.'}clearSave()}
  const rows=await savedRows();const cars=rows.length?await getVehicles():[];if(run!==epoch)return;
  const byId=new Map(cars.map(c=>[c.id,c]));$('savedAccount').hidden=false;$('savedCount').textContent=rows.length+' saved '+(rows.length===1?'car':'cars');
  $('savedGrid').innerHTML=rows.length?rows.map(row=>{const c=byId.get(row.vehicle_id);return '<article class="savedCard"><div class="savedImage" data-cover="'+row.vehicle_id+'">'+(c?'Photo unavailable':'No longer listed')+'</div><div class="savedDetails"><span class="savedStatus">'+esc(c?.stock_status||'Unavailable')+'</span><h3>'+esc(c?c.brand+' '+c.model:'Vehicle no longer listed')+'</h3><p>'+esc(c?[c.year,c.variant].filter(Boolean).join(' · '):'This vehicle is no longer on the public showroom.')+'</p>'+(c?'<p>PLATE · '+esc(c.plate)+'</p><p class="price">'+rm(c.price)+'</p>':'')+'<div class="savedActions">'+(c?'<a href="car.html?id='+encodeURIComponent(c.id)+'">View car ↗</a>':'<a href="showroom.html#cars">Explore cars ↗</a>')+'<button class="quiet" data-remove="'+row.vehicle_id+'" aria-label="Remove '+esc(c?c.brand+' '+c.model:'unavailable vehicle')+' from saved cars">Remove</button></div></div></article>'}).join(''):'<div class="savedEmpty"><h2>Your next favourite is out there.</h2><p>Tap ♡ Save car on a vehicle’s page to add it here.</p><a href="showroom.html#cars">Explore the selection ↗</a></div>';
  $('savedMessage').textContent=message;
  document.querySelectorAll('[data-remove]').forEach(button=>button.onclick=async()=>{if(busy)return;busy=true;button.disabled=true;try{await setSaved(button.dataset.remove,false);busy=false;await load();if(run===epoch-1)$('savedMessage').textContent='Car removed from your saved cars.'}catch(e){$('savedMessage').textContent=e.message||'Could not remove. Try again.'}finally{busy=false;button.disabled=false}});
  await Promise.allSettled(rows.map(async row=>{const c=byId.get(row.vehicle_id);if(!c)return;const url=await coverURL(c);if(run!==epoch||!url)return;const el=document.querySelector('[data-cover="'+c.id+'"]');if(el){const img=document.createElement('img');img.src=url;img.alt=c.brand+' '+c.model;img.loading='lazy';img.onerror=()=>{el.textContent='Photo unavailable'};el.replaceChildren(img)}}));
 }catch(e){if(run===epoch){$('savedGrid').replaceChildren();$('savedMessage').textContent=e.message||'Could not load saved cars. Please try again.';$('savedAccount').hidden=false}}
 finally{busy=false;$('refreshSaved').disabled=false}
}
$('refreshSaved').onclick=load;
db?.auth.onAuthStateChange(event=>{if(event==='SIGNED_OUT'){gate();$('savedMessage').textContent='Sign in to view your saved cars.'}else if(event==='SIGNED_IN')setTimeout(load,0)});
window.addEventListener('focus',load);setInterval(()=>{if(!document.hidden)load()},240000);await load();
