import {test as base,expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {initializeCustomerJourney,sdkMock,alice,bob} from './fixtures/customer-journey.mjs';
const baseline='e2e32cc688bdd6472320148ce1d3fb8d3ca93f90';
const compareBaseline=process.env.E2_TEST_BASELINE==='1';
const before=compareBaseline?{'my-e2.js':execFileSync('git',['show',baseline+':my-e2.js'],{encoding:'utf8',windowsHide:true})}:{};
function authOrder(options){
 if(options.path&&location.pathname!==options.path)return;
 const fixture=window.__customerFixture;if(!fixture)return;
 const original=fixture.client;window.__authEvents=[];
 fixture.client=key=>{const client=original(key);if(key!=='e2-customer-auth')return client;const subscribe=client.auth.onAuthStateChange;
  client.auth.onAuthStateChange=callback=>{let initialSuppressed=false;
   const report=(event,session)=>{window.__authEvents.push(event);callback(event,session);};
   const registered=subscribe((event,session)=>{if(event==='INITIAL_SESSION'&&options.suppressInitial&&!initialSuppressed){initialSuppressed=true;return;}report(event,session);if(event==='INITIAL_SESSION'&&options.order==='initial-first')report('TOKEN_REFRESHED',session);});
   if(['refresh-first','signed-in-first','repeated-refresh'].includes(options.order))queueMicrotask(()=>{const session={user:{id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'}};report(options.order==='signed-in-first'?'SIGNED_IN':'TOKEN_REFRESHED',session);if(options.order==='repeated-refresh')report('TOKEN_REFRESHED',session);});
   return registered;
  };return client;
 };
}
const test=base.extend({fixture:async({context,baseURL},use)=>{
 const external=[],errors=[];context.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));
 await context.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin===new URL(baseURL).origin){if(u.pathname==='/e2-config.js')return route.fulfill({contentType:'text/javascript',body:'window.E2_CONFIG={supabaseUrl:"https://synthetic-customer.supabase.co",publishableKey:"sb_publishable_synthetic"};'});return route.continue();}if(u.href==='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.4/+esm')return route.fulfill({contentType:'text/javascript',body:sdkMock});if(u.origin==='https://synthetic-customer.supabase.co'&&u.pathname==='/rest/v1/staff_profiles')return route.fulfill({json:[]});external.push(u.origin+u.pathname);return route.abort('blockedbyclient');});
 await use(async(options={})=>{await context.addInitScript(initializeCustomerJourney,{hold:options.hold||[]});await context.addInitScript(authOrder,options);});expect(external).toEqual([]);expect(errors).toEqual([]);
}});
const ready=async(page,path)=>path==='/customer.html'?expect(page.locator('#customerAccount')).toBeVisible():expect(page.locator('#main')).toContainText('Welcome back');
const gated=async(page,path)=>path==='/customer.html'?expect(page.locator('#customerAccount')).toBeHidden():expect(page.locator('#loanSignIn')).toBeVisible();
for(const path of ['/customer.html','/my-e2.html'])for(const order of ['refresh-first','initial-first','signed-in-first','repeated-refresh'])test(`${path}: ${order} keeps the initial authenticated view`,async({page,fixture})=>{
 await fixture({order});await page.goto(path);await ready(page,path);expect(await page.evaluate(()=>window.__customerFixture.snapshot().sessions['e2-customer-auth'])).toBe(alice);
});
for(const old of compareBaseline?[true,false]:[false])test(`${old?'production baseline reproduces gate':'candidate keeps session'}: Continue application with early refresh`,async({page,fixture},testInfo)=>{
 await fixture({order:'refresh-first',path:'/my-e2.html'});if(old)await page.route('**/my-e2.js*',route=>route.fulfill({contentType:'text/javascript',body:before['my-e2.js']}));
 await page.goto('/customer.html');await ready(page,'/customer.html');await page.locator('#customerAccount a[href="my-e2.html"]').click();await expect(page).toHaveURL(/\/my-e2.html$/);if(old)await gated(page,'/my-e2.html');else await ready(page,'/my-e2.html');
 const state=await page.evaluate(()=>window.__customerFixture.snapshot());expect(state.sessions['e2-customer-auth']).toBe(alice);expect(state.calls.filter(x=>/^rpc:e2_(?:start|save|submit)_/.test(x.op))).toEqual([]);
 await page.screenshot({path:testInfo.outputPath('continue-'+(old?'baseline':'fixed')+'.png'),fullPage:true});
});
for(const path of ['/customer.html','/my-e2.html'])for(const event of ['SIGNED_OUT','SIGNED_IN','INITIAL_SESSION'])test(`${path}: ${event} invalidates a pending verified-user response`,async({page,fixture})=>{
 await fixture({suppressInitial:true,hold:['getUser']});await page.goto(path);await expect.poll(()=>page.evaluate(()=>window.__customerFixture.snapshot().calls.filter(c=>c.op==='getUser').length)).toBeGreaterThan(0);
 await page.evaluate(({bob,event})=>window.__customerFixture.switchUser(event==='SIGNED_OUT'?null:bob,event),{bob,event});await page.evaluate(()=>window.__customerFixture.release('getUser'));await gated(page,path);await expect(page.locator('body')).not.toContainText('Alice private');if(path==='/customer.html')await expect(page.locator('#customerProfile [name=full_name]')).toHaveValue('');
});
for(const path of ['/customer.html','/my-e2.html'])test(`${path}: first account event rejects an older getSession result`,async({page,fixture})=>{
 await fixture({suppressInitial:true,hold:['getSession']});await page.goto(path);await expect.poll(()=>page.evaluate(()=>window.__customerFixture.snapshot().calls.filter(c=>c.op==='getSession').length)).toBeGreaterThan(0);await page.evaluate(id=>window.__customerFixture.switchUser(id),bob);await page.evaluate(()=>window.__customerFixture.release('getSession'));
 await expect(page.locator('body')).not.toContainText('Alice private');if(path==='/customer.html')await gated(page,path);else{await expect(page.locator('#main')).toContainText('Bob Example');await expect(page.locator('#main')).not.toContainText('Alice Example');}
});
test('same-revision old fields cannot be saved into the next account after a cross-tab switch',async({page,context,fixture})=>{
 await fixture({order:'refresh-first'});await page.goto('/customer.html');await ready(page,'/customer.html');await page.locator('#customerProfile [name=full_name]').fill('STALE ALICE FIELDS');const other=await context.newPage();await other.goto('/customer.html');await ready(other,'/customer.html');await other.evaluate(id=>window.__customerFixture.switchUser(id),bob);await gated(page,'/customer.html');await expect(page.locator('#customerProfile [name=full_name]')).toHaveValue('');await page.locator('#customerProfile').dispatchEvent('submit');const result=await page.evaluate(({alice,bob})=>{const s=window.__customerFixture.snapshot();return {alice:s.profiles[alice].full_name,aliceRevision:s.profiles[alice].revision,bob:s.profiles[bob].full_name,bobRevision:s.profiles[bob].revision,writes:s.calls.filter(c=>c.op==='rpc:e2_save_customer_profile').length};},{alice,bob});expect(result).toEqual({alice:'Alice Example',aliceRevision:1,bob:'Bob Example',bobRevision:1,writes:0});
});
