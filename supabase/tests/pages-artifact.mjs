import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,mkdir,rename,unlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildVehicleSite} from '../../scripts/build-vehicle-pages.mjs';
import {verifyPagesArtifact} from '../../scripts/verify-pages-artifact.mjs';
import {vehicleA} from '../../tests/fixtures/vehicle-pages.mjs';

test('Pages upload gate checks generated content and existing customer/PDF assets',async t=>{
 const folder=await mkdtemp(join(tmpdir(),'e2-pages-release-')),out=join(folder,'site');
 const snapshot={kind:'public-complete',complete:true,expectedCount:1,fetchedAt:new Date().toISOString(),vehicles:[structuredClone(vehicleA)],publicImageOrigin:'https://synthetic-vehicle.supabase.co',publicPhotos:[{vehicleId:vehicleA.id,photoId:vehicleA.id,source:'upload'}]};
 const headers=new Headers({'x-e2-public-image':'v2','content-type':'image/webp','cache-control':'no-store','x-content-type-options':'nosniff','content-disposition':'inline','referrer-policy':'no-referrer'});
 await buildVehicleSite(snapshot,out,{release:true,imageRequest:async(_url,options)=>{assert.equal(options.method,'HEAD');return {ok:true,headers};}});
 await t.test('a complete three-language artifact passes without a CNAME requirement',async()=>{
  const result=await verifyPagesArtifact(snapshot,out);assert.equal(result.pages,3);assert.equal(result.preservedFiles,15);
 });
 await t.test('customer initialization changes cannot pass the packaging gate',async()=>{
  const file=join(out,'customer.js'),original=await readFile(file);
  try{await writeFile(file,'broken customer initialization');await assert.rejects(verifyPagesArtifact(snapshot,out),/Existing page\/asset changed: customer.js/);}finally{await writeFile(file,original);}
 });
 await t.test('a missing PDF worker blocks upload',async()=>{
  const file=join(out,'vendor/pdfjs/pdf.worker.mjs'),saved=join(folder,'worker.mjs');await rename(file,saved);
  try{await assert.rejects(verifyPagesArtifact(snapshot,out),/ENOENT/);}finally{await rename(saved,file);}
 });
 await t.test('a local-only build cannot be uploaded as a verified release',async()=>{
  const file=join(out,'vehicle-pages-manifest.json'),original=await readFile(file),changed=JSON.parse(original);changed.releaseArtifact=false;
  try{await writeFile(file,JSON.stringify(changed));await assert.rejects(verifyPagesArtifact(snapshot,out));}finally{await writeFile(file,original);}
 });
 await t.test('build inputs or repository folders in the public artifact block upload',async()=>{
  const file=join(out,'public-inventory-snapshot.json');await writeFile(file,'{}');
  try{await assert.rejects(verifyPagesArtifact(snapshot,out),/Build-only content/);}finally{await unlink(file);}
  await mkdir(join(out,'supabase'));await assert.rejects(verifyPagesArtifact(snapshot,out),/Build-only content/);
 });
});
