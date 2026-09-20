import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import ExcelJS from 'npm:exceljs@4.4.0';
import {googleDrive} from '../e2-drive-photos/google.mjs';
import {runImport} from './run.mjs';
const origins=new Set(['https://e2auto.my','https://bennychow1979.github.io']);
const url=Deno.env.get('SUPABASE_URL')||'',anon=Deno.env.get('SUPABASE_ANON_KEY')||'';
const options={auth:{persistSession:false,autoRefreshToken:false}};
const admin=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'',options);
let credentials=null;try{credentials=JSON.parse(Deno.env.get('E2_DRIVE_SERVICE_ACCOUNT_JSON')||'null')}catch{}
const drive=googleDrive(credentials),root=Deno.env.get('E2_DRIVE_ROOT_FOLDER_ID')||'1shtrbAggeUA8mc2lt8eBF4D8v-LFsqjx';
const checked=r=>{if(r.error)throw Error('Inventory import could not finish. Refresh before retrying.');return r.data};
async function all(table,columns) {
  const rows=[];
  for(let offset=0;;offset+=500){const batch=checked(await admin.from(table).select(columns).order(table==='vehicles'?'id':'folder_id').range(offset,offset+499));rows.push(...batch);if(batch.length<500)return rows}
}
const store={
  inventory:()=>all('vehicles','id,plate'),
  jobs:async()=>new Map((await all('vehicle_import_jobs','folder_id,fingerprint,status,issue,vehicle_id')).map(j=>[j.folder_id,j])),
  save:async job=>{checked(await admin.from('vehicle_import_jobs').upsert({...job,updated_at:new Date().toISOString()}))},
  commit:async({actor,folder,stamp,source,plan})=>checked(await admin.rpc('e2_import_drive_vehicle',{actor_id:actor,folder,stamp,source_stamp:source,plan})),
  verify:async id=>{
    const car=checked(await admin.from('vehicles').select('publication,price').eq('id',id).single());
    const album=checked(await admin.from('vehicle_photos').select('id,position').eq('vehicle_id',id).order('position'));
    const links=checked(await admin.from('vehicle_drive_photos').select('photo_id,file_id').eq('vehicle_id',id));
    return {...car,photos:album.map(p=>({...p,file_id:links.find(l=>l.photo_id===p.id)?.file_id}))};
  }
};
Deno.serve(async req=>{
  const origin=req.headers.get('Origin')||'';
  const headers={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin',
    'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS',
    ...(origins.has(origin)?{'Access-Control-Allow-Origin':origin}:{})};
  const reply=(status,body)=>new Response(JSON.stringify(body),{status,headers});
  if(origin&&!origins.has(origin))return reply(403,{error:'Origin not allowed'});
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(req.method!=='POST')return reply(405,{error:'Use POST'});
  let scheduled=null,output=null;
  try {
    const raw=await req.text();if(raw.length>1000)return reply(413,{error:'Request too large'});
    const body=JSON.parse(raw);
    const auth=req.headers.get('Authorization')||'';
    if(!auth.startsWith('Bearer '))return reply(401,{error:'Sign in with an Admin account.'});
    let actor;
    if(body.action==='scheduled') {
      if(origin||!/^Bearer e2job_[a-f0-9]{64}$/.test(auth)||!/^[a-f0-9-]{36}$/.test(body.dispatch_id||''))return reply(403,{error:'Invalid scheduled request.'});
      scheduled=checked(await admin.rpc('e2_claim_scheduled_import',{dispatch:body.dispatch_id,token:auth.slice(7)}));
      if(!scheduled)return reply(403,{error:'Scheduled request expired or already used.'});
      actor=scheduled.actor_id;
    }else {
      if(body.action!=='run')return reply(400,{error:'Unknown action'});
      const result=await createClient(url,anon,options).auth.getUser(auth.slice(7));
      actor=result.data?.user?.id;if(result.error||!actor)return reply(401,{error:'Sign in with an Admin account.'});
    }
    const staff=checked(await admin.from('staff_memberships').select('role,active').eq('user_id',actor).maybeSingle());
    if(!staff?.active||!['super_admin','admin'].includes(staff.role)) {
      if(scheduled)throw Error('Scheduled administrator no longer has import permission.');
      return reply(403,{error:'Admin access required.'});
    }
    // Explicit deployment gate: existing photo-folder access must not imply MASTERLIST access.
    if(Deno.env.get('E2_VEHICLE_IMPORT_ENABLED')!=='true') {
      if(scheduled)throw Error('Automatic import is disabled.');
      return reply(503,{error:'Automatic import is not enabled. MASTERLIST read-only access needs approval and a connection test.'});
    }
    output=await runImport({drive,store,root,actor,retry:!scheduled&&body.retry===true,loadWorkbook:async bytes=>{
      const workbook=new ExcelJS.Workbook();
      try{await workbook.xlsx.load(bytes)}catch{throw Error('MASTERLIST could not be read as XLSX. No source cell content was saved.')}
      if(workbook.worksheets.some(s=>s.rowCount>20000||s.columnCount>200))throw Error('MASTERLIST is larger than the supported worksheet limits.');
      return workbook;
    }});
    if(scheduled) {
      checked(await admin.rpc('e2_finish_scheduled_import',{dispatch:scheduled.dispatch_id,result:output}));
      // Keep vehicle details out of the pg_net HTTP response/log; private run receipts contain them.
      return reply(200,{run_id:scheduled.run_id,recorded:true});
    }
    return reply(200,output);
  }catch(error){
    const message=error instanceof Error?error.message:'Import failed. Refresh before retrying.';
    if(scheduled)try{checked(await admin.rpc('e2_finish_scheduled_import',{dispatch:scheduled.dispatch_id,result:{...output,error:message,remaining:0}}))}catch{}
    return reply(400,{error:message});
  }
});
