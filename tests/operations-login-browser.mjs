import {chromium,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import assert from 'node:assert/strict';
const browser=await chromium.launch(process.platform==='win32'?{channel:'msedge'}:{});
try{
 for(const role of ['runner','account','inspector','office_admin','sales','admin']){
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url()),path=url.pathname.slice(1);
   if(url.origin!=='http://preview.test')return route.abort();
   if(['operations.html','inspections.html','intake-workspace.html'].includes(path))return route.fulfill({contentType:'text/html',body:'<h1>Redirect destination</h1>'});
   if(path==='e2-config.js')return route.fulfill({contentType:'text/javascript',body:'window.E2_CONFIG={};'});
   if(path==='e2-data.js')return route.fulfill({contentType:'text/javascript',body:`
    export const configured=true,esc=v=>String(v??''),rm=v=>'RM'+v,mileageText=()=>'',friendlyError=e=>e.message;
    export const check=r=>{if(r.error)throw r.error;return r.data;},getVehicles=async()=>[],photoURLs=async()=>[],retryPhotos=async()=>[],compressPhoto=async()=>{},drivePhotoRequest=async()=>({});
    const response=table=>({data:table==='staff_memberships'?{role:'${role}',active:true}:[]});
    const query=table=>new Proxy({}, {get:(obj,key)=>key==='then'?((resolve,reject)=>Promise.resolve(response(table)).then(resolve,reject)):()=>query(table)});
    export const db={from:query,auth:{onAuthStateChange:callback=>queueMicrotask(()=>callback('INITIAL_SESSION',{user:{id:'test-user',email:'test@example.test'}})),signOut:async()=>({data:{}})}};
   `});
   if(!/^[a-zA-Z0-9_.-]+\.(html|js|mjs|css|json)$/.test(path)&&path!=='assets/e2-logo.png')return route.abort();
   try{await route.fulfill({contentType:({'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png'})[extname(path)],body:await readFile(resolve(path))});}catch{await route.fulfill({status:404,body:''});}
  });
  await page.goto('http://preview.test/portal.html');
  if(['runner','account','inspector','office_admin'].includes(role)){
   const destination={runner:'operations.html',account:'operations.html',inspector:'inspections.html',office_admin:'intake-workspace.html'}[role];
   await page.waitForURL('**/'+destination);
  }else{
   await page.locator('#workspace').waitFor({state:'visible'});
   assert.equal(await page.locator('#manageOperations').isVisible(),role==='admin');
  }
  assert.deepEqual(errors,[],role+' login has no JavaScript errors');await page.close();
 }
 // Exercise the real shared client configuration on the new staff route.
 const page=await browser.newPage();
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url()),path=url.pathname.slice(1);
  if(url.hostname==='cdn.jsdelivr.net')return route.fulfill({contentType:'text/javascript',body:`export const createClient=(url,key,options)=>{window.testAuthOptions=options.auth;return {auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange:()=>{}}};};`});
  if(url.origin!=='http://preview.test')return route.abort();
  if(path==='e2-config.js')return route.fulfill({contentType:'text/javascript',body:`window.E2_CONFIG={supabaseUrl:'https://preview.supabase.co',publishableKey:'sb_publishable_preview'};`});
  if(!/^[a-zA-Z0-9_.-]+\.(html|js|mjs|css|json)$/.test(path)&&path!=='assets/e2-logo.png')return route.abort();
  try{await route.fulfill({contentType:({'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png'})[extname(path)],body:await readFile(resolve(path))});}catch{await route.fulfill({status:404,body:''});}
 });
 await page.goto('http://preview.test/operations.html');await expect(page.locator('#message')).toContainText('Sign in with your staff account');
 assert.equal(await page.evaluate(()=>window.testAuthOptions.persistSession),true);
 assert.equal(await page.evaluate(()=>window.testAuthOptions.storageKey),'e2-staff-auth');
 console.log('7 login integration checks passed: role routing, existing roles, Admin navigation and persistent staff session. No real login or email used.');
}finally{await browser.close();}
