import {chromium,expect} from '@playwright/test';
import {readFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {extname,join,resolve} from 'node:path';
import assert from 'node:assert/strict';
import {renderCarLoan} from '../scripts/build-car-loan.mjs';
import {localizedPage} from '../scripts/build-languages.mjs';
import {carLoanPath} from '../car-loan-copy.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),origin='http://car-loan.test';
const home=await readFile(join(root,'index.html'),'utf8'),shots=process.env.PLAYWRIGHT_SCREENSHOT_DIR||'test-results/car-loan';
await mkdir(shots,{recursive:true});
const browser=await chromium.launch(process.platform==='win32'?{channel:'msedge'}:{});
try{
 for(const width of [390,1440])for(const lang of ['en','ms','zh']){
  const ctx=await browser.newContext({viewport:{width,height:1000},isMobile:width===390}),page=await ctx.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await ctx.route('**/*',async route=>{
   const u=new URL(route.request().url());if(u.origin!==origin)return route.abort();
   // Only isolate unrelated auth and inventory transports; calculator and language modules are real.
   if(['/customer-nav.js','/showroom.js','/showroom-flow.js'].includes(u.pathname))return route.fulfill({contentType:'text/javascript',body:''});
   const l=u.pathname.startsWith('/ms/')?'ms':u.pathname.startsWith('/zh/')?'zh':'en';
   if(u.pathname===carLoanPath(l))return route.fulfill({contentType:'text/html',body:renderCarLoan(home,l)});
   if(['/','/ms/','/zh/'].includes(u.pathname))return route.fulfill({contentType:'text/html',body:l==='en'?home:localizedPage(home,'index.html',l)});
   let p=decodeURIComponent(u.pathname).replace(/^\/(ms|zh)\//,'/');const file=resolve(root,'.'+p);
   if(!file.startsWith(root))return route.abort();
   try{const body=await readFile(file);await route.fulfill({body,contentType:({'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.webp':'image/webp','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2'})[extname(file)]||'application/octet-stream'});}catch{await route.fulfill({status:404,body:'Not found'});}
  });
  await page.goto(origin+carLoanPath(lang));
  await expect(page.locator('#cl-monthly')).toHaveText(/666\.96/);
  await expect(page.locator('[data-language]')).toHaveCount(3);
  await expect(page.locator('#cl-form')).not.toHaveAttribute('aria-current');
  for(const target of ['en','ms','zh'])await expect(page.locator('a[data-language='+target+']')).toHaveAttribute('href',new RegExp(carLoanPath(target)+'$'));
  await page.locator('[name=price]').fill('100000');await page.locator('[name=deposit]').fill('10000');
  await page.locator('button[type=submit]').click();await expect(page.locator('#cl-monthly')).toHaveText(/1,333\.93/);
  await page.locator('[name=deposit]').fill('100001');await expect(page.locator('#cl-result')).toBeHidden();await expect(page.locator('#cl-error')).toBeVisible();
  await page.locator('[name=deposit]').fill('0');await page.locator('[name=rate]').fill('0');await page.locator('[name=years]').selectOption('1');
  await expect(page.locator('#cl-monthly')).toHaveText(/8,333\.33/);
  await page.locator('[name=price]').fill('');await expect(page.locator('#cl-result')).toBeHidden();
  await page.locator('button[type=reset]').click();await expect(page.locator('#cl-monthly')).toHaveText(/666\.96/);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'No horizontal overflow');
  await page.screenshot({path:join(shots,`loan-${lang}-${width}.png`),fullPage:true});
  const target=lang==='zh'?'ms':'zh';await page.locator('[data-language='+target+']').click();
  await expect(page).toHaveURL(origin+carLoanPath(target));await expect(page.locator('#cl-monthly')).toHaveText(/666\.96/);
  assert.deepEqual(errors,[]);
  await ctx.close();
 }
 console.log('PASS calculator results, invalid inputs, reset, language switching and layout: 3 languages × desktop/mobile.');
}finally{await browser.close()}
