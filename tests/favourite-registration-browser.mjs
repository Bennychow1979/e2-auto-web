import {chromium,webkit,expect} from '@playwright/test';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import assert from 'node:assert/strict';

// Real page modules, synthetic auth/mail transport. No real email or account.
const origin='http://favourite.test',carId='11111111-1111-4111-8111-111111111111';
const car={id:carId,brand:'Honda',model:'CITY',plate:'DEMO123',year:2020,price:39990,stock_status:'Available'};
const engine=process.env.TEST_WEBKIT==='1'?webkit:chromium;
const browser=await engine.launch(process.platform==='win32'&&engine===chromium?{channel:'msedge'}:{});
await mkdir('test-results',{recursive:true});
try{
 for(const lang of ['en','ms','zh']){
  const state={verified:false,signup:null,rows:[],writes:0,fail:false},errors=[];
  const user={id:'22222222-2222-4222-8222-222222222222',email:'synthetic@example.test',email_confirmed_at:'2026-11-19T00:00:00Z',user_metadata:{}};
  async function context(){
   const c=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
   await c.route('**/*',async route=>{
    const u=new URL(route.request().url()),path=u.pathname.slice(1);
    if(u.origin!==origin)return route.abort();
    if(path==='__test_api'){
     const {op,args}=route.request().postDataJSON();let data=null,error=null;
     if(op==='session')data={session:state.verified?{user}:null};
     if(op==='user')data={user:state.verified?user:null};
     if(op==='signup'){state.signup=args;data={session:null};}
     if(op==='resend'){state.signup.options=args.options;data={};}
     if(op==='profile')data={full_name:'Synthetic Customer',phone:'60123456789',revision:1};
     if(op==='rows')data=state.rows;
     if(op==='e2_customer_allowed')data=state.verified;
     if(op==='e2_save_vehicle'){
      assert(state.verified,'Anonymous must never save');state.writes++;
      if(state.fail)error={message:'Synthetic temporary network failure'};
      else {state.rows=args.keep?[{vehicle_id:args.target,created_at:new Date().toISOString()}]:[];data=args.keep;}
     }
     return route.fulfill({json:{data,error}});
    }
    if(path==='customer-data.js')return route.fulfill({contentType:'text/javascript',body:`
     const call=async(op,args)=>{const r=await fetch('/__test_api',{method:'POST',body:JSON.stringify({op,args})});return r.json()};
     export const check=r=>{if(r.error)throw r.error;return r.data};
     export const fields=['full_name','phone','state','city','language','budget_min','budget_max','desired_car','purchase_timeline','payment_preference','trade_in','trade_in_details'];
     const q=table=>new Proxy({}, {get:(_,key)=>key==='then'?((ok,bad)=>call(table==='customer_profiles'?'profile':'rows').then(ok,bad)):()=>q(table)});
     export const customerDB={from:q,rpc:(op,args)=>call(op,args),auth:{getSession:()=>call('session'),getUser:()=>call('user'),signUp:args=>call('signup',args),resend:args=>call('resend',args),onAuthStateChange:()=>{},signInWithPassword:()=>call('session'),signOut:async()=>({data:{}})}};
    `});
    if(path==='e2-data.js')return route.fulfill({contentType:'text/javascript',body:`export const getVehicles=async()=>[${JSON.stringify(car)}],coverURL=async()=>null,rm=n=>'RM'+n,esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));`});
    if(path==='e2-config.js')return route.fulfill({contentType:'text/javascript',body:''});
    if(path==='heart.html')return route.fulfill({contentType:'text/html',body:`<html lang="${lang}"><body><div id="filterResults"><button data-save-vehicle="${carId}" data-car-name="Honda CITY">♡ Honda CITY</button></div><p id="showroomSaveStatus"></p><dialog id="saveAccountDialog"><a data-save-auth href="/customer.html?mode=register&lang=${lang}">Register</a><a data-save-auth href="/customer.html?lang=${lang}">Sign in</a><button id="closeSaveAccount">Close</button></dialog><script type="module">import {setupShowroomSave} from '/showroom-save.js';setupShowroomSave();</script></body></html>`});
    if(!/^[\w./-]+\.(html|mjs|js|css|png)$/.test(path)||path.includes('..'))return route.fulfill({status:404,body:''});
    try{return route.fulfill({contentType:({'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.png':'image/png'})[extname(path)],body:await readFile(resolve(path))})}catch{return route.fulfill({status:404,body:''})}
   });
   c.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));return c;
  }
  const initial=await context(),page=await initial.newPage();await page.goto(origin+'/heart.html');
  await page.getByRole('button',{name:'Save Honda CITY as favourite'}).click();
  await page.getByRole('link',{name:'Register',exact:true}).click();
  await expect(page.locator('#customerRegister')).toBeVisible();
  const form=page.locator('#customerRegister');
  await form.locator('[name=full_name]').fill('Synthetic Customer');await form.locator('[name=phone]').fill('0123456789');
  await form.locator('[name=email]').fill(user.email);await form.locator('[name=password]').fill('Synthetic-Password-2026');await form.locator('[name=confirm]').fill('Synthetic-Password-2026');
  await form.locator('[name=privacy]').check();await form.locator('[type=submit]').click();
  await expect.poll(()=>state.signup?.options?.emailRedirectTo).toBeTruthy();
  const mail=new URL(state.signup.options.emailRedirectTo);assert.equal(mail.pathname,'/customer.html');assert.equal(mail.searchParams.get('save'),carId);assert.equal(mail.searchParams.get('lang'),lang);assert.equal(state.writes,0);
  // A new browser context has none of the original tab's session/local storage.
  state.verified=true;await initial.close();const confirmed=await context(),returned=await confirmed.newPage();
  await returned.goto(mail.href+'#access_token=synthetic-confirmation&type=signup');
  await expect(returned.locator('#customerAccount')).toBeVisible();await expect.poll(()=>state.rows.length).toBe(1);await returned.goto(origin+'/saved.html?lang='+lang);await expect(returned.locator('.savedCard')).toHaveCount(1);
  await expect(returned.locator('.savedCard')).toContainText('Honda CITY');assert.equal(state.rows[0].vehicle_id,carId);assert.equal(state.writes,1);
  assert.equal(new URL(returned.url()).hash,'');assert.equal(new URL(returned.url()).searchParams.has('save'),false);
  assert(await returned.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Saved cars fits iPhone width');
  await returned.screenshot({path:`test-results/favourite-confirmed-${lang}.png`,fullPage:true});
  await returned.reload();await expect(returned.locator('.savedCard')).toHaveCount(1);assert.equal(state.writes,1,'Refresh must not duplicate the save');
  await returned.locator('[data-remove]').click();await expect(returned.locator('.savedCard')).toHaveCount(0);await returned.reload();await expect(returned.locator('.savedEmpty')).toBeVisible();assert.equal(state.rows.length,0,'Removed car stays removed');
  // A failed mutation keeps intent; refresh completes it without another heart tap.
  state.fail=true;const retry=await confirmed.newPage();await retry.goto(mail.href);await retry.waitForURL('**/saved.html?lang='+lang);
  await expect(retry.locator('#savedMessage')).not.toBeEmpty();state.fail=false;await retry.locator('#refreshSaved').click();await expect(retry.locator('.savedCard')).toHaveCount(1);
  const before=state.writes;await confirmed.close();const expired=await context(),bad=await expired.newPage();await bad.goto(mail.href+'#error=access_denied&error_code=otp_expired');await expect(bad.locator('#customerAuth')).toBeVisible();assert.equal(state.writes,before,'An expired mail callback cannot save');await expired.close();assert.deepEqual(errors,[]);
 }
 console.log('Favourite registration passed in EN/BM/ZH: heart → signup → confirmation in fresh browser storage → same saved vehicle, no duplicates, removal preserved, retry and expired-link handling.');
}finally{await browser.close()}
