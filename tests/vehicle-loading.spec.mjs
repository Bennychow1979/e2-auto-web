import {test as base,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {localizedPage} from '../scripts/build-languages.mjs';
import {vehicleA,vehicleB,salesperson,initializeVehicle,vehicleSDK,syntheticConfig,photoSVG} from './fixtures/vehicle-loading.mjs';
// Real pages and adapters; all SDK and public HTTP boundaries are synthetic.
const test=base.extend({fixture:async({context,baseURL},use)=>{
 const external=[],errors=[];context.on('page',page=>page.on('pageerror',e=>errors.push(e.message)));
 await context.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.origin===new URL(baseURL).origin){
   if(url.pathname==='/e2-config.js')return route.fulfill({contentType:'text/javascript',body:syntheticConfig});
   const photo=/^\/test-photo-([123])\.svg$/.exec(url.pathname);if(photo)return route.fulfill({contentType:'image/svg+xml',body:photoSVG(Number(photo[1]))});
   const localized=/^\/(ms|zh)\/(car|booking)\.html$/.exec(url.pathname);if(localized){const file=localized[2]+'.html',html=localizedPage(await readFile(new URL('../'+file,import.meta.url),'utf8'),file,localized[1]);return route.fulfill({contentType:'text/html',body:html});}
   return route.continue();
  }
  if(url.href==='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.4/+esm')return route.fulfill({contentType:'text/javascript',body:vehicleSDK});
  if(url.origin==='https://synthetic-vehicle.supabase.co'&&route.request().method()==='GET'){
   if(url.pathname==='/rest/v1/staff_profiles')return route.fulfill({json:[salesperson]});
   if(url.pathname==='/rest/v1/vehicles')return route.fulfill({json:[vehicleA,vehicleB]});
  }
  external.push(url.href);return route.abort();
 });
 await use(options=>context.addInitScript(initializeVehicle,{vehicles:[vehicleA,vehicleB],...options}));expect(external).toEqual([]);expect(errors).toEqual([]);
}});
for(const lang of ['en','ms','zh']){
 const prefix=lang==='en'?'/':'/'+lang+'/';
 test(lang+' legacy link shows facts and controls while photos remain pending',async({page,fixture})=>{
  await fixture({photoMode:'hold'});await page.goto(prefix+'car.html?id='+vehicleA.id+'&sales='+salesperson.user_id+'&ref=TESTCODE');await expect(page.locator('html')).toHaveAttribute('data-inventory-verified','true');
  await expect(page.locator('#carMain')).toBeVisible();await expect(page.locator('#model')).toHaveText('VIOS');await expect(page.locator('#heroPrice')).toHaveText('RM34,990');await expect(page.locator('#monthly')).not.toBeEmpty();
  await expect(page.locator('link[rel=canonical]')).toHaveAttribute('href','https://e2auto.my'+prefix+'car.html?id='+vehicleA.id);await expect(page.locator('[data-language=en]')).toHaveAttribute('href',new RegExp('/car.html\\?id='+vehicleA.id+'&sales='+salesperson.user_id+'&ref=TESTCODE'));
  const enquiry=new URL(await page.locator('#enquire').getAttribute('href'));expect(enquiry.pathname).toBe('/'+salesperson.whatsapp);expect(enquiry.searchParams.get('text')).toContain(prefix+'car.html?id='+vehicleA.id+'&sales='+salesperson.user_id);
  await page.locator('[data-book]:visible').first().click();await expect(page).toHaveURL(new RegExp(prefix+'booking.html\\?id='+vehicleA.id+'&ref=TESTCODE&sales='+salesperson.user_id));
 });
 test(lang+' photo failure, retry and original album order preserve legacy behavior',async({page,fixture})=>{
  await fixture({photoMode:'fail'});await page.goto(prefix+'car.html?id='+vehicleA.id);await expect(page.locator('html')).toHaveAttribute('data-inventory-verified','true');await expect(page.locator('#openPhoto')).toBeHidden();await expect(page.locator('#model')).toHaveText('VIOS');
  await page.evaluate(()=>window.__vehicleFixture.state.photoMode='ready');await page.locator('#reloadPhotos').click();await expect(page.locator('#photoThumbs button')).toHaveCount(3);await page.locator('#openPhoto').click();await expect(page.locator('#photoPosition')).toHaveText('1 / 3');await page.locator('#nextPhoto').click();await expect(page.locator('#largePhoto')).toHaveAttribute('src','/test-photo-2.svg');await page.locator('#prevPhoto').click();await expect(page.locator('#photoPosition')).toHaveText('1 / 3');await page.locator('#closePhoto').click();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);expect(await page.evaluate(()=>window.__vehicleFixture.state.calls.filter(v=>v==='UNEXPECTED WRITE'))).toEqual([]);
 });
}
test('photo timeout is bounded and a late old result cannot overwrite the retry',async({page,fixture})=>{
 await fixture({photoMode:'hold'});await page.goto('/car.html?id='+vehicleA.id);await expect(page.locator('#photoCount')).toContainText('temporarily unavailable',{timeout:11000});await page.evaluate(()=>window.__vehicleFixture.state.photoMode='ready');await page.locator('#reloadPhotos').click();await expect(page.locator('#photoThumbs button')).toHaveCount(3);await page.locator('#photoThumbs button').nth(2).click();await expect(page.locator('#photoPosition')).toHaveText('3 / 3');await page.evaluate(()=>window.__vehicleFixture.release('photos'));await expect(page.locator('#photoPosition')).toHaveText('3 / 3');
});
for(const status of ['Reserved','Sold'])test(status+' preserves the existing public status and application gate',async({page,fixture})=>{
 await fixture({vehicles:[{...vehicleA,stock_status:status}]});await page.goto('/car.html?id='+vehicleA.id);await expect(page.locator('#publicationNote')).toHaveText(status);await expect(page.locator('#applyLoan')).toBeHidden();await expect(page.locator('#heroPrice')).toHaveText('RM34,990');
});
test('unpublished vehicle never becomes visible through the independent patch',async({page,fixture})=>{
 await fixture({vehicles:[{...vehicleA,publication:'draft'}]});await page.goto('/car.html?id='+vehicleA.id);await expect(page.locator('#carState')).toContainText('not currently published');await expect(page.locator('#carMain')).toBeHidden();await expect(page.locator('meta[name=robots]')).toHaveAttribute('content','noindex,nofollow');
});
