const uuid='[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
export const staticVehiclePattern=new RegExp('^/(?:ms/|zh/)?cars/(?:('+uuid+')\\.html|[a-z0-9]+(?:-[a-z0-9]+)*/)$','i');
export function pageSlugs(document=globalThis.document){try{return JSON.parse(document?.getElementById?.('vehicleRoutes')?.textContent||'{}')}catch{return {}}}
export function vehiclePath(id,lang='en',slugs=pageSlugs()){
 if(!new RegExp('^'+uuid+'$','i').test(id||''))throw Error('Invalid vehicle ID.');
 const key=id.toLowerCase(),prefix='/'+(['ms','zh'].includes(lang)?lang+'/':'');
 // Newly published vehicles remain reachable through legacy links until rebuilt.
 return slugs[key]?prefix+'cars/'+slugs[key]+'/':prefix+'car.html?id='+key;
}
export function vehicleIdentity(location,document=globalThis.document){
 const match=staticVehiclePattern.exec(location.pathname||''),queryId=new URLSearchParams(location.search).get('id');
 let pathId=match?.[1]?.toLowerCase();
 if(match&&!pathId){pathId=document?.documentElement?.dataset?.vehicleId;const lang=/^\/(ms|zh)\//.exec(location.pathname)?.[1]||'en';if(!pathId||vehiclePath(pathId,lang,pageSlugs(document))!==location.pathname)throw Error('This vehicle route does not match its saved identity.');}
 if(pathId&&queryId&&pathId!==queryId.toLowerCase())throw Error('This vehicle link does not match the vehicle page.');
 return pathId||queryId;
}
export const usesStaticVehiclePages=()=>globalThis.document?.documentElement?.dataset?.vehiclePages==='static-v1';
