import assert from 'node:assert/strict';
import {readFile,lstat,readdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {publicRows} from './build-vehicle-pages.mjs';
import {vehiclePath} from '../vehicle-routes.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const preserved=['customer.html','customer.js','my-e2.html','my-e2.js','customer-session.mjs','car-detail-demo.css','e2-data.js','e2-config.js','documents.html','documents.js','document-preview.js','privacy/index.html','verified-model-years.json','vendor/pdfjs/pdf.mjs','vendor/pdfjs/pdf.worker.mjs'];
export async function verifyPagesArtifact(snapshot,output,{source=root,now=Date.now()}={}){
 const out=resolve(output),rows=publicRows(snapshot,{now}),manifest=JSON.parse(await readFile(join(out,'vehicle-pages-manifest.json'),'utf8'));
 assert.equal(manifest.releaseArtifact,true);assert.equal(manifest.imageGatewayVersion,'v2');assert.equal(manifest.imageGatewayCheck,'HEAD');assert.equal(manifest.imageGatewayVerified,true);
 assert.equal(manifest.fetchedAt,snapshot.fetchedAt);assert.equal(manifest.files.length,rows.length*3);assert.equal(new Set(manifest.files).size,manifest.files.length);
 assert.deepEqual(manifest.vehicles,rows.map(v=>({id:v.id,updated_at:v.updated_at})));
 const registry=JSON.parse(await readFile(join(out,'data/car-slugs.json'),'utf8'));assert.deepEqual(registry,manifest.slugs);
 for(const file of preserved)assert.deepEqual(await readFile(join(out,file)),await readFile(join(source,file)),'Existing page/asset changed: '+file);
 // Pages settings own the current custom domain; main has no CNAME file.
 // Preserve one if a future reviewed source adds it.
 let cname;try{cname=await readFile(join(source,'CNAME'));}catch(e){if(e.code!=='ENOENT')throw e;}
 if(cname)assert.deepEqual(await readFile(join(out,'CNAME')),cname);
 for(const name of ['.git','.github','.release-backups','node_modules','supabase','scripts','tests','public-inventory-snapshot.json']){
  let exists=false;try{await lstat(join(out,name));exists=true;}catch(e){if(e.code!=='ENOENT')throw e;}assert(!exists,'Build-only content in public artifact: '+name);
 }
 async function checkFiles(dir){for(const name of await readdir(dir)){const p=join(dir,name),stat=await lstat(p);assert(!stat.isSymbolicLink(),'No links in deployable artifact');if(stat.isDirectory())await checkFiles(p);}}
 await checkFiles(out);
 const photoIDs=new Set(snapshot.publicPhotos.filter(p=>p.photoId).map(p=>p.vehicleId));
 for(const car of rows)for(const lang of ['en','ms','zh']){
  const route=vehiclePath(car.id,lang,registry),file=route.slice(1)+'index.html';assert(manifest.files.includes(file));const html=await readFile(join(out,file),'utf8');
  assert(html.includes('data-vehicle-id="'+car.id+'"'));assert(html.includes('<link rel="canonical" href="https://e2auto.my'+route+'">'));
  const data=/<script id="vehicleStructuredData" type="application\/ld\+json">([^<]*)<\/script>/.exec(html);assert(data);JSON.parse(data[1]);
  if(photoIDs.has(car.id))assert(html.includes(snapshot.publicImageOrigin+'/functions/v1/e2-drive-photos?public_vehicle='+car.id));
  assert(!html.includes('?ticket='));
 }
 const sitemap=await readFile(join(out,'sitemap.xml'),'utf8');assert.equal((sitemap.match(/<loc>/g)||[]).length,rows.length*3+7);
 return {vehicles:rows.length,pages:manifest.files.length,preservedFiles:preserved.length,publicImageVersion:'v2',photoBytesDownloaded:0,artifactVerified:true};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [input,output]=process.argv.slice(2);if(!input||!output||process.argv.length!==4)throw Error('Usage: node scripts/verify-pages-artifact.mjs <snapshot.json> <output-directory>');
 console.log(JSON.stringify(await verifyPagesArtifact(JSON.parse(await readFile(input,'utf8')),output)));
}
