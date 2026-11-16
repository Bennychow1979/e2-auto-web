// Synthetic records only. All API requests are intercepted; no customer data.
import {chromium,expect} from '@playwright/test';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import assert from 'node:assert/strict';
import {sections} from '../intake-fields.js';
const root=resolve('.'),id='2700f7df-7787-4a18-b1bb-eaba47882537';
const details={guarantor:'Not requested',deposit:'5000'};
for(const [key,,sub,type,required] of sections(details).flat())if(required)details[key]=Array.isArray(type)?type[0]:type==='email'?'test@example.test':type==='tel'?'60123456789':type==='year'?'2020':type==='number'?'2':'Synthetic information';
details.guarantor='Not requested';
const server=createServer(async(req,res)=>{
 const path=new URL(req.url,'http://localhost').pathname;
 if(path==='/e2-config.js'){res.setHeader('Content-Type','text/javascript');res.end('window.E2_CONFIG={supabaseUrl:location.origin,publishableKey:"synthetic"};');return;}
 const file=resolve(root,'.'+path);if(!file.startsWith(root)||!['.js','.mjs','.css','.html','.png'].includes(extname(file))){res.writeHead(404);res.end();return;}
 try{res.setHeader('Content-Type',extname(file)==='.html'?'text/html':extname(file)==='.css'?'text/css':extname(file)==='.png'?'image/png':'text/javascript');res.end(await readFile(file));}catch{res.writeHead(404);res.end();}
});await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
let browser;
try{
 browser=await chromium.launch(process.platform==='win32'?{channel:'msedge'}:{});
 for(const width of [1440,390])for(const lang of ['en','ms','zh']){
  const context=await browser.newContext({viewport:{width,height:960}}),page=await context.newPage();const calls=[],errors=[];let failed=false;
  page.on('pageerror',e=>errors.push(e.message));
  await context.route('**/*',async route=>{
   const url=new URL(route.request().url());if(url.origin!==origin)throw Error('Unexpected external request: '+url.origin);
   if(!url.pathname.endsWith('/e2-guest-intake'))return route.continue();
   if(failed)return route.fulfill({status:400,json:{error:'This invitation is unavailable. Ask your salesperson for a new link.'}});
   if(route.request().headers()['content-type']?.startsWith('multipart/')){calls.push({action:'upload'});return route.fulfill({json:{uploaded:true}});}
   const b=route.request().postDataJSON();calls.push(b);
   if(b.action==='context'&&b.source!=='aira'&&b.invite!==id)return route.fulfill({status:400,json:{error:'Open a valid invitation.'}});
   const response=b.action==='context'?{invite:id,source:'aira',vehicle:{id:null,name:'Not decided yet',price:null},contact:{name:'Synthetic E2',whatsapp:null},expires_at:'infinity'}:b.action==='begin'?{id,received:false}:{reference:id,received:true};
   return route.fulfill({json:response});
  });
  await page.goto(origin+'/intake.html?source=aira&lang='+lang);await expect(page.locator('#kind')).toBeVisible();assert.equal(calls[0].source,'aira');
  for(const target of ['ms','zh','en',lang]){
   await page.locator(`[data-customer-language="${target}"]`).click();
   await page.waitForURL(url=>url.searchParams.get('lang')===target);
   assert.equal(new URL(page.url()).searchParams.get('source'),'aira');
   await expect(page.locator('#kind')).toBeVisible();assert.equal(calls.at(-1).source,'aira');
  }
  await page.goto(origin+'/intake.html?invite='+id+'&lang='+lang);
  for(const target of ['ms','zh','en']){
   await page.locator(`[data-customer-language="${target}"]`).click();
   await page.waitForURL(url=>url.searchParams.get('lang')===target);
   assert.equal(new URL(page.url()).searchParams.get('invite'),id);await expect(page.locator('#kind')).toBeVisible();
  }
  await page.goto(origin+'/intake.html?source=aira&lang='+lang);await expect(page.locator('#kind')).toBeVisible();
  await page.locator('#kind').selectOption('worker');
  for(let step=0;step<6;step++){
   await page.locator('#intakeForm').evaluate((form,data)=>{for(const el of form.elements)if(el.name&&Object.hasOwn(data,el.name))el.value=data[el.name];},details);
   await page.locator('#intakeForm button[type="submit"]').click();
  }
  await expect(page.locator('#guestFiles')).toBeVisible();
  await page.locator('#guestFiles').setInputFiles({name:'synthetic.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4 synthetic')});
  await page.locator('#addGuestFiles').click();await expect(page.locator('.intakeFileList')).toContainText('synthetic.pdf');
  await page.locator('#guestConsent').check();await page.locator('#guestAccurate').check();await page.locator('#guestContacts').check();
  await page.locator('#intakeForm button[type="submit"]').click();await expect(page.locator('.intakeReference')).toContainText(id);
  assert.equal(calls.find(x=>x.action==='begin').invite,id);assert.equal(calls.filter(x=>x.action==='upload').length,1);assert.equal(calls.find(x=>x.action==='submit').consent,true);
  failed=true;await page.goto(origin+'/intake.html?invite='+id+'&lang='+lang);
  await expect(page.locator('#intakeMain a[href="https://wa.me/60122785126"]')).toBeVisible();
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);
  await context.close();
 }
 console.log('PASS AIRA desktop/mobile EN/BM/ZH full synthetic submission, upload and expired invitation WhatsApp fallback');
}finally{await browser?.close();await new Promise(r=>server.close(r));}
