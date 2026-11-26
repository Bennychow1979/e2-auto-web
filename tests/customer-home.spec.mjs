import {test,expect} from '@playwright/test';
import {initializeCustomerJourney,sdkMock,alice} from './fixtures/customer-journey.mjs';

async function setup(context,baseURL,options={}){
 await context.addInitScript(initializeCustomerJourney,options);
 await context.route('**/*',route=>{
  const u=new URL(route.request().url());
  if(u.origin===new URL(baseURL).origin){
   if(['/','/ms/','/zh/'].includes(u.pathname))return route.fulfill({contentType:'text/html',body:'<title>E2 Home</title><h1>Home</h1>'});
   if(u.pathname==='/e2-config.js')return route.fulfill({contentType:'text/javascript',body:'window.E2_CONFIG={supabaseUrl:"https://synthetic-customer.supabase.co",publishableKey:"sb_publishable_synthetic"}'});
   return route.continue();
  }
  if(u.href==='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.4/+esm')return route.fulfill({contentType:'text/javascript',body:sdkMock});
  return route.abort();
 });
}
const home=lang=>lang==='en'?'/':'/'+lang+'/';
const submit=page=>page.locator('#customerProfile [type=submit]').click();
for(const lang of ['en','ms','zh']){
 test(`${lang}: unsaved stays on profile; explicit Save goes home; next login goes home`,async({page,context,baseURL})=>{
  await setup(context,baseURL);
  await page.goto('/customer.html?lang='+lang);
  await expect(page.locator('#customerAccount')).toBeVisible();
  await page.reload();await expect(page.locator('#customerAccount')).toBeVisible();
  await expect(page.locator('.customerHome')).toHaveText({en:'Back to home',ms:'Kembali ke laman utama',zh:'返回首页'}[lang]);
  await expect(page.locator('.customerHome')).toHaveAttribute('href',baseURL+home(lang));
  await expect(page.locator('.brand')).toHaveAttribute('href',baseURL+home(lang));
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:`test-results/profile-home-${lang}-${test.info().project.name}.png`,fullPage:true});
  await page.evaluate(()=>window.__customerFixture.fail('rpc:e2_complete_customer_profile'));
  await submit(page);await expect(page.locator('#customerProfileMessage')).toContainText('Synthetic interrupted');
  await expect(page.locator('#customerAccount')).toBeVisible();
  await submit(page);await expect(page).toHaveURL(baseURL+home(lang));
  expect(await page.evaluate(id=>window.__customerFixture.snapshot().profiles[id].profile_saved_at,alice)).toBeTruthy();
  await page.goto('/customer.html?lang='+lang);await expect(page).toHaveURL(baseURL+home(lang));
  await page.goto('/customer.html?view=profile&lang='+lang);await expect(page.locator('#customerAccount')).toBeVisible();
  await page.locator('#customerSignOut').click();
  // Normal sign-in (not an explicit profile-edit link).
  await page.goto('/customer.html?lang='+lang);
  await page.locator('#customerSignIn [name=email]').fill('alice@example.test');
  await page.locator('#customerSignIn [name=password]').fill('Synthetic-only-123!');
  await page.locator('#customerSignIn [type=submit]').click();await expect(page).toHaveURL(baseURL+home(lang));
 });
 test(`${lang}: another device uses saved database state; deliberate profile and language switch stay editable`,async({page,context,baseURL})=>{
  await setup(context,baseURL,{completed:true});
  await page.goto('/customer.html?lang='+lang);await expect(page).toHaveURL(baseURL+home(lang));
  await page.goto('/customer.html?view=profile&lang='+lang);await expect(page.locator('#customerAccount')).toBeVisible();
  await page.reload();await expect(page.locator('#customerAccount')).toBeVisible();
  await page.locator('.customerLanguages [data-customer-language="zh"]').click();await expect(page.locator('#customerAccount')).toBeVisible();
  expect(new URL(page.url()).searchParams.get('view')).toBe('profile');
 });
 for(const completed of [false,true])test(`${lang}: WhatsApp password sign-in routes ${completed?'home':'to unsaved profile'}`,async({page,context,baseURL})=>{
  await setup(context,baseURL,{session:false,phone:true,completed});
  await page.goto('/customer-whatsapp.html?lang='+lang);
  await page.locator('#phonePassword [name=phone]').fill('0123456789');
  await page.locator('#phonePassword [name=password]').fill('Synthetic-only-123!');
  await page.locator('#phonePassword [type=submit]').click();
  if(completed)await expect(page).toHaveURL(baseURL+home(lang));
  else {await expect(page.locator('#customerAccount')).toBeVisible();await submit(page);await expect(page).toHaveURL(baseURL+home(lang));}
 });
}
