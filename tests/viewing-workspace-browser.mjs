import {chromium} from '@playwright/test';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import assert from 'node:assert/strict';
import {localizedPage} from '../scripts/build-languages.mjs';
import {malaysiaDate} from '../booking-core.mjs';
const root=process.cwd(),id='11111111-1111-4111-8111-111111111111';
const mock=`
const id='${id}',actor='22222222-2222-4222-8222-222222222222';
const role=new URLSearchParams(location.search).get('role')||'admin';
const roster=[{user_id:actor,display_name:'Alex',active:true,enabled:true},{user_id:'33333333-3333-4333-8333-333333333333',display_name:'Ben',active:true,enabled:true}];
window.saved=[];
const rows={staff_memberships:{role,active:true},staff_profiles:roster,e2_viewings:[{id,customer_name:'Synthetic customer',phone:'60123456789',vehicle_label:'BMW 218i',preferred_date:'2026-10-22',preferred_time:'10:00:00',locale:'en',salesperson:actor,status:'Requested',staff_note:'',revision:1,created_at:'2026-10-20'}],e2_viewing_notifications:[{viewing_id:id,status:'uncertain',created_at:'2026-10-20'}]};
export const check=r=>{if(r.error)throw r.error;return r.data};
export const db={auth:{getSession:async()=>({data:{session:{user:{id:actor}}}})},from:table=>{const q={select:()=>q,eq:()=>q,single:()=>q,order:()=>q,range:()=>q,then:(a,b)=>Promise.resolve({data:rows[table]}).then(a,b)};return q},rpc:async(name,args)=>{
 window.saved.push({name,args});
 if(name==='e2_update_viewing'){const r=rows.e2_viewings[0];if(r.revision!==args.expected_revision)return {error:Error('Stale')};r.status=args.next_status;r.staff_note=args.note;r.revision++;return {data:null};}
 if(name==='e2_viewing_assignees')return {data:roster};
 if(name==='e2_viewing_rotation_settings')return {data:{roster,notifications_enabled:false}};
 if(name==='e2_set_viewing_rotation')roster.find(r=>r.user_id===args.target).enabled=args.participating;
 if(name==='e2_retry_viewing_notification')rows.e2_viewing_notifications[0].status='pending';
 return {data:null};
}};`;
const server=createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/e2-config.js'){res.setHeader('Content-Type','text/javascript');res.end("window.E2_CONFIG={supabaseUrl:'https://viewing.example.test',publishableKey:'synthetic'}");return;}
  const localized=/^\/(ms|zh)\/booking.html$/.exec(url.pathname);if(localized){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(localizedPage(await readFile(resolve(root,'booking.html'),'utf8'),'booking.html',localized[1]));return;}
  if(url.pathname==='/e2-data.js'){res.setHeader('Content-Type','text/javascript');res.end(mock);return}
  const path=resolve(root,'.'+decodeURIComponent(url.pathname));
  if(!path.startsWith(root+sep)){res.writeHead(403).end();return}
  try{const bytes=await readFile(path);res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.png':'image/png'})[extname(path)]||'application/octet-stream');res.end(bytes)}catch{res.writeHead(404).end()}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser;
try{
  browser=await chromium.launch(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:process.platform==='win32'?{channel:'msedge'}:{});
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  const base='http://127.0.0.1:'+server.address().port;
  await page.goto(base+'/bookings.html');
  await page.locator('#workspace').waitFor({state:'visible'});
  await page.locator('#rotationPanel summary').click();
  assert.match(await page.locator('#rotationMessage').textContent(),/Next ordinary website request: Alex/);
  await page.getByRole('button',{name:'Pause ordinary bookings for Alex',exact:true}).click();
  await page.getByRole('button',{name:'Resume ordinary bookings for Alex',exact:true}).waitFor();
  assert.match(await page.locator('#rotationMessage').textContent(),/Next ordinary website request: Ben/);
  await page.getByRole('button',{name:'Resume ordinary bookings for Alex',exact:true}).click();
  await page.getByRole('button',{name:'Pause ordinary bookings for Alex',exact:true}).waitFor();
  page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Retry notification',exact:true}).click();
  await page.getByText('Telegram: Queued',{exact:true}).waitFor();
  if(process.env.VIEWING_SCREENSHOTS)await page.screenshot({path:resolve(process.env.VIEWING_SCREENSHOTS,'viewing-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No horizontal overflow on mobile');
  if(process.env.VIEWING_SCREENSHOTS)await page.screenshot({path:resolve(process.env.VIEWING_SCREENSHOTS,'viewing-mobile.png'),fullPage:true});
  await page.goto(base+'/bookings.html?viewing='+id);await page.locator('#bookingEditor').waitFor({state:'visible'});
  assert.match(await page.locator('#customerDetails').textContent(),/Synthetic customer/);
  await page.locator('#closeEditor').click();
  await page.goto(base+'/bookings.html?role=sales');await page.locator('#workspace').waitFor({state:'visible'});
  assert.equal(await page.locator('#rotationPanel').isVisible(),false);
  assert.equal(await page.getByRole('button',{name:'Retry notification'}).count(),0);
  await page.getByRole('button',{name:'Manage',exact:true}).click();assert.equal(await page.locator('#editSales').isDisabled(),true);
  await page.locator('#closeEditor').click();await page.locator('#statusFilter').selectOption('all');
  for(const state of ['Cancelled','Requested','Completed','Cancelled']){
   await page.getByRole('button',{name:'Manage',exact:true}).click();
   assert.deepEqual(await page.locator('#editStatus option').allTextContents(),['Requested','Confirmed','Completed','Cancelled']);
   await page.locator('#editStatus').selectOption(state);await page.locator('#staffNote').fill('Synthetic status correction');await page.locator('#saveBooking').click();await page.locator('#bookingEditor').waitFor({state:'hidden'});await page.locator('.viewingStatus').filter({hasText:state}).waitFor();
  }
  await page.getByRole('button',{name:'Manage',exact:true}).click();await page.locator('#editStatus').selectOption('Confirmed');assert.equal(await page.locator('#confirmedContact').isChecked(),false);await page.locator('#closeEditor').click();
  await page.goto(base+'/bookings.html?viewing=unavailable');await page.getByText('This viewing request is unavailable or assigned to another salesperson.').waitFor();
  assert.equal(await page.locator('#bookingEditor').isVisible(),false);
  let submissions=0;
  await page.route('https://viewing.example.test/**',async route=>{const request=route.request();if(request.url().includes('/rpc/e2_submit_viewing')){submissions++;const body=request.postDataJSON();return route.fulfill({contentType:'application/json',body:JSON.stringify({id:body.request_id,status:'Requested',preferred_date:body.view_date,preferred_time:body.view_time})});}return route.fulfill({contentType:'application/json',body:'[]'});});
  for(const lang of ['en','ms','zh']){
   await page.goto(base+(lang==='en'?'':'/'+lang)+'/booking.html');await page.evaluate(()=>sessionStorage.clear());await page.reload();await page.locator('#submitViewing:not([disabled])').waitFor();
   await page.locator('[name=customer_name]').fill('Synthetic visitor');await page.locator('[name=customer_phone]').fill('0123456789');await page.locator('#viewDate').fill(malaysiaDate(new Date(Date.now()+86400000)));await page.locator('#viewTime').selectOption('10:00');await page.locator('#contactConsent').check();await page.locator('#submitViewing').click();await page.locator('#receipt').waitFor({state:'visible'});
   const href=new URL(await page.locator('#receiptWhatsApp').getAttribute('href'));assert.equal(href.pathname,'/60122785126');assert.equal(href.hostname,'wa.me');assert(href.searchParams.get('text').includes(await page.locator('#receiptRef').innerText()));assert(!href.searchParams.get('text').includes('60123456789'));
   const count=submissions;await page.reload();await page.locator('#receipt').waitFor({state:'visible'});assert.equal(submissions,count);assert.equal(await page.locator('#receiptWhatsApp').getAttribute('href'),href.href);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   if(process.env.VIEWING_SCREENSHOTS)await page.screenshot({path:resolve(process.env.VIEWING_SCREENSHOTS,'customer-whatsapp-'+lang+'.png'),fullPage:true});
  }
  assert.deepEqual(errors,[]);
  console.log('Viewing workspace browser checks passed: desktop, mobile, roster controls, notification retry, deep links and Sales visibility.');
}finally{await browser?.close();await new Promise(r=>server.close(r))}
