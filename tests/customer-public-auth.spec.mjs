import {test,expect} from '@playwright/test';
const vehicle='00000000-0000-4000-8000-000000000008';
for(const lang of ['en','ms','zh'])test('public WhatsApp entry retains email, language and favourite '+lang,async({page,context,baseURL})=>{
 await context.route('**/*',route=>{
  const url=new URL(route.request().url());
  if(url.origin===new URL(baseURL).origin){
   if(url.pathname==='/e2-config.js')return route.fulfill({contentType:'text/javascript',body:'window.E2_CONFIG={supabaseUrl:"https://synthetic-customer.supabase.co",publishableKey:"sb_publishable_synthetic"}'});
   return route.continue();
  }
  if(url.hostname==='cdn.jsdelivr.net')return route.fulfill({contentType:'text/javascript',body:`export function createClient(){return {auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},rpc:async()=>({data:false})}}`});
  return route.abort();
 });
 await page.goto('/customer.html?lang='+lang+'&mode=register&save='+vehicle+'&save_at='+Date.now());
 await expect(page.locator('#customerRegister')).toBeVisible();
 await expect(page.locator('#customerRegister [name=email]')).toBeVisible();
 await page.locator('#whatsappEntry').click();
 await expect(page).toHaveURL(u=>u.pathname==='/customer-whatsapp.html'&&u.searchParams.get('lang')===lang&&u.searchParams.get('mode')==='register'&&u.searchParams.get('save')===vehicle);
 await expect(page.locator('#otpRegistration')).toBeVisible();
 await expect(page.locator('body')).not.toContainText(/limited test|限指定号码|Ujian terhad/i);
 await page.locator('#emailLink').click();
 await expect(page).toHaveURL(u=>u.pathname==='/customer.html'&&u.searchParams.get('save')===vehicle);
 await expect(page.locator('#customerRegister')).toBeVisible();
 await page.locator('#showSignIn').click();
 await expect(page.locator('#customerSignIn [name=email]')).toBeVisible();
 await expect(page.locator('#whatsappEntry')).toHaveAttribute('href',new RegExp('customer-whatsapp.html\\?lang='+lang));
});
