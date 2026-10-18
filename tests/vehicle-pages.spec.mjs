import {test as base,expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {vehicleA,vehicleB,vehicleSold,salesperson,initializeVehicle,vehiclePath,photoSVG} from './fixtures/vehicle-pages.mjs';
const test=base.extend({fixture:async({context,baseURL},use)=>{
 const external=[],errors=[];context.on('page',page=>page.on('pageerror',e=>errors.push(e.message)));
 await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin===new URL(baseURL).origin)return route.continue();if(url.hostname==='synthetic-vehicle.supabase.co'&&url.pathname==='/functions/v1/e2-drive-photos')return route.fulfill({contentType:'image/svg+xml',body:photoSVG(1)});if(['http:','https:'].includes(url.protocol)){external.push(url.href);return route.abort();}return route.continue()});
 await use(options=>context.addInitScript(initializeVehicle,{vehicles:[vehicleA,vehicleB],...options}));
 expect(external,'No requests to real services').toEqual([]);expect(errors,'No unhandled script errors').toEqual([]);
}});
const ready=page=>expect(page.locator('html')).toHaveAttribute('data-inventory-verified','true');
for(const lang of ['en','ms','zh'])test('literal '+lang+' source is useful without JavaScript',async({browser,baseURL},info)=>{
 const context=await browser.newContext({javaScriptEnabled:false,viewport:info.project.use.viewport}),page=await context.newPage();
 await context.route('https://synthetic-vehicle.supabase.co/**',r=>r.fulfill({contentType:'image/svg+xml',body:photoSVG(1)}));
 await page.goto(baseURL+vehiclePath(vehicleA.id,lang));
 await expect(page.locator('#carMain')).toBeVisible();await expect(page.locator('#model')).toHaveText('VIOS');await expect(page.locator('#heroPrice')).toHaveText('RM34,990');await expect(page.locator('#specGrid')).toContainText('TEST-A');
 await expect(page.locator('link[rel=canonical]')).toHaveAttribute('href','https://e2auto.my'+vehiclePath(vehicleA.id,lang));expect(await page.locator('link[rel=alternate]').count()).toBe(4);
 for(const l of ['en','ms','zh'])await expect(page.locator('[data-language='+l+']')).toHaveAttribute('href',vehiclePath(vehicleA.id,l));
 await expect(page.locator('#finance')).toBeHidden();await expect(page.locator('[data-book]').first()).toBeDisabled();expect(new URL(await page.locator('#enquire').getAttribute('href')).pathname).toBe('/60122785126');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 if(lang==='en')await page.screenshot({path:info.outputPath('no-js.png'),fullPage:false});await context.close();
});
for(const lang of ['en','ms','zh'])test('Sold '+lang+' source offers a similar-car enquiry without booking or writes',async({browser,baseURL},info)=>{
 const context=await browser.newContext({javaScriptEnabled:false,viewport:info.project.use.viewport});await context.route('https://synthetic-vehicle.supabase.co/**',r=>r.fulfill({contentType:'image/svg+xml',body:photoSVG(1)}));const page=await context.newPage();await page.goto(baseURL+vehiclePath(vehicleSold.id,lang));
 await expect(page.locator('#stockRequest')).toBeVisible();await expect(page.locator('[data-book]').first()).toBeHidden();await expect(page.locator('#finance')).toBeHidden();await expect(page.locator('#applyLoan')).toBeHidden();
 const link=new URL(await page.locator('#stockRequestLink').getAttribute('href'));expect(link.hostname).toBe('wa.me');expect(link.pathname).toBe('/60122785126');expect(link.searchParams.get('text')).toContain('2022 TEST Honda CITY');
 expect(await page.locator('#enquire').textContent()).toBe(await page.locator('#stockRequestLink').textContent());expect(await page.locator('#heroImage').evaluate(n=>n.complete&&n.naturalWidth>0)).toBe(true);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);if(lang==='zh')await page.screenshot({path:info.outputPath('sold-no-js-zh.png'),fullPage:false});await context.close();
});
test('stable first image survives album timeout with useful larger view',async({page,fixture})=>{await fixture({photoMode:'hold'});await page.goto(vehiclePath(vehicleA.id));await ready(page);await expect(page.locator('#photoCount')).toContainText('temporarily unavailable',{timeout:11000});await expect(page.locator('#openPhoto')).toBeVisible();await page.locator('#openPhoto').click();await expect(page.locator('#largePhoto')).toHaveAttribute('src',/public_vehicle=/);await expect(page.locator('#photoPosition')).toHaveText('1 / 1')});
test('Sold live status replaces the inquiry but never creates a real request',async({page,fixture})=>{await fixture({vehicles:[{...vehicleA,stock_status:'Sold'}]});await page.goto(vehiclePath(vehicleA.id)+'?sales='+salesperson.user_id);await ready(page);await expect(page.locator('#stockRequest')).toBeVisible();await expect(page.locator('[data-book]').first()).toBeHidden();await expect(page.locator('#finance')).toBeHidden();const link=new URL(await page.locator('#stockRequestLink').getAttribute('href'));expect(link.pathname).toBe('/'+salesperson.whatsapp);expect(link.searchParams.get('text')).toContain('stock request');expect(link.searchParams.get('text')).toContain(vehiclePath(vehicleA.id));expect(await page.evaluate(()=>window.__vehicleFixture.state.calls.filter(c=>c==='UNEXPECTED WRITE'))).toEqual([])});
test('fresh Available status removes stale Sold display from the static snapshot',async({page,fixture})=>{await fixture({vehicles:[{...vehicleSold,stock_status:'Available'}]});await page.goto(vehiclePath(vehicleSold.id));await ready(page);await expect(page.locator('#stockRequest')).toBeHidden();await expect(page.locator('[data-book]:visible').first()).toBeVisible();await expect(page.locator('#finance')).toBeVisible();await expect(page.locator('#enquire')).toContainText('WhatsApp')});
test('SDK failure still leaves distinct vehicle facts and snapshot notice',async({page,fixture,context},info)=>{
 await fixture();await context.route('**/test-sdk.mjs',route=>route.abort());await page.goto(vehiclePath(vehicleB.id));
 await expect(page.locator('#model')).toHaveText('CITY');await expect(page.locator('#heroPrice')).toHaveText('RM56,990');await expect(page.locator('#inventoryNotice')).toContainText('Saved listing');await expect(page.locator('#carMain')).toBeVisible();await expect(page.locator('#finance')).toBeHidden();await page.screenshot({path:info.outputPath('sdk-unavailable.png')});
});
test('slow photos cannot block live facts, calculator, sales link or viewing link',async({page,fixture},info)=>{
 await fixture({photoMode:'hold'});await page.goto('/car.html?id='+vehicleA.id+'&sales='+salesperson.user_id+'&ref=TESTCODE');await ready(page);
 await expect(page.locator('#heroPrice')).toHaveText('RM34,990');await expect(page.locator('#model')).toHaveText('VIOS');await expect(page.locator('#photoCount')).toContainText('Loading photos');await expect(page.locator('#monthly')).not.toBeEmpty();
 const enquiry=new URL(await page.locator('#enquire').getAttribute('href'));expect(enquiry.hostname).toBe('wa.me');expect(enquiry.pathname).toBe('/'+salesperson.whatsapp);expect(enquiry.searchParams.get('text')).toContain(vehiclePath(vehicleA.id)+'?sales='+salesperson.user_id);
 await page.screenshot({path:info.outputPath('details-before-photos.png')});
 await page.locator('[data-book]:visible').first().click();await expect(page).toHaveURL(new RegExp('/booking.html\\?id='+vehicleA.id+'&ref=TESTCODE&sales='+salesperson.user_id));
});
test('photo timeout, retry, album order and Next/Previous preserve details',async({page,fixture},info)=>{
 await fixture({photoMode:'hold'});await page.goto(vehiclePath(vehicleA.id));await ready(page);await expect(page.locator('#photoCount')).toContainText('temporarily unavailable',{timeout:11000});
 await expect(page.locator('#model')).toHaveText('VIOS');await page.evaluate(()=>{window.__vehicleFixture.state.photoMode='ready'});await page.locator('#reloadPhotos').click();await expect(page.locator('#photoThumbs button')).toHaveCount(3);
 await page.locator('#openPhoto').click();await expect(page.locator('#photoPosition')).toHaveText('1 / 3');await page.locator('#nextPhoto').click();await expect(page.locator('#photoPosition')).toHaveText('2 / 3');await expect(page.locator('#largePhoto')).toHaveAttribute('src','/test-photo-2.svg');await page.locator('#prevPhoto').click();await expect(page.locator('#photoPosition')).toHaveText('1 / 3');await page.locator('#closePhoto').click();
 await page.evaluate(()=>window.__vehicleFixture.release('photos'));await expect(page.locator('#photoPosition')).toHaveText('1 / 3');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await page.screenshot({path:info.outputPath('album-ready.png')});
});
test('failed photos show retry guidance while vehicle remains usable',async({page,fixture})=>{
 await fixture({photoMode:'fail'});await page.goto(vehiclePath(vehicleA.id,'zh'));await ready(page);await expect(page.locator('#photoCount')).toContainText('照片暂时无法载入');await expect(page.locator('#model')).toHaveText('VIOS');await expect(page.locator('#enquire')).toHaveAttribute('href',/^https:\/\/wa.me\//);
});
test('live price and Sold override saved source, schema and application controls',async({page,fixture})=>{
 await fixture({vehicles:[{...vehicleA,price:29990,stock_status:'Sold'}]});await page.goto(vehiclePath(vehicleA.id));await ready(page);await expect(page.locator('#heroPrice')).toHaveText('RM29,990');await expect(page.locator('#publicationNote')).toHaveText('Sold');await expect(page.locator('#applyLoan')).toBeHidden();
 const schema=JSON.parse(await page.locator('#vehicleStructuredData').textContent());expect(schema.offers.price).toBe(29990);expect(schema.offers.availability).toBe('https://schema.org/SoldOut');await expect(page.locator('#inventoryNotice')).toContainText('checked just now');
});
test('showroom recovers after a failed stock refresh even when the stock has not changed',async({page,fixture})=>{
 await page.clock.install();await fixture();await page.goto('/showroom.html');
 const cards=page.locator('#galleryTrack .galleryCard'),controls=page.locator('.galleryControls'),state=page.locator('#publicState');
 await expect(cards).toHaveCount(2);await expect(cards.first().locator('img')).toHaveAttribute('src',/test-photo/);await expect(controls).toBeVisible();await expect(state).toBeHidden();
 await page.evaluate(()=>{window.__vehicleFixture.state.inventoryMode='fail'});await page.clock.fastForward(241000);
 await expect(page.locator('#resultCount')).toHaveText('Inventory temporarily unavailable');await expect(state).toBeVisible();await expect(controls).toBeHidden();
 await page.evaluate(()=>{window.__vehicleFixture.state.inventoryMode='ready'});await page.clock.fastForward(241000);
 await expect(state).toBeHidden();await expect(controls).toBeVisible();await expect(page.locator('#resultCount')).not.toHaveText('Inventory temporarily unavailable');
 await expect(cards).toHaveCount(2);await expect(cards.first().locator('img')).toHaveAttribute('src',/test-photo/);
});
test('an open page drops the photos of a vehicle moved to draft at its next 4-minute check',async({page,fixture})=>{
 await page.clock.install();await fixture();await page.goto(vehiclePath(vehicleA.id));await ready(page);await expect(page.locator('#photoThumbs button')).toHaveCount(3);
 await page.evaluate(()=>{window.__vehicleFixture.state.vehicles.find(v=>v.publication==='published').publication='draft'});
 await page.clock.runFor(200000);await expect(page.locator('#photoThumbs button')).toHaveCount(3);
 await page.clock.runFor(45000);await expect(page.locator('#photoThumbs button')).toHaveCount(0);
 await expect(page.locator('#heroImage')).not.toHaveAttribute('src',/./);await expect(page.locator('#openPhoto')).toBeHidden();
});
for(const mode of ['missing','draft','conflicting-id'])test('confirmed '+mode+' cannot show cached listing as current',async({page,fixture})=>{
 await fixture({vehicles:mode==='draft'?[{...vehicleA,publication:'draft'}]:mode==='missing'?[]:[vehicleA]});await page.goto(vehiclePath(vehicleA.id)+(mode==='conflicting-id'?'?id='+vehicleB.id:''));
 await expect(page.locator('#carMain')).toBeHidden();await expect(page.locator('#carState')).toBeVisible();await expect(page.locator('meta[name=robots]')).toHaveAttribute('content','noindex,nofollow');await expect(page.locator('#vehicleStructuredData')).toHaveCount(0);await expect(page.locator('link[rel=canonical]')).toHaveCount(0);
});
test('inventory failure retains a labelled snapshot with no live application controls',async({page,fixture})=>{
 await fixture({inventoryMode:'fail'});await page.goto(vehiclePath(vehicleA.id));await expect(page.locator('#inventoryNotice')).toContainText('could not be checked');await expect(page.locator('#model')).toHaveText('VIOS');await expect(page.locator('[data-book]').first()).toBeDisabled();await expect(page.locator('#applyLoan')).toBeHidden();await expect(page.locator('#finance')).toBeHidden();
});
test('legacy link, language, salesperson and share picker retain this vehicle',async({page,fixture})=>{
 await fixture();await page.goto('/zh/car.html?id='+vehicleA.id+'&sales='+salesperson.user_id);await ready(page);await expect(page.locator('link[rel=canonical]')).toHaveAttribute('href','https://e2auto.my'+vehiclePath(vehicleA.id,'zh'));
 await page.goto(vehiclePath(vehicleA.id,'zh')+'?sales='+salesperson.user_id);await ready(page);await expect(page.locator('[data-language=ms]')).toHaveAttribute('href',new RegExp(vehiclePath(vehicleA.id,'ms')+'\\?sales='+salesperson.user_id));
 await page.locator('#openCarShare').click();await expect(page.locator('#sharedCarURL')).toHaveValue(new RegExp(vehiclePath(vehicleA.id,'zh')+'\\?sales='+salesperson.user_id));await expect(page.locator('#shareCarContact')).toHaveValue(salesperson.user_id);expect(await page.evaluate(()=>window.__vehicleFixture.state.calls.filter(c=>c==='UNEXPECTED WRITE'))).toEqual([]);
});
test('staff invitation keeps the static vehicle identity without changing account permissions',async({page,fixture})=>{
 await fixture({staff:true});await page.goto(vehiclePath(vehicleA.id));await ready(page);await page.locator('#openCarShare').click();await expect(page.locator('#staffIntakeEntry')).toHaveAttribute('href','/intake-workspace.html?car='+vehicleA.id);
});
if(process.env.E2_TEST_BASELINE==='1')test('text-photo patch works with unchanged production routes and data adapters',async({page,fixture,context})=>{
 await fixture({photoMode:'hold'});
 for(const file of ['car.html','i18n.mjs','referral.js','vehicle-seo.mjs']){
  const source=execFileSync('git',['show','e2e32cc688bdd6472320148ce1d3fb8d3ca93f90:'+file],{encoding:'utf8',windowsHide:true});
  await context.route(new RegExp('/'+file.replace('.','\\.')+'(?:[?].*)?$'),r=>r.fulfill({contentType:file.endsWith('.html')?'text/html':'text/javascript',headers:{'Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; form-action 'none'"},body:source}));
 }
 await page.goto('/car.html?id='+vehicleA.id);await ready(page);await expect(page.locator('#carMain')).toBeVisible();await expect(page.locator('#heroPrice')).toHaveText('RM34,990');await expect(page.locator('#photoCount')).toContainText('Loading photos');await expect(page.locator('link[rel=canonical]')).toHaveAttribute('href','https://e2auto.my/car.html?id='+vehicleA.id);
});
if(process.env.E2_TEST_BASELINE==='1')test('production source comparison reproduces body waiting for photos',async({page,fixture,context},info)=>{
 const source=execFileSync('git',['show','e2e32cc688bdd6472320148ce1d3fb8d3ca93f90:car.js'],{encoding:'utf8',windowsHide:true});await fixture({photoMode:'hold'});await context.route('**/car.js?*',r=>r.fulfill({contentType:'text/javascript',body:source}));await page.goto('/car.html?id='+vehicleA.id);
 await expect.poll(()=>page.evaluate(()=>window.__vehicleFixture.state.calls.includes('photos'))).toBe(true);await expect(page.locator('#carMain')).toBeHidden();await expect(page.locator('#carState')).toContainText('Loading');await page.screenshot({path:info.outputPath('baseline-waits-for-photos.png')});await page.evaluate(()=>window.__vehicleFixture.release('photos'));await expect(page.locator('#model')).toHaveText('VIOS');
});
