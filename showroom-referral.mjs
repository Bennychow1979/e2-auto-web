import {readReferral,validCode} from './partner-referral-core.mjs';

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
  return id=>{
    const query=new URLSearchParams({id});
    if(code)query.set('ref',code);
    return 'car.html?'+query.toString();
  };
}
