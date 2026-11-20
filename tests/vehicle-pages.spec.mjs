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

test('matched static cover keeps its URL and manual retry restores the signed route',async({page,fixture})=>{
 await fixture({inventoryMode:'hold'});await page.goto(vehiclePath(vehicleA.id));
 const initial=await page.locator('#heroImage').getAttribute('src');
 await page.evaluate(id=>{document.documentElement.dataset.publicPhotoId=id+'-1';window.__vehicleFixture.state.inventoryMode='ready';window.__vehicleFixture.release('inventory');},vehicleA.id);
 await ready(page);await expect(page.locator('#photoThumbs button')).toHaveCount(3);
 await expect(page.locator('#heroImage')).toHaveAttribute('src',initial);
 await expect(page.locator('#largePhoto')).not.toHaveAttribute('src',/./);
 await page.locator('#openPhoto').click();await expect(page.locator('#largePhoto')).toHaveAttribute('src',initial);await page.locator('#closePhoto').click();
 await page.locator('#reloadPhotos').click();await expect(page.locator('#heroImage')).toHaveAttribute('src','/test-photo-1.svg');
});
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
 await expect(cards).toHaveCount(2);await expect(cards.first().locator('img')).toHaveAttribute('src',/public_vehicle=/);await expect.poll(()=>cards.first().locator('img').evaluate(n=>n.naturalWidth)).toBeGreaterThan(0);await expect(controls).toBeVisible();await expect(state).toBeHidden();
 await page.evaluate(()=>{window.__vehicleFixture.state.inventoryMode='fail'});await page.clock.fastForward(241000);
 await expect(page.locator('#resultCount')).toHaveText('Inventory temporarily unavailable');await expect(state).toBeVisible();await expect(controls).toBeHidden();
 await page.evaluate(()=>{window.__vehicleFixture.state.inventoryMode='ready'});await page.clock.fastForward(241000);
 await expect(state).toBeHidden();await expect(controls).toBeVisible();await expect(page.locator('#resultCount')).not.toHaveText('Inventory temporarily unavailable');
 await expect(cards).toHaveCount(2);await expect(cards.first().locator('img')).toHaveAttribute('src',/public_vehicle=/);await expect.poll(()=>cards.first().locator('img').evaluate(n=>n.naturalWidth)).toBeGreaterThan(0);
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

