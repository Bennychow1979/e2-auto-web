import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../../insurance-data.js',import.meta.url),'utf8');
let mode='duplicate',downloads=0,uploads=[];const bytes=new TextEncoder().encode('Synthetic retained original');
const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
globalThis.__policyTestDB={storage:{from(bucket){assert.equal(bucket,'insurance-policies');return {
 async upload(path,file,options){uploads.push({path,options});return {error:mode==='ok'?null:mode==='network'?{statusCode:'500',message:'Synthetic uncertain upload'}:{statusCode:'409',message:'Already exists'}};},
 async download(){downloads++;return {data:new Blob([mode==='wrong'?new Uint8Array(bytes.length).fill(65):bytes])};}
};}}};
const moduleSource=source.replace("import {db,check} from './e2-data.js';","const db=globalThis.__policyTestDB;const check=r=>{if(r.error)throw r.error;return r.data;};");
const api=await import('data:text/javascript,'+encodeURIComponent(moduleSource));
const doc={path:'synthetic-case/synthetic-document',mime_type:'application/pdf',byte_size:bytes.length,client_sha256:hash};
await api.upload(doc,new Blob([bytes]));assert.equal(downloads,1);assert.equal(uploads[0].options.upsert,false);
mode='wrong';await assert.rejects(api.upload(doc,new Blob([bytes])),/differs/);
mode='duplicate';await assert.rejects(api.upload({...doc,byte_size:1},new Blob([bytes])),/differs/);
mode='network';const before=downloads;await assert.rejects(api.upload(doc,new Blob([bytes])));assert.equal(downloads,before);
mode='ok';await api.upload(doc,new Blob([bytes]));assert.equal(downloads,before);
delete globalThis.__policyTestDB;
console.log('PASS policy upload adapter: duplicate bytes verified without overwriting; different size/hash and uncertain failures rejected.');
