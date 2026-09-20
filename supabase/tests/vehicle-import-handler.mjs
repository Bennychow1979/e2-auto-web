import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
let handler,calls=0,role='admin',active=true;
const env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_ANON_KEY:'anon',SUPABASE_SERVICE_ROLE_KEY:'service'};
const source=readFileSync('supabase/functions/e2-vehicle-import/index.ts','utf8').replace(/^import .*;\r?\n/gm,'');
vm.runInNewContext(source,{
  Request,Response,URL,JSON,Error,Set,Map,Promise,Date,
  Deno:{env:{get:k=>env[k]},serve:fn=>handler=fn},ExcelJS:{},googleDrive:()=>({}),
  runImport:async()=>{calls++;return {created:[],blocked:[],remaining:0}},
  createClient:()=>({
    auth:{getUser:async token=>token==='valid'?{data:{user:{id:'user'}},error:null}:{data:{user:null},error:{message:'invalid'}}},
    from:()=>({select(){return this},eq(){return this},maybeSingle:async()=>({data:{role,active},error:null})})
  })
});
const call=(body={action:'run'},token='valid',origin='https://e2auto.my')=>handler(new Request('https://example.supabase.co/functions/v1/e2-vehicle-import',{method:'POST',headers:{Authorization:'Bearer '+token,Origin:origin},body:JSON.stringify(body)}));
assert.equal((await call({},'invalid')).status,401);assert.equal((await call({},'valid','https://evil.example')).status,403);
role='sales';assert.equal((await call()).status,403);role='admin';active=false;assert.equal((await call()).status,403);active=true;
assert.equal((await call()).status,503);assert.equal(calls,0,'No source access before explicit deployment gate');
env.E2_VEHICLE_IMPORT_ENABLED='true';assert.equal((await call({action:'publish'})).status,400);
assert.equal((await call()).status,200);assert.equal(calls,1);
console.log('Vehicle importer handler: authentication, roles, origin and activation gate passed.');