for(const [lang,path] of Object.entries({en:'/car-insurance-calculator/',ms:'/ms/kalkulator-insurans-kereta/',zh:'/zh/car-insurance-calculator/'})){
 test('insurance '+lang+' accepts owner examples and switches to the matching language route',async({page,fixture},info)=>{
  await fixture();await page.goto(path);
  await expect(page.locator('header.galleryNav')).toBeVisible();await expect(page.locator('footer.demoFooter')).toBeAttached();
  await expect(page.locator('#in-empty')).toBeVisible();await expect(page.locator('#in-result')).toBeHidden();
  await page.locator('#in-region').selectOption('pen');await page.locator('#in-ncd').selectOption('55');await page.locator('#in-si').fill('99990');await page.locator('#in-cc').fill('2494');
  await expect(page.locator('#in-total')).toHaveText('RM2,316.05');
  await expect(page.locator('#in-split')).toContainText('RM1,442.05');await expect(page.locator('#in-split')).toContainText('RM874.00');
  await page.locator('input[name=body][value=non]').check();await expect(page.locator('#in-total')).toHaveText('RM2,277.25');
  await expect(page.locator('#in-split')).toContainText('RM835.20');
  await page.locator('#in-region').selectOption('em');await expect(page.locator('#in-total')).toHaveText('RM1,576.59');
  await expect(page.locator('#in-steps .hd')).toHaveText([/RM1,116.23/,/RM460.36/]);
  const roadtax=await page.context().newPage();await roadtax.goto((lang==='en'?'':'/'+lang)+'/roadtax-calculator/');
  for(const region of ['pen','em','lgk','lbn'])for(const body of ['sal','non'])for(const owner of ['ind','co']){
   await page.locator('#in-region').selectOption(region);await page.locator('input[name=body][value='+body+']').check();await page.locator('input[name=owner][value='+owner+']').check();
   const tax=await roadtax.evaluate(({region,body,owner})=>'RM'+window.E2RT.ice(region,body,owner,2494).total.toLocaleString('en-MY',{minimumFractionDigits:2,maximumFractionDigits:2}),{region,body,owner});
   await expect(page.locator('#in-steps .hd').last()).toContainText(tax);await expect(page.locator('#in-split')).toContainText(tax);
  }
  await roadtax.close();
  await page.locator('#in-region').selectOption('pen');await page.locator('input[name=body][value=sal]').check();await page.locator('input[name=owner][value=ind]').check();
  await page.locator('#in-cc').fill('1468');await page.locator('#in-ncd').selectOption('25');await page.locator('input[name=cover][value=tp]').check();
  await expect(page.locator('#in-total')).toHaveText('RM209.35');await expect(page.locator('#in-split')).toContainText('RM119.35');await expect(page.locator('#in-si-box')).toBeHidden();
  await page.locator('input[name=cover][value=comp]').check();await page.locator('#in-cc').fill('2494');await page.locator('#in-ncd').selectOption('55');
  await expect(page.locator('#in-total')).toHaveText('RM2,316.05');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.screenshot({path:info.outputPath('insurance-'+lang+'.png'),fullPage:true});
  const target=lang==='ms'?'zh':'ms',destination=target==='ms'?'/ms/kalkulator-insurans-kereta/':'/zh/car-insurance-calculator/';
  await page.locator('header [data-language='+target+']').click();await expect(page).toHaveURL(new RegExp(destination+'$'));
  await expect(page.locator('#in-form')).toBeVisible();
 });
 test('insurance '+lang+' exposes rates and FAQ without JavaScript',async({browser,baseURL},info)=>{
  const context=await browser.newContext({javaScriptEnabled:false,viewport:info.project.use.viewport});const page=await context.newPage();await page.goto(baseURL+path);
  await expect(page.locator('.rt table')).toHaveCount(3);await expect(page.locator('.rt details')).toHaveCount(4);
  await expect(page.locator('link[rel=canonical]')).toHaveAttribute('href','https://e2auto.my'+path);
  await page.locator('.rt summary').first().click();await expect(page.locator('.rt details').first().locator('p')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await context.close();
 });
}

for(const lang of ['en','ms','zh'])test('responsive '+lang+' showroom covers and view toggle',async({page,fixture})=>{
 await fixture();await page.goto((lang==='en'?'':'/'+lang)+'/showroom.html');
 await expect(page.locator('#filterResults [data-public-cover]').first()).toBeVisible();
 await expect(page.locator('#filterResults img').first()).toHaveAttribute('srcset',/width=400/);
 const image=page.locator('#filterResults img').first();await expect(image).toHaveJSProperty('complete',true);
 expect(await image.evaluate(n=>n.naturalWidth>0)).toBe(true);
 await page.locator('[data-inventory-view="cards"]').click();
 await expect(page.locator('[data-inventory-view="cards"]')).toHaveAttribute('aria-pressed','true');
 await expect(image).toHaveAttribute('srcset',/width=1280/);
 expect(await image.evaluate(n=>getComputedStyle(n).objectFit)).toBe('contain');
 await page.locator('[data-inventory-view="list"]').click();
 await expect(page.locator('[data-inventory-view="list"]')).toHaveAttribute('aria-pressed','true');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});

for(const lang of ['en','ms','zh'])test('category '+lang+' guide remains readable without JavaScript',async({browser,baseURL},info)=>{
 const context=await browser.newContext({javaScriptEnabled:false,viewport:info.project.use.viewport});
 try{
  await context.route('https://synthetic-vehicle.supabase.co/**',route=>route.fulfill({contentType:'image/svg+xml',body:photoSVG(1)}));
  const page=await context.newPage();await page.goto(baseURL+(lang==='en'?'':'/'+lang)+'/used-cars/test-toyota/');
  const guide=page.locator('.categoryGuide');await expect(guide).toBeVisible();
  const gridBox=await page.locator('.discoveryGrid').boundingBox(),guideBox=await guide.boundingBox();expect(guideBox.y).toBeGreaterThanOrEqual(gridBox.y+gridBox.height);
  await expect(guide.locator('details')).toHaveCount(3);await guide.locator('summary').first().click();await expect(guide.locator('details').first().locator('p')).toBeVisible();
  await expect(page.locator('link[rel=canonical]')).toHaveAttribute('href','https://e2auto.my'+(lang==='en'?'':'/'+lang)+'/used-cars/test-toyota/');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.screenshot({path:info.outputPath('category-'+lang+'.png'),fullPage:true});
 }finally{await context.close();}
});

test('showroom public-cover failure falls back to signed images without stale responsive sources',async({page,fixture,context})=>{
 await fixture();await context.route('https://synthetic-vehicle.supabase.co/functions/v1/e2-drive-photos?*',route=>route.abort());
 await page.goto('/showroom.html');
 for(const selector of ['#galleryTrack .galleryCard img','#filterResults img']){
  const image=page.locator(selector).first();await expect(image).toHaveAttribute('src',/test-photo/);
  await expect(image).not.toHaveAttribute('srcset',/./);await expect.poll(()=>image.evaluate(n=>n.naturalWidth)).toBeGreaterThan(0);
 }
});
