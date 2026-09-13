import {getVehicles} from './e2-data.js?v=profile-1';
import {publicContact,vehicleShareURL} from './referral.js';
const $ = id => document.getElementById(id);
let revision=0, currentStaff=null, publicName='', stock=[];
export async function updateSharing(staffId, published) {
  const run=++revision;
  currentStaff=null; publicName=''; stock=[];
  $('shareFields').disabled=true; $('shareResult').hidden=true;
  $('shareVehicle').replaceChildren(new Option('Choose a vehicle',''));
  $('shareStatus').textContent=published?'Checking the published profile…':'A Super Admin must publish this profile before you can create personal vehicle links.';
  if (!published) return;
  const [contact,cars]=await Promise.all([publicContact(staffId,window.E2_CONFIG),getVehicles().catch(()=>null)]);
  if(run!==revision)return;
  if(!contact){$('shareStatus').textContent='This profile is not publicly available. Check that the staff account is active and the profile is published.';return}
  if(!cars){$('shareStatus').textContent='Could not load vehicles. Use Reload saved profile to retry.';return}
  stock=cars; currentStaff=staffId; publicName=contact.display_name;
  for(const car of cars)$('shareVehicle').add(new Option([car.plate,car.year,car.brand,car.model,car.variant].filter(Boolean).join(' · '),car.id));
  $('shareFields').disabled=!cars.length;
  $('shareStatus').textContent=cars.length?'Links from this profile connect customers with '+publicName+'.':'No published vehicles to share yet.';
}
$('shareVehicle').onchange=()=>{
  const car=stock.find(c=>c.id===$('shareVehicle').value);
  $('shareResult').hidden=!car;
  if(!car||!currentStaff)return;
  const url=vehicleShareURL(location.href,car.id,currentStaff);
  $('shareURL').value=url; $('previewShare').href=url;
  $('shareStatus').textContent='Customer enquiries for this link go to '+publicName+'.';
};
$('copyShare').onclick=async()=>{
  const run=revision, staff=currentStaff, url=$('shareURL').value;
  if(!staff||!stock.some(c=>c.id===$('shareVehicle').value))return;
  $('copyShare').disabled=true;
  try{
    if(!await publicContact(staff,window.E2_CONFIG)){if(run===revision)await updateSharing(staff,false);return}
    if(run!==revision||url!==$('shareURL').value)return;
    try{await navigator.clipboard.writeText(url);$('shareStatus').textContent='Link copied. Paste it into your customer chat.'}
    catch{$('shareURL').focus();$('shareURL').select();$('shareStatus').textContent='Select and copy the link below.'}
  }finally{$('copyShare').disabled=false}
};
