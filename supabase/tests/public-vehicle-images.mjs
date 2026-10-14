import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import * as core from '../functions/e2-drive-photos/core.mjs';
import {publicVehicleImage,validUploadPath} from '../functions/e2-drive-photos/public-image.mjs';
const vehicle='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002';
const photo='20000000-0000-4000-8000-000000000001',object='30000000-0000-4000-8000-000000000099';
const folder='folder_1234567890',file='file_1234567890',root='root_1234567890',checksum='a'.repeat(32);
const source=readFileSync('supabase/functions/e2-drive-photos/index.ts','utf8').replace(/^import .*;\r?\n/gm,'');
const jpeg=new Uint8Array([255,216,255]),webp=new TextEncoder().encode('RIFF0000WEBPVP8 ');
const sensitive='SYNTHETIC_ERROR_MUST_NOT_ESCAPE token=fixture-secret https://private.example/?ticket=fixture';
function fixture({publication='published',stock='Available',kind='drive',afterRead=()=>{},afterQuery=()=>{},ready=true,storageData=new Blob([webp]),errorAt}={}){
 const rows={vehicles:[{id:vehicle,plate:'TEST1234',publication,stock_status:stock}],vehicle_photos:[{id:photo,vehicle_id:vehicle,source:kind,position:0,path:vehicle+'/'+(kind==='drive'?photo+'.drive':object+'.webp')}],vehicle_drive_photos:[{photo_id:photo,vehicle_id:vehicle,folder_id:folder,file_id:file,checksum,mime_type:'image/jpeg',size_bytes:jpeg.length}],staff_memberships:[]};
 const folderMeta={id:folder,name:'TEST1234 CAR',mimeType:'application/vnd.google-apps.folder',parents:[root]};
 const fileMeta={id:file,mimeType:'image/jpeg',parents:[folder],size:jpeg.length,md5Checksum:checksum,capabilities:{canDownload:true}};
 const calls={google:[],images:[],storage:[],clients:[],queries:[],writes:0};let handler;
 const createClient=(_url,key,options)=>{
  calls.clients.push({key,options});const bypass=key==='synthetic-service';
  return {from(table){
   let filters=[],single=false,orders=[],limit=Infinity,fields;
   const q={select(value){fields=value;return q},eq(k,v){filters.push([k,v]);return q},order(k){orders.push(k);return q},limit(n){limit=n;return q},maybeSingle(){single=true;return q},then(resolve,reject){
    if(errorAt===table)return Promise.resolve({data:null,error:{message:sensitive}}).then(resolve,reject);
    let data=rows[table].filter(r=>filters.every(([k,v])=>r[k]===v));
    if(!bypass&&table==='vehicles')data=data.filter(r=>r.publication==='published');
    if(!bypass&&table==='vehicle_photos')data=data.filter(r=>rows.vehicles.some(c=>c.id===r.vehicle_id&&c.publication==='published'));
    data.sort((a,b)=>{for(const k of orders){if(a[k]<b[k])return -1;if(a[k]>b[k])return 1}return 0});
    // Network responses must be detached snapshots, not fixture row references.
    data=structuredClone(data.slice(0,limit));
    const query={key,table,fields,filters,orders,limit};calls.queries.push(query);afterQuery(rows,query,calls);
    return Promise.resolve({data:single?data[0]||null:data,error:null}).then(resolve,reject);
   }};return q;
  },storage:{from(bucket){assert.equal(bucket,'vehicle-photos');assert.equal(key,'synthetic-anon');return {async download(path){calls.storage.push(path);if(errorAt==='storage')throw Error(sensitive);afterRead(rows);return {data:storageData,error:null};}}}},rpc(){calls.writes++;throw Error('No writes')},auth:{getUser(){throw Error('Public route must not authenticate caller')}}};
 };
 const env={SUPABASE_URL:'https://synthetic.supabase.co',SUPABASE_ANON_KEY:'synthetic-anon',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service',E2_DRIVE_ROOT_FOLDER_ID:root,E2_DRIVE_SIGNING_SECRET:'synthetic-only-signing-key-not-for-use',E2_DRIVE_SERVICE_ACCOUNT_JSON:ready?JSON.stringify({client_email:'test@example.test',private_key:'fixture'}):'null'};
 const drive={async metadata(id){calls.google.push(id);if(errorAt==='metadata')throw Error(sensitive);return structuredClone(id===folder?folderMeta:fileMeta)},async image(...args){calls.images.push(args);if(errorAt==='image')throw Error(sensitive);afterRead(rows);return jpeg}};
 vm.runInNewContext(source,{...core,publicVehicleImage,createClient,Request,Response,URL,JSON,Error,Set,Promise,Uint8Array,Deno:{env:{get:key=>env[key]},serve:fn=>handler=fn},googleDrive:()=>drive});
 return {rows,calls,folderMeta,fileMeta,drive,request:(method='GET',query='public_vehicle='+vehicle,headers={})=>handler(new Request('https://synthetic.supabase.co/functions/v1/e2-drive-photos?'+query,{method,headers}))};
}
async function denied(f,{method='GET',query,status=404}={}){
 const r=await f.request(method,query);assert.equal(r.status,status);assert.equal(r.headers.get('cache-control'),'no-store');assert.equal(r.headers.get('x-e2-public-image'),null);assert.equal(r.headers.get('content-type'),'application/json');
 const text=await r.text();assert(!text.includes(sensitive));assert(!text.includes(file));assert(!text.includes('synthetic-service'));assert.equal(f.calls.writes,0);return r;
}
for(const stock of ['Available','Reserved','Sold'])for(const kind of ['drive','upload'])test(stock+' '+kind+' main image is anonymous, no-store and read only',async()=>{
 const f=fixture({stock,kind}),r=await f.request('GET',undefined,{Authorization:'Bearer synthetic-admin',Cookie:'synthetic-session=never-forward'});
 assert.equal(r.status,200);assert.equal(r.headers.get('x-e2-public-image'),'v2');assert.equal(r.headers.get('cache-control'),'no-store');assert.equal(r.headers.get('content-type'),kind==='drive'?'image/jpeg':'image/webp');assert.equal(r.headers.get('x-content-type-options'),'nosniff');assert.equal(r.headers.get('referrer-policy'),'no-referrer');assert.equal(r.headers.get('content-disposition'),'inline');
 assert.deepEqual(new Uint8Array(await r.arrayBuffer()),kind==='drive'?jpeg:webp);assert.equal(f.calls.writes,0);assert.equal(f.calls.clients[1].key,'synthetic-anon');assert.equal(f.calls.clients[1].options.global,undefined);assert(f.calls.queries.filter(q=>q.table!=='vehicle_drive_photos').every(q=>q.key==='synthetic-anon'));assert(!JSON.stringify([...r.headers]).includes('synthetic-'));assert(!r.headers.has('location'));assert(!r.headers.has('set-cookie'));
});
test('upload object UUID differs from default-generated photo row ID and exact associated path is used',async()=>{
 const f=fixture({kind:'upload',ready:false});assert.notEqual(object,photo);assert(validUploadPath(f.rows.vehicle_photos[0].path,vehicle));assert.equal((await f.request()).status,200);assert.deepEqual(f.calls.storage,[vehicle+'/'+object+'.webp']);assert.equal(f.calls.google.length,0);
});
for(const kind of ['upload','drive'])test(kind+' HEAD verifies linkage without downloading image bytes',async()=>{
 const f=fixture({kind}),r=await f.request('HEAD');assert.equal(r.status,200);assert.equal(r.headers.get('x-e2-public-image'),'v2');assert.equal((await r.arrayBuffer()).byteLength,0);assert.equal(f.calls.images.length,0);assert.equal(f.calls.storage.length,0);
});
for(const kind of ['drive','upload'])test(kind+' draft or missing vehicle cannot gain access from staff headers',async()=>{
 for(const missing of [false,true]){const f=fixture({publication:'draft',kind});if(missing)f.rows.vehicles=[];assert.equal((await f.request('GET',undefined,{Authorization:'Bearer synthetic-admin'})).status,404);assert.equal(f.calls.google.length+f.calls.storage.length,0);}
});
test('invalid identities, ambiguous queries and arbitrary file/path selectors fail before data access',async()=>{
 for(const query of ['public_vehicle=invalid','public_vehicle='+vehicle+'&public_vehicle='+other,'public_vehicle='+vehicle+'&ticket=anything','public_vehicle='+vehicle+'&file='+file,'public_vehicle='+vehicle+'&path='+encodeURIComponent(vehicle+'/'+object+'.webp'),'public_vehicle='+vehicle+'&folder='+folder,'public_vehicle='+encodeURIComponent(vehicle+'/../'),'public_vehicle='+encodeURIComponent('<script>alert(1)</script>'),'public_vehicle='+vehicle+'%00']){const f=fixture();await denied(f,{query,status:400});assert.equal(f.calls.queries.length,0);assert.equal(f.calls.google.length+f.calls.storage.length,0);}
});
test('uppercase and URL-encoded UUIDs normalize without accepting encoded delimiters',async()=>{
 const f=fixture();assert.equal((await f.request('GET','public_vehicle='+vehicle.replace('1','%31'))).status,200);
 const id='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',u=fixture({kind:'upload'});u.rows.vehicles[0].id=id;u.rows.vehicle_photos[0].vehicle_id=id;u.rows.vehicle_photos[0].path=id+'/'+object+'.webp';assert.equal((await u.request('GET','public_vehicle='+id.toUpperCase())).status,200);
});
test('bad origins, unsupported methods and legacy HEAD stay rejected',async()=>{
 const f=fixture();assert.equal((await f.request('GET',undefined,{Origin:'https://evil.example'})).status,403);assert.equal(f.calls.queries.length,0);assert.equal((await f.request('HEAD','ticket=anything')).status,405);assert.equal((await f.request('PUT')).status,405);
});
test('missing, wrong-vehicle and unsupported-source photo relations never read objects',async()=>{
 for(const change of [r=>r.vehicle_photos=[],r=>r.vehicle_photos[0].vehicle_id=other,r=>r.vehicle_photos[0].source='document',r=>r.vehicle_photos[0].id='arbitrary']){const f=fixture();change(f.rows);await denied(f);assert.equal(f.calls.google.length+f.calls.storage.length,0);}
});
test('upload rejects cross-vehicle paths, arbitrary files, escapes, buckets and double decoding',async()=>{
 const paths=[null,'',other+'/'+object+'.webp',vehicle+'/'+object+'.jpg',vehicle+'/'+object+'.webp/extra',vehicle+'/../'+object+'.webp',vehicle+'/%2e%2e/'+object+'.webp',vehicle+'/%252e%252e/'+object+'.webp',vehicle+'%2f'+object+'.webp',vehicle+'\\'+object+'.webp','vehicle-photos/'+vehicle+'/'+object+'.webp','https://evil.example/'+object+'.webp',vehicle+'/'+object+'.webp?token=x',vehicle+'/'+object+'.webp#x',vehicle+'/'+object+'.webp\0',vehicle+'/not-a-uuid.webp',vehicle+'/'+'-'.repeat(36)+'.webp'];
 for(const path of paths){const f=fixture({kind:'upload'});f.rows.vehicle_photos[0].path=path;await denied(f);assert.equal(f.calls.storage.length,0);assert(!validUploadPath(path,vehicle));}
});
test('upload rejects empty, oversized or non-WebP bodies and absent objects',async()=>{
 for(const storageData of [null,new Blob([]),new Blob(['<svg onload=alert(1)>']),new Blob([jpeg]),new Blob([new Uint8Array(3145729)])])await denied(fixture({kind:'upload',storageData}));
 assert.equal((await fixture({kind:'upload',storageData:new Blob([webp,new Uint8Array(3145728-webp.length)])}).request()).status,200);
});
test('Drive row belongs to exactly this vehicle/photo and its canonical .drive path',async()=>{
 for(const change of [r=>r.vehicle_drive_photos=[],r=>r.vehicle_drive_photos[0].vehicle_id=other,r=>r.vehicle_drive_photos[0].photo_id=object,r=>r.vehicle_photos[0].path=vehicle+'/'+object+'.drive']){const f=fixture();change(f.rows);await denied(f);assert.equal(f.calls.google.length,0);}
});
test('malformed Drive identifiers, MIME, size and checksum fail before Google',async()=>{
 for(const [field,value] of [['file_id','../arbitrary'],['folder_id','https://evil.example/x'],['mime_type','text/html'],['checksum','bad'],['size_bytes',0],['size_bytes',core.MAX_BYTES+1],['size_bytes','3']]){const f=fixture();f.rows.vehicle_drive_photos[0][field]=value;await denied(f);assert.equal(f.calls.google.length,0);}
});
test('Drive rejects wrong root, plate, folder, identity and changed metadata',async()=>{
 const cases=[f=>f.folderMeta.parents=['wrong_root'],f=>f.folderMeta.name='TEST12340 CAR',f=>f.folderMeta.id=file,f=>f.folderMeta.trashed=true,f=>f.folderMeta.mimeType='text/plain',f=>f.fileMeta.id='other_1234567890',f=>f.fileMeta.parents=['wrong_folder'],f=>f.fileMeta.trashed=true,f=>f.fileMeta.capabilities.canDownload=false,f=>f.fileMeta.md5Checksum='b'.repeat(32),f=>f.fileMeta.mimeType='image/png',f=>f.fileMeta.size=4];
 for(const change of cases){const f=fixture();change(f);await denied(f);assert.equal(f.calls.images.length,0);}
});
test('Drive supports JPEG, PNG and WebP with byte/type/size verification',async()=>{
 for(const [mime,bytes] of [['image/jpeg',jpeg],['image/png',new Uint8Array([137,80,78,71,13,10,26,10])],['image/webp',webp]]){const f=fixture();Object.assign(f.rows.vehicle_drive_photos[0],{mime_type:mime,size_bytes:bytes.length});Object.assign(f.fileMeta,{mimeType:mime,size:bytes.length});f.drive.image=async()=>bytes;const r=await f.request();assert.equal(r.status,200);assert.equal(r.headers.get('content-type'),mime);}
 for(const bytes of [new Uint8Array(),new Uint8Array([1,2,3]),new Uint8Array([255,216,255,0])]){const f=fixture();f.drive.image=async()=>bytes;await denied(f);}
});
for(const kind of ['drive','upload'])test(kind+' withdrawal, reassignment, source/path and first-photo changes discard fetched bytes',async()=>{
 const changes=[r=>r.vehicles[0].publication='draft',r=>r.vehicles=[],r=>r.vehicles[0].plate='OTHER1',r=>r.vehicle_photos=[],r=>r.vehicle_photos[0].vehicle_id=other,r=>r.vehicle_photos[0].source='document',r=>r.vehicle_photos[0].path+='changed',r=>r.vehicle_photos[0].position=1,r=>{r.vehicle_photos[0].position=1;r.vehicle_photos.push({...r.vehicle_photos[0],id:object,position:0});}];
 for(const afterRead of changes)await denied(fixture({kind,afterRead}));
});
test('Drive rechecks complete private link after retrieval, not just existence',async()=>{
 for(const field of ['photo_id','vehicle_id','folder_id','file_id','checksum','mime_type','size_bytes'])await denied(fixture({afterRead:r=>r.vehicle_drive_photos[0][field]='changed'}));await denied(fixture({afterRead:r=>r.vehicle_drive_photos=[]}));
});
for(const kind of ['drive','upload'])test(kind+' HEAD rechecks a withdrawn relation after initial reads',async()=>{
 const f=fixture({kind,afterQuery:(rows,q,calls)=>{if(q.table==='vehicle_photos'&&calls.queries.filter(c=>c.table==='vehicle_photos').length===1)rows.vehicle_photos=[];}});await denied(f,{method:'HEAD'});assert.equal(f.calls.images.length+f.calls.storage.length,0);
});
test('public failures never reflect secret-shaped errors, URLs or identifiers',async()=>{
 for(const errorAt of ['vehicles','vehicle_photos','vehicle_drive_photos','metadata','image','storage'])await denied(fixture({kind:errorAt==='storage'?'upload':'drive',errorAt}));await denied(fixture({ready:false}),{status:503});
});
test('public route stays separate from legacy signed-ticket and caller authentication',()=>{
 assert(source.includes("await readTicket(new URL(req.url).searchParams.get('ticket'),signing)"));assert(!source.includes('ticket.publicOnly'));assert(source.includes("const caller=actor?createClient(url,anon,{global:{headers:{Authorization:authorization}}"));
});
