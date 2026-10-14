// Explicit anonymous public reads. No login, service key or integration trigger.
import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import vm from 'node:vm';
import {fetchPublicInventory,createSlugMap} from './build-vehicle-pages.mjs';
import {fetchPublicPhotoCoverage} from './vehicle-public-images.mjs';
export async function readPriorSlugs({bootstrap=false,seed={},request=fetch}={}){
 createSlugMap([],seed);
 const response=await request('https://e2auto.my/data/car-slugs.json',{credentials:'omit',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)});
 if(response.status===404&&bootstrap)return seed;
 if(!response.ok)throw Error('Previous deployed slug registry is unavailable. Preserve the previous deployment. Initial activation alone may use explicit --bootstrap.');
 const raw=await response.text();if(raw.length>4000000)throw Error('Registry is too large.');const prior=JSON.parse(raw);if(!prior||Array.isArray(prior)||typeof prior!=='object')throw Error('Invalid deployed registry.');createSlugMap([],prior);
 for(const [id,slug] of Object.entries(seed))if(prior[id]&&prior[id]!==slug)throw Error('Deployed slug disagrees with reviewed seed.');return createSlugMap([],{...seed,...prior});
}
export async function fetchBuildInput(config,{bootstrap=false,seed={},request=fetch}={}){
 const priorSlugs=await readPriorSlugs({bootstrap,seed,request});
 const snapshot=await fetchPublicInventory(config,request);
 snapshot.publicPhotos=await fetchPublicPhotoCoverage(config,snapshot,request);
 return {...snapshot,publicImageOrigin:config.supabaseUrl,priorSlugs};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [output,mode]=process.argv.slice(2);if(!output||process.argv.length>4||(mode&&mode!=='--bootstrap'))throw Error('Usage: node scripts/fetch-vehicle-build-input.mjs <snapshot-output.json> [--bootstrap]');
 const context={window:{}};vm.runInNewContext(await readFile(new URL('../e2-config.js',import.meta.url),'utf8'),context);
 const seed=JSON.parse(await readFile(new URL('../data/car-slugs.json',import.meta.url),'utf8'));
 const snapshot=await fetchBuildInput(context.window.E2_CONFIG,{bootstrap:mode==='--bootstrap',seed});
 await writeFile(output,JSON.stringify(snapshot,null,2)+'\n');
 console.log(JSON.stringify({published:snapshot.vehicles.length,withMainImage:snapshot.publicPhotos.filter(p=>p.photoId).length,fetchedAt:snapshot.fetchedAt,photoBytesDownloaded:0}));
}
