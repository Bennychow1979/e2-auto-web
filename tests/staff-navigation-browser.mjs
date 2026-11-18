import {chromium,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import assert from 'node:assert/strict';
const browser=await chromium.launch(process.platform==='win32'?{channel:'msedge'}:{});
try{
 for(const mode of ['inventory','dashboard','signed-out','recovery','permission-error']){
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{
   const u=new URL(route.request().url()),path=u.pathname.slice(1);if(u.origin!=='http://preview.test')return route.abort();
   if(path==='dashboard.html')return route.fulfill({contentType:'text/html',body:'<h1>Dashboard destination</h1>'});
   if(path==='e2-config.js')return route.fulfill({contentType:'text/javascript',body:'window.E2_CONFIG={managementDashboard:true};'});
   if(path==='e2-data.js')return route.fulfill({contentType:'text/javascript',body:`
    export const configured=true,esc=v=>String(v??''),rm=v=>'RM'+v,mileageText=()=>'',friendlyError=e=>e.message;
    export const check=r=>{if(r.error)throw r.error;return r.data;},getVehicles=async()=>[],photoURLs=async()=>[],retryPhotos=async()=>[],compressPhoto=async()=>{},drivePhotoRequest=async()=>({});
    const response=t=>t==='staff_memberships'?${mode==='permission-error'?"{error:{message:'Connection interrupted'}}":"{data:{role:'super_admin',active:true}}"}:{data:[]};
    const query=t=>new Proxy({}, {get:(o,k)=>k==='then'?((yes,no)=>new Promise(r=>setTimeout(()=>r(response(t)),150)).then(yes,no)):()=>query(t)});
    const callbacks=[];window.emitAuth=(event,session)=>callbacks.forEach(cb=>cb(event,session));
    export const db={from:query,rpc:async()=>({data:false}),auth:{onAuthStateChange:cb=>callbacks.push(cb),signOut:async()=>{window.emitAuth('SIGNED_OUT',null);return {data:{}}}}};
   `});
   if(!/^[\w.-]+\.(html|js|mjs|css|json)$/.test(path)&&path!=='assets/e2-logo.png')return route.abort();
   try{await route.fulfill({contentType:({'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png'})[extname(path)],body:await readFile(resolve(path))});}catch{await route.fulfill({status:404,body:''})}
  });
  await page.goto('http://preview.test/portal.html'+(mode==='inventory'?'?view=inventory':''));
  await expect(page.locator('#sessionLoading')).toBeVisible();await expect(page.locator('#entry')).toBeHidden();await expect(page.locator('#workspace')).toBeHidden();
  await page.evaluate(()=>{window.loginFlashed=false;const watch=()=>{const e=document.getElementById('entry');if(e&&!e.hidden&&getComputedStyle(e).display!=='none')window.loginFlashed=true;requestAnimationFrame(watch)};requestAnimationFrame(watch)});
  await page.evaluate(mode=>window.emitAuth(mode==='recovery'?'PASSWORD_RECOVERY':'INITIAL_SESSION',mode==='signed-out'?null:{user:{id:'test-user',email:'test@example.test'}}),mode);
  if(mode==='dashboard')await page.waitForURL('**/dashboard.html');
  else if(mode==='inventory'){await expect(page.locator('#workspace')).toBeVisible();await expect(page.locator('#entry')).toBeHidden();assert.equal(await page.evaluate(()=>window.loginFlashed),false);await page.locator('#signOut').click();await expect(page.locator('#entry')).toBeVisible();await expect(page.locator('#workspace')).toBeHidden();}
  else if(mode==='permission-error'){await expect(page.locator('#sessionLoadingError')).toHaveText('Connection interrupted');await expect(page.locator('#retrySession')).toBeVisible();await expect(page.locator('#entry')).toBeHidden();}
  else {await expect(page.locator('#entry')).toBeVisible();await expect(page.locator('#sessionLoading')).toBeHidden();if(mode==='recovery')await expect(page.locator('#passwordForm')).toBeVisible();}
  assert.deepEqual(errors,[],mode);await page.close();
 }
 console.log('Staff navigation passed: pending auth never paints Login, direct inventory, Dashboard redirect, signed-out login, recovery and retryable permission errors.');
}finally{await browser.close()}
