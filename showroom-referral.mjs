import {readReferral,validCode} from './partner-referral-core.mjs';
import {vehiclePath,usesStaticVehiclePages} from './vehicle-routes.mjs';

export function showroomLink(base,code){
  if(!validCode(code))throw Error('An active Partner code is required.');
  const url=new URL('showroom.html',base);
  url.searchParams.set('ref',code);
  return url.href;
}

// Keep the code on actual links, including new-tab opens and storage-blocked browsers.
// Browsing alone does not create a lead or confirm ownership; the enquiry RPC does.
export function showroomVehicleLinks({enabled,storage,search,now=Date.now()}){
  const code=enabled?readReferral(storage,search,now):null;
  const vehicleHref=id=>{
    if(id&&usesStaticVehiclePages()){const lang=/^\/(ms|zh)\//.exec(globalThis.location?.pathname||'')?.[1]||'en',url=new URL(vehiclePath(id,lang),'https://e2auto.my');if(code)url.searchParams.set('ref',code);return url.pathname+url.search;}
    const query=new URLSearchParams({id});
    if(code)query.set('ref',code);
    return 'car.html?'+query.toString();
  };
  vehicleHref.hasReferral=!!code;
  return vehicleHref;
}

export function showroomContactAction(kind,hasReferral){
  if(!hasReferral)return null;
  if(kind==='viewing')return {href:'#cars',label:'Choose a car to arrange a viewing'};
  if(kind==='trade-in')return {href:'#cars',label:'Choose a car to discuss a trade-in'};
  return null;
}
