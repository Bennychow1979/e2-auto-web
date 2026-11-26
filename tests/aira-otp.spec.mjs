import {test,expect} from '@playwright/test';
for(const lang of ['en','ms','zh']){
 test('WhatsApp pilot '+lang+': register, invalid code, verified redirect and email fallback',async({page,context,baseURL})=>{
  const calls=[];
  await context.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.origin===new URL(baseURL).origin){
    if(url.pathname==='/e2-config.js')return route.fulfill({contentType:'text/javascript',body:'window.E2_CONFIG={supabaseUrl:"https://synthetic-customer.supabase.co",publishableKey:"sb_publishable_synthetic"}'});
    if(url.pathname==='/customer.html')return route.fulfill({contentType:'text/html',body:'<p>Verified profile destination</p>'});
    return route.continue();
   }
   if(url.hostname==='cdn.jsdelivr.net')return route.fulfill({contentType:'text/javascript',body:`
    export function createClient(){return {
     auth:{
      getSession:async()=>({data:{session:null}}),
      signInWithOtp:async args=>{await window.recordOtp('request',args);return {data:{}}},
      getUser:async()=>({data:{user:{id:'00000000-0000-4000-8000-000000000001',phone:'60123456789',phone_confirmed_at:'2026-01-01'}}}),
      updateUser:async args=>{await window.recordOtp('update',args);return {data:{user:{id:'00000000-0000-4000-8000-000000000001',phone:'60123456789',phone_confirmed_at:'2026-01-01'}}}},
      signOut:async()=>({data:{}}),
      verifyOtp:async args=>{await window.recordOtp('verify',args);return args.token==='123456'?{data:{session:{},user:{id:'00000000-0000-4000-8000-000000000001',phone:'60123456789',phone_confirmed_at:'2026-01-01'}}}:{error:{message:'invalid'}}}
     },rpc:async()=>({data:true})};}
   `});
   return route.abort();
  });
  await page.exposeFunction('recordOtp',(op,args)=>calls.push({op,args}));
  await page.goto('/customer-whatsapp-test.html?lang='+lang+'&save=00000000-0000-4000-8000-000000000008&save_at='+Date.now());
  await expect(page.locator('#phonePassword [type=submit]')).toBeEnabled();
  await expect(page.locator('#emailLink')).toHaveAttribute('href',new RegExp('customer.html.*lang='+lang));
  await page.locator('#otpRegister').click();
  await page.locator('#otpRequest [name=phone]').fill('012 345 6789');
  await page.locator('[name=full_name]').fill('Synthetic QA');
  await page.locator('[name=privacy]').check();
  await page.locator('#otpRequest [type=submit]').click();
  await expect(page.locator('#otpVerify')).toBeVisible();
  expect(calls[0].args.phone).toBe('+60123456789');
  expect(calls[0].args.options.shouldCreateUser).toBe(true);
  expect(calls[0].args.options.data.full_name).toBe('Synthetic QA');
  await page.locator('[name=code]').fill('999999');
  await page.locator('#otpVerify [type=submit]').click();
  await expect(page.locator('[name=code]')).toHaveValue('');
  expect(page.url()).toContain('customer-whatsapp-test');
  await page.locator('[name=code]').fill('123456');
  await page.locator('#otpVerify [type=submit]').click();
  await expect(page.locator('#setPhonePassword')).toBeVisible();
  await page.locator('#setPhonePassword [name=password]').fill('qa1234');
  await page.locator('[name=confirm_password]').fill('qa1234');
  await page.locator('#setPhonePassword [type=submit]').click();
  await expect(page.locator('#otpSignedIn')).toBeVisible();
  expect(calls.at(-1)).toEqual({op:'update',args:{password:'qa1234'}});
  await page.locator('#profileLink').click();
  await expect(page).toHaveURL(/customer.html/);
  expect(page.url()).toContain('save=00000000-0000-4000-8000-000000000008');
  expect(page.url()).not.toContain('123456');
 });
 test('WhatsApp pilot '+lang+': login never silently creates users; changing number clears input',async({page,context,baseURL})=>{
  let request;
  await context.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.origin===new URL(baseURL).origin){if(url.pathname==='/e2-config.js')return route.fulfill({contentType:'text/javascript',body:'window.E2_CONFIG={supabaseUrl:"https://synthetic-customer.supabase.co",publishableKey:"sb_publishable_synthetic"}'});return route.continue()}
   if(url.hostname==='cdn.jsdelivr.net')return route.fulfill({contentType:'text/javascript',body:'export const createClient=()=>({auth:{getSession:async()=>({data:{session:null}}),signInWithOtp:async args=>{await window.recordRequest(args);return {data:{}}}}});'});
   return route.abort();
  });
  await page.exposeFunction('recordRequest',args=>{request=args});
  await page.goto('/customer-whatsapp-test.html?lang='+lang);
  await page.locator('#otpLogin').click();
  await expect(page.locator('#otpRequest [type=submit]')).toBeEnabled();
  await page.locator('#otpRequest [name=phone]').fill('012 345 6789');await page.locator('#otpRequest [type=submit]').click();
  await expect(page.locator('#otpVerify')).toBeVisible();expect(request.options.shouldCreateUser).toBe(false);
  await page.locator('[name=code]').fill('123456');await page.locator('#otpChange').click();
  await expect(page.locator('#otpRequest')).toBeVisible();await expect(page.locator('[name=code]')).toHaveValue('');
  await page.locator('#otpRequest [type=submit]').click();await expect(page.locator('#otpVerify')).toBeHidden();
 });
}
