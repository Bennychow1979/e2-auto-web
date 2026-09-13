import {db,customer,savedRows,setSaved} from './saved-data.js';
import {rememberSave,clearSave} from './saved-intent.js';
export async function setupCarSave(car){
 const button=document.getElementById('saveCar'),note=document.getElementById('saveCarStatus');
 if(!button||car.publication!=='published')return;
 let saved=false,busy=false,revision=0;
 const paint=()=>{button.textContent=saved?'♥ Saved':'♡ Save car';button.setAttribute('aria-pressed',String(saved));button.disabled=busy};
 async function refresh(){if(busy)return;const run=++revision;try{const user=await customer();const rows=user?await savedRows():[];if(run!==revision)return;saved=rows.some(row=>row.vehicle_id===car.id);note.textContent='';paint()}catch{if(run===revision)note.textContent='Could not check your saved cars. Try Save car again.'}}
 button.hidden=false;paint();
 button.onclick=async()=>{if(busy)return;busy=true;revision++;paint();note.textContent='';try{
  if(!await customer()){rememberSave(car.id);location.href='customer.html';return}
  const rows=await savedRows();const keep=!rows.some(row=>row.vehicle_id===car.id);
  saved=await setSaved(car.id,keep);clearSave();note.textContent=keep?'Saved to your account.':'Removed from your saved cars.';
 }catch(e){note.textContent=e.message||'Could not save. Please try again.'}finally{busy=false;paint()}};
 db?.auth.onAuthStateChange(event=>{if(event==='SIGNED_OUT'){revision++;saved=false;note.textContent='';paint()}else if(event==='SIGNED_IN')setTimeout(refresh,0)});
 window.addEventListener('focus',refresh);await refresh();
}
