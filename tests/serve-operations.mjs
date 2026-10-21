// Local-only, disposable preview. Uses real migrations/RLS with synthetic identities.
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {operationsDatabase} from './fixtures/operations-db.mjs';
import {pdfBytes} from './fixtures/preview-fixtures.mjs';
import {notificationPreview} from './fixtures/runner-notifications-preview.mjs';
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
export async function startPreview({port=0,seed=true,showcase=false}={}){
 const {db,ids,as,rpc}=await operationsDatabase(),blobs=new Map();
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
 let queue=Promise.resolve();
 const serial=fn=>{const p=queue.then(fn);queue=p.catch(()=>{});return p;};
 const roles=['admin','runner','runner2','inspector','account','sales','inactive'];
 const adapter=`
 export const configured=true,esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 export const rm=(n,d=0)=>'RM'+Number(n).toLocaleString('en-MY',{minimumFractionDigits:d,maximumFractionDigits:d});
 export const friendlyError=e=>e?.message||'Unable to complete this action';
 export function check(r){if(r.error)throw r.error;return r.data;}
 const role=new URLSearchParams(location.search).get('previewRole')||'runner';
 async function call(path,options={}){try{const r=await fetch('/preview-api/'+path,{...options,headers:{'X-Preview-Role':role,...options.headers}});if(!r.ok)return {error:{message:(await r.json()).error,status:r.status}};return {data:options.binary?await r.blob():await r.json(),error:null};}catch(e){return {error:{message:e.message}};}}
 export const db={auth:{getSession:async()=>({data:{session:{user:{id:'preview',email:role+'@example.test'}}}}),signOut:async()=>({data:{}})},rpc:(name,args)=>({then:(resolve,reject)=>call('rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,args})}).then(resolve,reject)}),storage:{from:bucket=>({upload:(path,file,opts)=>call('file?path='+encodeURIComponent(path),{method:'POST',headers:{'Content-Type':opts.contentType},body:file}),download:path=>call('file?path='+encodeURIComponent(path),{binary:true})})}};
 `;
 const banner=`<aside id="previewBanner" style="background:#f5e8bf;color:#4b390a;padding:12px 20px;font:14px system-ui;display:flex;gap:18px;align-items:center;flex-wrap:wrap"><strong>LOCAL PREVIEW · 测试资料 · 未上线</strong><label style="margin:0">Preview role / 体验身份 <select id="previewRole" style="width:auto;min-height:40px;margin:0"><option value="runner">Runner A</option><option value="runner2">Runner B</option><option value="admin">Admin</option><option value="inspector">Inspector</option><option value="account">Account</option></select></label><small>Disposable local records. No real login, email or payments. / 本机模拟身份，重启后重置。</small></aside><script>const rolePicker=document.getElementById('previewRole');rolePicker.value=new URLSearchParams(location.search).get('previewRole')||'runner';rolePicker.onchange=()=>location.href='/operations.html?previewRole='+rolePicker.value;</script>`;
 const allowed=new Set(['operations.html','operations.js','operations-files.js','operations.css','partner.css','assets/e2-logo.png']);
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
     if(url.pathname==='/preview-api/rpc'&&req.method==='POST'){
      const {name,args}=JSON.parse(bytes);
      if(name==='e2_preview_advance_time'){
       if(role!=='admin')throw Error('Admin preview control only');notifications.advance();return {data:true};
      }
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
   res.writeHead(200,{'Content-Type':path.endsWith('.html')?'text/html; charset=utf-8':path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'image/png'});res.end(content);
  }catch(e){json(e.code==='23505'?409:400,{error:e.message});}
 });
 await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));
 return {url:`http://127.0.0.1:${server.address().port}`,ids,close:async()=>{await new Promise(resolve=>server.close(resolve));await db.close();}};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const preview=await startPreview({port:Number(process.env.PORT||64029),showcase:true});
 console.log(`Runner & bills LOCAL PREVIEW: ${preview.url}/operations.html`);
 console.log('Synthetic records only. Restart resets everything. No production connection.');
 for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await preview.close();process.exit(0);});
}
