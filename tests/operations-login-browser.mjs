import {chromium,expect} from '@playwright/test';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import assert from 'node:assert/strict';
const browser=await chromium.launch(process.platform==='win32'?{channel:'msedge'}:{});
try{
 for(const role of ['runner','account','inspector','office_admin','sales','admin','super_admin']){
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
   assert.equal(await page.locator('#manageOperations').isVisible(),['admin','super_admin'].includes(role));
   if(role==='super_admin'){
    const sidebar=page.locator('.sidebar'),users=page.locator('#manageUsers'),signOut=page.locator('#signOut');
    for(const viewport of [{width:1366,height:600},{width:1024,height:480},{width:800,height:360}]){
     await page.setViewportSize(viewport);
     await sidebar.evaluate(el=>{el.scrollTop=0;});
     await sidebar.hover({position:{x:80,y:100}});
     await page.mouse.wheel(0,2000);
     await expect.poll(()=>sidebar.evaluate(el=>el.scrollTop)).toBeGreaterThan(0);
     await expect(users).toBeInViewport();
     await expect(signOut).toBeInViewport();
     assert.equal(await page.evaluate(()=>window.scrollY),0,'scrolling the sidebar leaves the page in place');
     // Keyboard navigation must reveal links below the initial viewport as well.
     await sidebar.locator('nav button').focus();
     for(let i=0;i<20&&!await users.evaluate(el=>el===document.activeElement);i++)await page.keyboard.press('Tab');
     await expect(users).toBeFocused();
     await expect(users).toBeInViewport();
     await page.keyboard.press('Tab');await page.keyboard.press('Tab');
     await expect(signOut).toBeFocused();
     await expect(signOut).toBeInViewport();
    }
    if(process.env.SIDEBAR_ARTIFACT_DIR){
     await mkdir(process.env.SIDEBAR_ARTIFACT_DIR,{recursive:true});
     await page.screenshot({path:resolve(process.env.SIDEBAR_ARTIFACT_DIR,'sidebar-desktop.png')});
    }
    await page.setViewportSize({width:390,height:844});
    assert.equal(await sidebar.evaluate(el=>getComputedStyle(el).position),'static','mobile keeps its existing layout');
    await users.focus();
    await expect(users).toBeInViewport();
    await signOut.focus();
    await expect(signOut).toBeInViewport();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'no mobile page overflow');
    if(process.env.SIDEBAR_ARTIFACT_DIR)await page.screenshot({path:resolve(process.env.SIDEBAR_ARTIFACT_DIR,'sidebar-mobile.png')});
   }
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
 console.log('8 login integration checks passed, including Super Admin wheel/keyboard sidebar access at three desktop sizes and mobile layout. No real login or email used.');
}finally{await browser.close();}
