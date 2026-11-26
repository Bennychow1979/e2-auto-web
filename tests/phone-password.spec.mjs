import {test,expect} from '@playwright/test';
const user={id:'00000000-0000-4000-8000-000000000001',phone:'60123456789',phone_confirmed_at:'2026-01-01'};
async function mockAuth(page,context,baseURL,options={}){
 const calls=[];
 await page.exposeFunction('recordAuth',(op,args)=>calls.push({op,args}));
 await context.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.origin===new URL(baseURL).origin){
   if(url.pathname==='/e2-config.js')return route.fulfill({contentType:'text/javascript',body:'window.E2_CONFIG={supabaseUrl:"https://synthetic-customer.supabase.co",publishableKey:"sb_publishable_synthetic"}'});
   if(url.pathname==='/customer.html')return route.fulfill({contentType:'text/html',body:'<p>Verified profile destination</p>'});
   return route.continue();
  }
  if(url.hostname==='cdn.jsdelivr.net')return route.fulfill({contentType:'text/javascript',body:`
   const user=${JSON.stringify(user)},options=${JSON.stringify(options)};
   let current=options.initial?user:null;
   export function createClient(){return {
    auth:{
     getSession:async()=>({data:{session:current?{user:current}:null}}),
     getUser:async()=>({data:{user:options.switched?{...user,id:'another-account'}:current}}),
     signInWithOtp:async args=>{await window.recordAuth('request',args);return {data:{}}},
     verifyOtp:async args=>{await window.recordAuth('verify',args);if(args.token!=='123456')return {error:{message:'invalid'}};current=user;return {data:{session:{},user}}},
     signInWithPassword:async args=>{await window.recordAuth('password',args);if(args.password!=='qa1234')return {error:{message:'invalid'}};current=user;return {data:{session:{},user}}},
     updateUser:async args=>{await window.recordAuth('update',args);return options.updateFails?{error:{message:'weak'}}:{data:{user}}},
     signOut:async args=>{await window.recordAuth('signout',args);current=null;return {data:{}}}
    },rpc:async()=>({data:options.denied?false:true})};}
  `});
  return route.abort();
 });
 return calls;
}
async function requestReset(page){
 await page.locator('#forgotPassword').click();
 await page.locator('#otpRequest [name=phone]').fill('012 345 6789');
 await page.locator('#otpRequest [type=submit]').click();
 await expect(page.locator('#otpVerify')).toBeVisible();
}
async function verifyCode(page){
 await page.locator('[name=code]').fill('123456');
 await page.locator('#otpVerify [type=submit]').click();
 await expect(page.locator('#setPhonePassword')).toBeVisible();
}
async function fillPassword(page,a='qa1234',b=a){
 await page.locator('#setPhonePassword [name=password]').fill(a);
 await page.locator('[name=confirm_password]').fill(b);
 await page.locator('#setPhonePassword [type=submit]').click();
}
for(const lang of ['en','ms','zh']){
 test('phone password '+lang+': login uses existing account without sending OTP',async({page,context,baseURL})=>{
  const calls=await mockAuth(page,context,baseURL);
  await page.goto('/customer-whatsapp-test.html?lang='+lang);
  await page.locator('#phonePassword [name=phone]').fill('012 345 6789');
  await page.locator('#phonePassword [name=password]').fill('wrong123');
  await page.locator('#phonePassword [type=submit]').click();
  await expect(page.locator('#phonePassword [name=password]')).toHaveValue('');
  await expect(page.locator('#phonePassword')).toBeVisible();
  await page.locator('#phonePassword [name=password]').fill('qa1234');
  await page.locator('#phonePassword [type=submit]').click();
  await expect(page).toHaveURL(new RegExp('customer.html.*lang='+lang));
  expect(calls.filter(c=>c.op==='request')).toHaveLength(0);
  expect(calls.at(-1).args.phone).toBe('+60123456789');
 });
 test('phone password '+lang+': reset requires OTP, six characters and matching confirmation',async({page,context,baseURL})=>{
  const calls=await mockAuth(page,context,baseURL);
  await page.goto('/customer-whatsapp-test.html?lang='+lang);
  await requestReset(page);
  expect(calls[0].args.options.shouldCreateUser).toBe(false);
  expect(calls.filter(c=>c.op==='update')).toHaveLength(0);
  await verifyCode(page);
  await fillPassword(page,'short');expect(calls.filter(c=>c.op==='update')).toHaveLength(0);
  await fillPassword(page,'qa1234','qa4321');expect(calls.filter(c=>c.op==='update')).toHaveLength(0);
  await fillPassword(page);
  await expect(page.locator('#otpSignedIn')).toBeVisible();
  expect(calls.filter(c=>c.op==='update').map(c=>c.args)).toEqual([{password:'qa1234'}]);
  await expect(page.locator('#setPhonePassword [name=password]')).toHaveValue('');
  expect(page.url()).not.toMatch(/qa1234|123456/);
 });
}
test('phone password: another account cannot inherit setup verification',async({page,context,baseURL})=>{
 const calls=await mockAuth(page,context,baseURL,{switched:true});
 await page.goto('/customer-whatsapp-test.html');await requestReset(page);await verifyCode(page);
 await fillPassword(page);
 await expect(page.locator('#setPhonePassword [name=password]')).toHaveValue('');
 expect(calls.filter(c=>c.op==='update')).toHaveLength(0);
});
test('phone password: denied session is signed out after password login',async({page,context,baseURL})=>{
 const calls=await mockAuth(page,context,baseURL,{denied:true});
 await page.goto('/customer-whatsapp-test.html');
 await page.locator('#phonePassword [name=phone]').fill('012 345 6789');
 await page.locator('#phonePassword [name=password]').fill('qa1234');
 await page.locator('#phonePassword [type=submit]').click();
 await expect(page.locator('#phonePassword [name=password]')).toHaveValue('');
 expect(calls.some(c=>c.op==='signout')).toBe(true);
 expect(page.url()).toContain('customer-whatsapp-test');
});
test('phone password: existing session still needs a fresh code to change password',async({page,context,baseURL})=>{
 const calls=await mockAuth(page,context,baseURL,{initial:true});
 await page.goto('/customer-whatsapp-test.html');
 await expect(page.locator('#otpSignedIn')).toBeVisible();
 await page.locator('#changePhonePassword').click();
 await expect(page.locator('#otpRequest')).toBeVisible();
 await expect(page.locator('#setPhonePassword')).toBeHidden();
 await page.locator('#otpRequest [type=submit]').click();
 await expect(page.locator('#otpVerify')).toBeVisible();
 expect(calls[0].args.options.shouldCreateUser).toBe(false);
 expect(calls.filter(c=>c.op==='update')).toHaveLength(0);
});
test('phone password: expired verification cannot set a password',async({page,context,baseURL})=>{
 const calls=await mockAuth(page,context,baseURL);
 await page.clock.install();
 await page.goto('/customer-whatsapp-test.html');await requestReset(page);await verifyCode(page);
 await page.clock.fastForward(301000);await fillPassword(page);
 await expect(page.locator('#otpRequest')).toBeVisible();
 await expect(page.locator('#setPhonePassword')).toBeHidden();
 expect(calls.filter(c=>c.op==='update')).toHaveLength(0);
});
test('phone password: rejected update clears password fields without showing success',async({page,context,baseURL})=>{
 await mockAuth(page,context,baseURL,{updateFails:true});
 await page.goto('/customer-whatsapp-test.html');await requestReset(page);await verifyCode(page);await fillPassword(page);
 await expect(page.locator('#setPhonePassword [name=password]')).toHaveValue('');
 await expect(page.locator('[name=confirm_password]')).toHaveValue('');
 await expect(page.locator('#otpSignedIn')).toBeHidden();
 await expect(page.locator('#setPhonePassword')).toBeVisible();
});
