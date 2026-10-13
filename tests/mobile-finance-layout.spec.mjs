import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {localizedPage} from '../scripts/build-languages.mjs';
import {vehicleA,vehicleB,salesperson,initializeVehicle,vehicleSDK,syntheticConfig,photoSVG} from './fixtures/vehicle-loading.mjs';
const car={...vehicleA,brand:'MAZDA',model:'CX-5',variant:'HIGH GLS',year:2017,plate:'VHJ6741',price:55990};
async function open(page,baseURL,{width=390,lang='en',textScale=1,price=55990,status='Available'}={}){
 const external=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setViewportSize({width,height:900});
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.route('**/*',async route=>{const url=new URL(route.request().url());
  if(url.origin===new URL(baseURL).origin){
   if(url.pathname==='/e2-config.js')return route.fulfill({contentType:'text/javascript',body:syntheticConfig});
   const photo=/^\/test-photo-([123])\.svg$/.exec(url.pathname);if(photo)return route.fulfill({contentType:'image/svg+xml',body:photoSVG(Number(photo[1]))});
   const localized=/^\/(ms|zh)\/car\.html$/.exec(url.pathname);if(localized)return route.fulfill({contentType:'text/html',body:localizedPage(await readFile(new URL('../car.html',import.meta.url),'utf8'),'car.html',localized[1])});
   return route.continue();
  }
  if(url.href==='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.4/+esm')return route.fulfill({contentType:'text/javascript',body:vehicleSDK});
  if(url.origin==='https://synthetic-vehicle.supabase.co'&&route.request().method()==='GET'){
   if(url.pathname==='/rest/v1/staff_profiles')return route.fulfill({json:[salesperson]});
   if(url.pathname==='/rest/v1/vehicles')return route.fulfill({json:[car,{...vehicleB,price:9999999,year:2026,brand:'Synthetic related vehicle',model:'Long name model'}]});
  }
  external.push(url.href);return route.abort();
 });
 await page.addInitScript(initializeVehicle,{vehicles:[{...car,price,stock_status:status},{...vehicleB,price:9999999}],photoMode:'ready'});
 await page.goto((lang==='en'?'/':'/'+lang+'/')+'car.html?id='+car.id);
 await expect(page.locator('#monthlyLink')).not.toBeEmpty();
 if(textScale!==1)await page.addStyleTag({content:`html{font-size:${16*textScale}px!important}`});
 return {external,errors};
}
async function bounds(page){return page.locator('.heroPrice').evaluate(panel=>{
 const pick=node=>{if(!node||getComputedStyle(node).display==='none')return null;const r=node.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height,text:node.textContent,scrollWidth:node.scrollWidth,clientWidth:node.clientWidth};};
 return {panel:pick(panel),price:pick(panel.querySelector('strong')),monthly:pick(document.querySelector('#monthlyLink')),plate:pick(document.querySelector('#heroPlate')),application:pick(document.querySelector('#applyLoan'))};
});}
test('reported English 390px case: estimate and application occupy separate rows',async({page,baseURL},info)=>{
 await open(page,baseURL);const boxes=await bounds(page);await info.attach('layout.json',{body:JSON.stringify(boxes,null,2),contentType:'application/json'});await page.locator('.heroTitle').screenshot({path:info.outputPath('price-and-finance.png')});
 expect(boxes.application.y,'application must begin below the estimate').toBeGreaterThanOrEqual(boxes.monthly.bottom+1);
});
for(const width of [320,375,390,430])for(const lang of ['en','ms','zh'])for(const textScale of [1,2])for(const price of [55990,9999999]){
 test(`${width}px ${lang} text ${textScale*100}% price ${price}`,async({page,baseURL},info)=>{
  const {external,errors}=await open(page,baseURL,{width,lang,textScale,price});const b=await bounds(page);
  expect(b.application.y).toBeGreaterThanOrEqual(b.monthly.bottom+1);
  expect(b.monthly.y).toBeGreaterThanOrEqual(Math.max(b.price.bottom,b.plate.bottom)+1);
  for(const [name,r]of Object.entries(b)){if(!r)continue;expect(r.x,name+' left edge').toBeGreaterThanOrEqual(b.panel.x-1);expect(r.right,name+' right edge').toBeLessThanOrEqual(b.panel.right+1);if(['monthly','application','price'].includes(name))expect(r.scrollWidth,name+' content width').toBeLessThanOrEqual(r.clientWidth+1);}
  const r=await page.locator('#monthlyLink').getAttribute('href');expect(r).toBe('#finance');expect(await page.locator('#applyLoan').getAttribute('href')).toContain('my-e2.html?car='+car.id);
  expect(await page.locator('#heroPrice').textContent()).toBe('RM'+price.toLocaleString('en-MY'));
  const monthly=price*.9*(1+.035*5)/60;expect((await page.locator('#monthly').textContent()).replace(/\s/g,'')).toContain('RM'+monthly.toLocaleString('en-MY',{minimumFractionDigits:2,maximumFractionDigits:2}));
  const related=page.locator('.relatedCard').first();await expect(related).toBeVisible();
  const relatedSize=await related.evaluate(node=>({width:node.clientWidth,scroll:node.scrollWidth}));expect(relatedSize.scroll).toBeLessThanOrEqual(relatedSize.width+1);
  if(width===320&&textScale===2&&price===9999999){await page.setViewportSize({width,height:1800});await info.attach('layout.json',{body:JSON.stringify(b,null,2),contentType:'application/json'});await page.locator('.heroPrice').screenshot({path:info.outputPath('price-and-finance-'+lang+'-320-large.png')});await page.setViewportSize({width,height:900});}
  await page.locator('#monthlyLink').evaluate(node=>node.scrollIntoView({block:'center',behavior:'instant'}));
  // Mobile Chromium may pan its visual viewport at enlarged text sizes.
  // Hit-test in layout coordinates, then send a real pointer in viewport coordinates.
  const target=await page.locator('#monthlyLink').evaluate(node=>{const r=node.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;return {x:(x-visualViewport.offsetLeft)*visualViewport.scale,y:(y-visualViewport.offsetTop)*visualViewport.scale,hit:document.elementFromPoint(x,y)?.id,viewport:{width:innerWidth,height:innerHeight,visualWidth:visualViewport.width,visualHeight:visualViewport.height,offsetTop:visualViewport.offsetTop,scale:visualViewport.scale}}});
  await info.attach('click-target.json',{body:JSON.stringify(target),contentType:'application/json'});
  expect(target.hit).toBe('monthlyLink');await page.mouse.click(target.x,target.y);await expect(page).toHaveURL(/#finance$/);
  expect(external).toEqual([]);expect(errors).toEqual([]);expect(await page.evaluate(()=>window.__vehicleFixture.state.calls.filter(c=>c==='UNEXPECTED WRITE'))).toEqual([]);
 });
}
for(const status of ['Reserved','Sold'])test(status+' hidden application leaves a single estimate row',async({page,baseURL})=>{await open(page,baseURL,{width:320,status});await expect(page.locator('#applyLoan')).toBeHidden();const b=await bounds(page);expect(b.monthly.y).toBeGreaterThanOrEqual(b.price.bottom);});
test('desktop price panel and related cards remain readable',async({page,baseURL})=>{await open(page,baseURL,{width:1280});await expect(page.locator('.relatedCard').first()).toBeVisible();const b=await bounds(page);expect(b.application.y).toBeGreaterThanOrEqual(b.monthly.bottom);const card=await page.locator('.relatedCard').first().evaluate(node=>({width:node.clientWidth,scroll:node.scrollWidth}));expect(card.scroll).toBeLessThanOrEqual(card.width+1);});
