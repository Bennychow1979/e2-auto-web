import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import * as core from '../functions/e2-drive-photos/core.mjs';
const actor='00000000-0000-4000-8000-000000000001',vehicle='10000000-0000-4000-8000-000000000001',photo='20000000-0000-4000-8000-000000000001';
const folder='folder_1234567890',file='file_1234567890',root='root_1234567890',checksum='a'.repeat(32),secret='test-only-signing-key-at-least-32-characters';
const rows={
  vehicles:[{id:vehicle,plate:'VBH4735',publication:'draft'}],
  staff_memberships:[{user_id:actor,role:'admin',active:true}],
  vehicle_photos:[{id:photo,vehicle_id:vehicle,source:'drive'}],
  vehicle_drive_photos:[{photo_id:photo,vehicle_id:vehicle,folder_id:folder,file_id:file,checksum,mime_type:'image/jpeg'}]
};
let googleCalls=0,handler;
function createClient(_url,key,options={}) {
  const bypass=key==='service',staff=options.global?.headers.Authorization==='Bearer valid-admin';
  return {
    auth:{getUser:async token=>token==='valid-admin'?{data:{user:{id:actor}},error:null}:{data:{user:null},error:{message:'invalid'}}},
    from(table) {
      let filters=[],single=false;
      const q={
        select(){return q},eq(name,value){filters.push(r=>r[name]===value);return q},
        in(name,values){filters.push(r=>values.includes(r[name]));return q},maybeSingle(){single=true;return q},
        then(resolve,reject) {
          let data=rows[table].filter(r=>filters.every(f=>f(r)));
          if(!bypass&&!staff&&table==='vehicle_photos')data=data.filter(r=>rows.vehicles.some(v=>v.id===r.vehicle_id&&v.publication==='published'));
          return Promise.resolve({data:single?data[0]||null:data,error:null}).then(resolve,reject);
        }
      };return q;
    },
    rpc:async()=>({data:1,error:null})
  };
}
const env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_ANON_KEY:'anon',SUPABASE_SERVICE_ROLE_KEY:'service',E2_DRIVE_ROOT_FOLDER_ID:root,E2_DRIVE_SIGNING_SECRET:secret,E2_DRIVE_SERVICE_ACCOUNT_JSON:JSON.stringify({client_email:'test@example.test',private_key:'test'})};
// Build an unmistakably synthetic key at runtime; never embed credentials in fixtures.
const serverKey='sb_secret_'+'0'.repeat(32);
env.SUPABASE_SECRET_KEYS=JSON.stringify({default:serverKey});
const source=readFileSync('supabase/functions/e2-drive-photos/index.ts','utf8').replace(/^import .*;\r?\n/gm,'');
vm.runInNewContext(source,{
  ...core,createClient,Request,Response,URL,JSON,Error,Set,Promise,
  Deno:{env:{get:key=>env[key]},serve:fn=>handler=fn},
  googleDrive:()=>({
    metadata:async id=>{googleCalls++;return id===root?{name:'E2 Vehicle Uploads',mimeType:'application/vnd.google-apps.folder'}:id===folder?{name:'VBH4735 CIVIC',mimeType:'application/vnd.google-apps.folder',parents:[root]}:{id:file,mimeType:'image/jpeg',parents:[folder],size:100,md5Checksum:checksum,capabilities:{canDownload:true}}},
    list:async()=>{googleCalls++;return []},
    image:async()=>new Uint8Array([255,216,255])
  })
});
async function post(body,authorization='',origin='https://e2auto.my',apikey='') {
  return handler(new Request('https://example.supabase.co/functions/v1/e2-drive-photos',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin,apikey,...(authorization?{Authorization:authorization}:{})},body:JSON.stringify(body)}));
}
assert.equal((await post({action:'list',vehicle,folder})).status,403);
assert.equal((await post({action:'attach',vehicle,folder,files:[]})).status,403);
assert.equal((await post({action:'connection-check'})).status,403);
assert.equal((await post({action:'connection-check'},'Bearer valid-admin')).status,403);
assert.equal((await post({action:'connection-check'},'Bearer forged-service')).status,403);
assert.equal(googleCalls,0,'Anonymous requests do not reach Google');
assert.equal((await post({action:'connection-check'},'','https://e2auto.my','sb_secret_'+'1'.repeat(32))).status,403);
assert.equal((await post({action:'connection-check'},'','https://e2auto.my',serverKey)).status,200);
assert.equal((await post({action:'connection-check'},'Bearer service')).status,200);
assert.equal((await post({action:'attach',vehicle,folder,files:[]},'','https://e2auto.my',serverKey)).status,403,'Server diagnostic key does not bypass staff management');
assert.equal((await post({action:'status'},'Bearer valid-admin','https://evil.example')).status,403);
assert.equal((await (await post({action:'urls',ids:[photo]})).json()).photos.length,0,'Draft URL is not issued publicly');
assert.equal((await (await post({action:'urls',ids:[photo]},'Bearer forged-admin')).json()).photos.length,0);
const staffURLs=await (await post({action:'urls',ids:[photo]},'Bearer valid-admin')).json();
assert.equal(staffURLs.photos.length,1);
assert.equal((await handler(new Request(staffURLs.photos[0].url))).status,200);
rows.staff_memberships[0].active=false;
assert.equal((await handler(new Request(staffURLs.photos[0].url))).status,403,'Revoked staff cannot reuse a draft ticket');
rows.staff_memberships[0].active=true;
rows.vehicles[0].publication='published';
const publicURLs=await (await post({action:'urls',ids:[photo]})).json();
assert.equal((await handler(new Request(publicURLs.photos[0].url))).status,200);
assert.equal((await post({action:'attach',vehicle,folder,files:[]},'Bearer valid-admin')).status,409);
rows.vehicles[0].publication='draft';
assert.equal((await handler(new Request(publicURLs.photos[0].url))).status,403,'Moving to draft revokes public image tickets');
const tampered=publicURLs.photos[0].url+'x';
assert.equal((await handler(new Request(tampered))).status,400);
console.log('PASS Edge handler: origin, Auth verification, draft RLS, staff revocation, published-only public images and signed tickets');
