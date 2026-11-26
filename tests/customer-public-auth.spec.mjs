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
 await expect(page.locator('#otpLogin')).toHaveCount(0);
 await expect(page.locator('.authTabs button')).toHaveCount(2);
 await expect(page).toHaveURL(u=>u.pathname==='/customer-whatsapp.html'&&u.searchParams.get('lang')===lang&&u.searchParams.get('mode')==='register'&&u.searchParams.get('save')===vehicle);
 await expect(page.locator('#otpRegistration')).toBeVisible();
 await expect(page.locator('body')).not.toContainText(/limited test|限指定号码|Ujian terhad/i);
 await page.locator('#emailLink').click();
 await expect(page).toHaveURL(u=>u.pathname==='/customer.html'&&u.searchParams.get('method')==='email');
 await expect(page.locator('#customerRegister')).toBeVisible();
 await page.locator('#showSignIn').click();
 await expect(page.locator('#customerSignIn [name=email]')).toBeVisible();
 await expect(page.locator('#whatsappEntry')).toHaveAttribute('href',new RegExp('customer-whatsapp.html\\?lang='+lang));
});

for(const lang of ['en','ms','zh'])test('default sign-in is WhatsApp password; explicit email survives reload and language switch '+lang,async({page,context,baseURL})=>{
 const authCalls=[];
 await page.exposeFunction('recordDefaultAuth',args=>authCalls.push(args));
 await context.route('**/*',route=>{
  const url=new URL(route.request().url());
  if(url.origin===new URL(baseURL).origin){
   if(url.pathname==='/e2-config.js')return route.fulfill({contentType:'text/javascript',body:'window.E2_CONFIG={supabaseUrl:"https://synthetic-customer.supabase.co",publishableKey:"sb_publishable_synthetic"}'});
   return route.continue();
  }
  if(url.hostname==='cdn.jsdelivr.net')return route.fulfill({contentType:'text/javascript',body:'export const createClient=()=>({auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),signInWithOtp:async a=>{await window.recordDefaultAuth(a);return {data:{}}}},rpc:async()=>({data:false})});'});
  return route.abort();
 });
 await page.goto('/customer.html?lang='+lang);
 await expect(page).toHaveURL(u=>u.pathname==='/customer-whatsapp.html'&&u.searchParams.get('lang')===lang);
 await expect(page.locator('#phonePassword')).toBeVisible();
 await expect(page.locator('#otpRequest')).toBeHidden();
 await expect(page.locator('#otpLogin')).toHaveCount(0);
 await expect(page.locator('#phonePassword [name=phone]')).toHaveAttribute('autocomplete','section-whatsapp tel');
 await expect(page.locator('[data-copy=intro]')).toContainText({en:'number and password',ms:'nombor WhatsApp dan kata laluan',zh:'手机号码和密码'}[lang]);
 expect(authCalls).toEqual([]);
 await page.screenshot({path:'test-results/whatsapp-first-'+lang+'-'+test.info().project.name+'.png',fullPage:true});
 await page.locator('#emailLink').click();
 await expect(page.locator('#customerSignIn')).toBeVisible();
 await page.reload();await expect(page.locator('#customerSignIn')).toBeVisible();
 await page.locator('[data-customer-language=zh]').click();
 await expect(page.locator('#customerSignIn')).toBeVisible();
 await expect(page.locator('.customerIntro h1')).toHaveText('使用邮箱登录');
 expect(new URL(page.url()).searchParams.get('method')).toBe('email');
 expect(authCalls).toEqual([]);
});
