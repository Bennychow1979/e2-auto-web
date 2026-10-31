// Local-only, disposable preview. Uses real migrations/RLS with synthetic identities.
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {operationsDatabase} from './fixtures/operations-db.mjs';
import {pdfBytes} from './fixtures/preview-fixtures.mjs';
import {notificationPreview} from './fixtures/runner-notifications-preview.mjs';
import {benefitFields} from '../vehicle-benefits.mjs';
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
export async function startPreview({port=0,seed=true,showcase=false,lifecycle=false}={}){
 const {db,ids,as,rpc}=await operationsDatabase(),blobs=new Map();
 await db.exec(await readFile(resolve(root,'supabase/migrations/202610220004_runner_whatsapp.sql'),'utf8'));
 await as('admin');
 // Synthetic number only; the UI never creates a wa.me link in this preview.
 await db.query('select public.e2_verify_runner_whatsapp($1,$2)',[ids.runner,'60100000000']);
 await db.exec('reset role');
 await db.exec(await readFile(resolve(root,'supabase/migrations/202610190001_vehicle_benefits.sql'),'utf8'));
 await db.exec(await readFile(resolve(root,'supabase/migrations/202610210004_plate_drafts.sql'),'utf8'));
 await db.exec(await readFile(resolve(root,'supabase/migrations/202611010001_custom_fuel_types.sql'),'utf8'));
 if(lifecycle){
  for(const f of ['202609180001_drive_photos','202609210001_vehicle_import','202609210003_plate_only_import','202610010001_vehicle_translation','202610210005_enrich_plate_drafts','202610220001_vehicle_recycle','202610220002_inspection_statuses','202610220003_account_dispatch'])await db.exec(await readFile(resolve(root,'supabase/migrations/'+f+'.sql'),'utf8'));
 }
 const notifications=notificationPreview({runnerRoles:{[ids.runner]:'runner',[ids.runner2]:'runner2'}});
 if(seed){
  await as('admin');
  for(const [car,runner,kind] of [['car','runner','puspakom'],['car2','runner2','carsome_pickup']])await rpc('e2_save_runner_job',{request_id:randomUUID(),expected_revision:null,details:{vehicle_id:ids[car],assigned_to:ids[runner],kind,origin:kind==='puspakom'?'DEMO E2 Showroom':'DEMO Carsome',destination:kind==='puspakom'?'DEMO PUSPAKOM':'DEMO E2 Showroom',appointment_at:'2026-10-22T01:00:00Z',instructions:'LOCAL PREVIEW ONLY / 本机测试资料。Upload the appointment and job sheet before departure.'}});
 }
 if(showcase){
  const archive=async(parent,kind,name)=>{
   const f=await rpc('e2_reserve_ops_file',{request_id:randomUUID(),...parent,file_kind:kind,file_name:name,file_mime:'application/pdf',file_bytes:pdfBytes.length});
   await db.query("insert into storage.objects(bucket_id,name,metadata) values('operations-files',$1,$2)",[f.path,{size:pdfBytes.length,mimetype:'application/pdf'}]);blobs.set(f.path,{bytes:pdfBytes,mime:'application/pdf'});
   await rpc('e2_finish_ops_file',{file_id:f.id});
  };
  await as('runner');const job=(await rpc('e2_operations_workspace')).jobs[0];
  await archive({job_id:job.id},'appointment','DEMO-appointment-colour-pages.pdf');
  await archive({job_id:job.id},'job_sheet','DEMO-job-sheet-colour-pages.pdf');
  const date=new Date().toISOString().slice(0,10);
  let petrol=await rpc('e2_save_ops_claim',{request_id:randomUUID(),details:{kind:'petrol',job_id:job.id,supplier:'DEMO Petrol station',invoice_no:'DEMO-P001',expense_date:date,amount:50,description:'Synthetic example only / 测试油费，不是实际费用'}});
  await archive({claim_id:petrol.id},'receipt','DEMO-receipt-colour-pages.pdf');
  petrol=await rpc('e2_action_ops_claim',{target:petrol.id,expected_revision:petrol.revision,action:'submit'});
  await as('admin');await rpc('e2_action_ops_claim',{target:petrol.id,expected_revision:petrol.revision,action:'approve',note:'DEMO approval only / 测试批准'});
  await as('inspector');
  let repair=await rpc('e2_save_ops_claim',{request_id:randomUUID(),details:{kind:'repair',inspection_id:ids.inspection,supplier:'DEMO Workshop',invoice_no:'DEMO-W001',expense_date:date,amount:320,description:'Synthetic repair example / 测试维修账单，不是实际费用'}});
  await archive({claim_id:repair.id},'invoice','DEMO-invoice-colour-pages.pdf');
  await rpc('e2_action_ops_claim',{target:repair.id,expected_revision:repair.revision,action:'submit'});
 }
 await as('admin');notifications.sync((await rpc('e2_operations_workspace')).jobs);
 const scalarCall=async(name,keys,args={},defaults={})=>Object.values((await db.query('select to_jsonb(public.'+name+'('+keys.map((k,i)=>'$'+(i+1)).join(',')+'))',keys.map(k=>args[k]??defaults[k]??null))).rows[0])[0];
 let queue=Promise.resolve();
 const serial=fn=>{const p=queue.then(fn);queue=p.catch(()=>{});return p;};
 const roles=['admin','runner','runner2','inspector','account','sales','inactive','anonymous'];
 const adapter=`
 export const configured=true,esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 export const rm=(n,d=0)=>'RM'+Number(n).toLocaleString('en-MY',{minimumFractionDigits:d,maximumFractionDigits:d});
 export const friendlyError=e=>e?.message||'Unable to complete this action';
 export function check(r){if(r.error)throw r.error;return r.data;}
 export const mileageText=car=>car.mileage==null?'Pending confirmation':car.mileage+' km';
 export const photoURLs=async()=>[],retryPhotos=()=>{},compressPhoto=async()=>{throw Error('Photos are not part of this preview');},drivePhotoRequest=async()=>{throw Error('Drive is not connected in this preview');};
 export const getVehicles=async({includeInactive=false}={})=>check(await call('vehicles')).filter(v=>includeInactive||!v.lifecycle_state||v.lifecycle_state==='active').map(v=>({...v,photos:[]}));
 const role=new URLSearchParams(location.search).get('previewRole')||'runner';
 async function call(path,options={}){try{const r=await fetch('/preview-api/'+path,{...options,headers:{'X-Preview-Role':role,...options.headers}});if(!r.ok)return {error:{message:(await r.json()).error,status:r.status}};return {data:options.binary?await r.blob():await r.json(),error:null};}catch(e){return {error:{message:e.message}};}}
 export const db={auth:{getSession:async()=>({data:{session:{user:{id:'preview',email:role+'@example.test'}}}}),signOut:async()=>({data:{}})},rpc:(name,args)=>({then:(resolve,reject)=>call('rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,args})}).then(resolve,reject)}),storage:{from:bucket=>({remove:paths=>call('remove-storage',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({bucket,paths})}),upload:(path,file,opts)=>call('file?path='+encodeURIComponent(path),{method:'POST',headers:{'Content-Type':opts.contentType},body:file}),download:path=>call('file?path='+encodeURIComponent(path),{binary:true})})}};
 db.auth.onAuthStateChange=callback=>queueMicrotask(()=>callback('INITIAL_SESSION',{user:{id:'preview',email:role+'@example.test'}}));
 db.from=table=>{
  let value,mode='select',filters={};const query={
   select:()=>query,eq:(key,v)=>{filters[key]=v;return query;},order:()=>query,limit:()=>query,
   insert:row=>{value=row;mode='insert';return query;},
   update:row=>{value=row;mode='update';return query;},
   maybeSingle:()=>query,
   then:(resolve,reject)=>call('table',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({table,mode,value,filters})}).then(resolve,reject)
  };return query;
 };
 `;
 const banner=`<aside id="previewBanner" style="background:#f5e8bf;color:#4b390a;padding:12px 20px;font:14px system-ui;display:flex;gap:18px;align-items:center;flex-wrap:wrap"><strong>LOCAL PREVIEW · 测试资料 · 未上线</strong><label style="margin:0">Preview role / 体验身份 <select id="previewRole" style="width:auto;min-height:40px;margin:0"><option value="runner">Runner A</option><option value="runner2">Runner B</option><option value="admin">Admin</option><option value="inspector">Inspector</option><option value="account">Account</option></select></label><small>Disposable local records. No real login, email or payments. / 本机模拟身份，重启后重置。</small></aside><script>const rolePicker=document.getElementById('previewRole');rolePicker.value=new URLSearchParams(location.search).get('previewRole')||'runner';rolePicker.onchange=()=>location.href='/operations.html?previewRole='+rolePicker.value;</script>`;
 const allowed=new Set(['operations.html','operations.js','operations-files.js','runner-message.mjs','profile-utils.js','operations.css','partner.css','assets/e2-logo.png']);
 for(const file of ['portal.html','portal.js','portal-demo.css','production.css','team.css','drive-photos.css','vehicle-translation.css','vehicle-benefits.css','vehicle-lifecycle.mjs','vehicle-lifecycle.css','inspections.html','inspections.js','inspections.css','inspection-photos.js','vehicle-import.mjs','vehicle-translation-ui.mjs','photo-sort.js','drive-photo-picker.mjs','year-spec-select.mjs','model-year-reference.mjs','vehicle-benefits-editor.mjs','vehicle-benefits.mjs','verified-model-years.json','i18n.mjs','translations.mjs','vehicle-routes.mjs','booking-translations.mjs','sales-team-translations.mjs'])allowed.add(file);
 const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1');
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
  const json=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
  try{
   if(url.pathname.startsWith('/preview-api/')){
    const role=req.headers['x-preview-role'];if(!roles.includes(role))return json(403,{error:'Unknown preview identity'});
    if(req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`)return json(403,{error:'Local preview origin only'});
    const chunks=[];let length=0;for await(const chunk of req){length+=chunk.length;if(length>11*1024*1024)throw Error('File too large');chunks.push(chunk);}const bytes=Buffer.concat(chunks);
    const result=await serial(async()=>{
     await as(role);
     if(url.pathname==='/preview-api/vehicles'&&req.method==='GET')return {data:(await db.query('select * from public.vehicles order by created_at desc')).rows};
     if(url.pathname==='/preview-api/remove-storage'&&req.method==='POST'){const {bucket,paths}=JSON.parse(bytes);return {data:(await db.query('delete from storage.objects where bucket_id=$1 and name=any($2) returning name',[bucket,paths])).rows};}
     if(url.pathname==='/preview-api/table'&&req.method==='POST'){
      const {table,mode,value,filters={}}=JSON.parse(bytes);
      if(lifecycle&&['e2_inspection_photos','e2_vehicle_inspection_events'].includes(table)&&mode==='select')return {data:(await db.query('select * from public.'+table+' where inspection_id=$1 order by created_at desc',[filters.inspection_id])).rows};
      if(table==='staff_memberships'&&mode==='select')return {data:(await db.query('select role,active from staff_memberships where user_id=auth.uid()')).rows[0]||null};
      if(table==='vehicles'&&['insert','update'].includes(mode)){
       const allowedFields=new Set(['id','plate','brand','model','variant','year','engine_litres','transmission','fuel_type','mileage','mileage_confirmed','price','body_type','stock_status','description','publication','import_pending',...benefitFields]);
       const keys=Object.keys(value);if((mode==='insert'&&value.publication!=='draft')||keys.some(k=>!allowedFields.has(k)))throw Error('Only draft vehicle creation is supported');
       if(mode==='update'){
        if(!filters.id||!filters.updated_at)throw Error('Preview updates require a vehicle and revision');
        return {data:(await db.query('update public.vehicles set '+keys.map((k,i)=>'"'+k+'"=$'+(i+1)).join(',')+' where id=$'+(keys.length+1)+' and updated_at=$'+(keys.length+2)+' returning *',[...keys.map(k=>value[k]),filters.id,filters.updated_at])).rows[0]||null};
       }
       const columns=keys.map(k=>'"'+k+'"').join(',');
       return {data:(await db.query(`insert into public.vehicles (${columns}) values (${keys.map((k,i)=>'$'+(i+1)).join(',')}) returning *`,keys.map(k=>value[k]))).rows[0]};
      }
      throw Error('Unsupported preview table operation');
     }
     if(url.pathname==='/preview-api/rpc'&&req.method==='POST'){
      const {name,args}=JSON.parse(bytes);
      if(['e2_prepare_runner_whatsapp','e2_verify_job_runner_whatsapp'].includes(name)){
       const prepared=await scalarCall(name,name==='e2_prepare_runner_whatsapp'?['target','expected_revision']:['target','expected_revision','phone','confirmed','expected_verified_at'],args);
       return {data:{...prepared,mode:'simulation',preview_job_url:`/operations.html?previewRole=${prepared.job.assigned_to===ids.runner?'runner':'runner2'}&job=${encodeURIComponent(prepared.job.id)}`}};
      }
      if(name==='e2_preview_advance_time'){
       if(role!=='admin')throw Error('Admin preview control only');notifications.advance();return {data:true};
      }
      if(lifecycle&&name==='e2_vehicle_lifecycle')return {data:await scalarCall(name,['target','operation','expected_revision','note','confirm_plate'],args,{note:'',confirm_plate:''})};
      if(lifecycle&&['e2_inspection_workspace','e2_inspection_workshops'].includes(name))return {data:await scalarCall(name,[],{})};
      if(lifecycle&&name==='e2_start_inspection')return {data:await scalarCall(name,['request_id','car','assignee'],args)};
      if(lifecycle&&name==='e2_save_inspection')return {data:await scalarCall(name,['target','expected_revision','changes'],args)};
      const result=await rpc(name,args);
      const workspace=name==='e2_operations_workspace'?result:await rpc('e2_operations_workspace');
      notifications.sync(workspace.jobs);
      if(name==='e2_operations_workspace')result.notification_preview=notifications.view(workspace.role,workspace.user_id);
      return {data:result};
     }
     if(url.pathname==='/preview-api/file'){
      const path=url.searchParams.get('path');
      if(req.method==='POST'){
       // INSERT goes through the same RLS policy as Supabase Storage.
       await db.query("insert into storage.objects(bucket_id,name,metadata) values('operations-files',$1,$2)",[path,{size:bytes.length,mimetype:req.headers['content-type']}]);
       blobs.set(path,{bytes,mime:req.headers['content-type']});return {data:{path}};
      }
      if(req.method==='GET'){
       const rows=await db.query("select id from storage.objects where bucket_id='operations-files' and name=$1",[path]);
       if(!rows.rows.length||!blobs.has(path))throw Error('Private file unavailable');
       return {file:blobs.get(path)};
      }
     }
     throw Error('Unsupported preview endpoint');
    });
    if(result.file){res.writeHead(200,{'Content-Type':result.file.mime});res.end(result.file.bytes);}else json(200,result.data);
    return;
   }
   let path=url.pathname.slice(1)||'operations.html';
   if(path==='e2-data.js'){res.writeHead(200,{'Content-Type':'text/javascript'});res.end(adapter);return;}
   if(path==='e2-config.js'){res.writeHead(200,{'Content-Type':'text/javascript'});res.end('window.E2_CONFIG={};');return;}
   if(!allowed.has(path)){res.writeHead(404);res.end('This preview serves Jobs & Bills only. Return to /operations.html');return;}
   let content=await readFile(resolve(root,path));
   if(path==='operations.html')content=content.toString().replace('<body>','<body>'+banner);
   res.writeHead(200,{'Content-Type':path.endsWith('.html')?'text/html; charset=utf-8':/\.m?js$/.test(path)?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.json')?'application/json':'image/png'});res.end(content);
  }catch(e){json(e.code==='23505'?409:400,{error:e.message});}
 });
 await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));
 return {url:`http://127.0.0.1:${server.address().port}`,ids,close:async()=>{await new Promise(resolve=>server.close(resolve));await db.close();}};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const preview=await startPreview({port:Number(process.env.PORT||64029),showcase:true,lifecycle:process.env.LIFECYCLE==='1'});
 console.log(`Runner & bills LOCAL PREVIEW: ${preview.url}/operations.html`);
 console.log('Synthetic records only. Restart resets everything. No production connection.');
 for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await preview.close();process.exit(0);});
}
