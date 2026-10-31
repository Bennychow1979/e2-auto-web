import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import vm from 'node:vm';
import {fetchPublicInventory,publicRows} from './build-vehicle-pages.mjs';
import {fetchPublicPhotoCoverage} from './vehicle-public-images.mjs';
export function sameProjection(candidate,current){
 const normalize=s=>({vehicles:publicRows(s).sort((a,b)=>a.id.localeCompare(b.id)),photos:[...s.publicPhotos].sort((a,b)=>a.vehicleId.localeCompare(b.vehicleId))});
 return JSON.stringify(normalize(candidate))===JSON.stringify(normalize(current));
}
export async function verifyInventoryCurrent(candidate,config,request=fetch){
 const current=await fetchPublicInventory(config,request);
 current.publicPhotos=await fetchPublicPhotoCoverage(config,current,request);
 if(!sameProjection(candidate,current))throw Error('Inventory changed during build; do not publish this candidate. The dirty revision remains pending for retry.');
 return {projectionCurrent:true,verifiedAt:current.fetchedAt,vehicles:current.vehicles.length};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 if(process.argv.length!==3)throw Error('Usage: node scripts/verify-inventory-current.mjs <snapshot.json>');
 const context={window:{}};vm.runInNewContext(await readFile(new URL('../e2-config.js',import.meta.url),'utf8'),context);
 console.log(JSON.stringify(await verifyInventoryCurrent(JSON.parse(await readFile(process.argv[2],'utf8')),context.window.E2_CONFIG)));
}
