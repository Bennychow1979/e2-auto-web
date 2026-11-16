import {chromium,expect} from '@playwright/test';
import {readFile,mkdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import assert from 'node:assert/strict';
const files={'/rental.html':'rental.html','/rental.js':'rental.js','/rental.css':'rental.css','/rental-data.mjs':'rental-data.mjs','/rental-stock.mjs':'rental-stock.mjs','/e2-data.js':'tests/fixtures/rental-sdk.mjs'};
const server=createServer(async(req,res)=>{
 const path=new URL(req.url,'http://localhost').pathname;
 if(path==='/e2-config.js'){res.setHeader('Content-Type','text/javascript');res.end('');return;}
 if(!files[path]){res.writeHead(404);res.end();return;}
 res.setHeader('Content-Type',path.endsWith('.html')?'text/html':path.endsWith('.css')?'text/css':'text/javascript');res.end(await readFile(files[path]));
});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
let browser;const errors=[];
try{
 browser=await chromium.launch();await mkdir('test-results',{recursive:true});
 for(const [name,width,role] of [['desktop',1440,'super_admin'],['mobile',390,'office_admin']]){
  const context=await browser.newContext({viewport:{width,height:900}});
  await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.clock.install();await page.goto(origin+'/rental.html?role='+role);
  await expect(page.locator('#rentalStatus')).toContainText('已读取 1 台');await page.locator('#btnAdd').click();
  await expect(page.locator('#stockResults button')).toHaveCount(4);
  await expect(page.locator('#stockResults')).not.toContainText('ARCHIVED1');await expect(page.locator('#stockResults img')).toHaveCount(0);
  await page.locator('#stockPlate').fill('demo');await expect(page.locator('#stockResults button')).toBeDisabled();
  await page.locator('#stockPlate').fill('abc 12');await expect(page.locator('#stockResults button')).toHaveCount(1);
  await page.locator('#stockResults button').click();await expect(page.locator('#f_plate')).toHaveValue('ABC1234');
  await expect(page.locator('#f_brand')).toHaveValue('HONDA');await expect(page.locator('#f_model')).toHaveValue('CITY V');await expect(page.locator('#f_year')).toHaveValue('2021');
  await expect(page.locator('#f_loan_amount')).toHaveValue('');
  await page.locator('#f_owner_name').fill('MY OWNER');await page.locator('#f_loan_amount').fill('24000');
  await page.locator('#stockPlate').fill('5678');await page.locator('#stockResults button').click();
  await expect(page.locator('#f_plate')).toHaveValue('XYZ5678');await expect(page.locator('#f_owner_name')).toHaveValue('MY OWNER');await expect(page.locator('#f_loan_amount')).toHaveValue('24000');
  await page.locator('#stockPlate').fill('ABC1234');await page.locator('#stockResults button').click();
  await page.clock.runFor(16000);await page.evaluate(()=>rentalFixture.refresh());await expect(page.locator('#f_plate')).toHaveValue('ABC1234');
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'stock picker overflow');
  await page.locator('#stockPickerTitle').scrollIntoViewIfNeeded();
  await page.screenshot({path:'test-results/rental-stock-'+name+'.png',fullPage:true});
  await page.locator('#f_owner_phone').fill('0123456789');await page.locator('#f_agent').selectOption('DEMO AGENT');await page.locator('#f_financier').selectOption('DEMO');
  await page.locator('#f_account_no').fill('12345678');await page.locator('#f_monthly').fill('500');await page.locator('#f_tenure').fill('60');await page.locator('#f_first_payment_date').fill('2026-11-16');
  await page.locator('#btnSave').click();await expect.poll(()=>page.evaluate(()=>rentalFixture.snapshot().contracts.length)).toBe(2);
  const saved=await page.evaluate(()=>rentalFixture.snapshot().contracts.find(r=>r.id==='ABC1234'));
  assert.equal(saved.data.stock_vehicle_id,'stock-1234');assert.equal(saved.data.model,'CITY V');assert.equal(saved.data.owner_name,'MY OWNER');
  await page.locator('#btnAdd').click();await page.locator('#stockPlate').fill('ABC');await expect(page.locator('#stockResults button')).toBeDisabled();
  await page.locator('#stockPlate').fill('missing');await expect(page.locator('#stockStatus')).toContainText('没有匹配');
  await page.locator('#f_plate').fill('MANUAL9');await expect(page.locator('#f_plate')).toHaveValue('MANUAL9');
  await page.evaluate(()=>{closeDrawer();closeDrawer();rentalFixture.stockError(true);document.querySelector('#btnAdd').click();});
  await expect(page.locator('#stockRetry')).toBeVisible();await page.locator('#f_owner_name').fill('KEEP MANUAL DRAFT');
  await page.evaluate(()=>rentalFixture.stockError(false));await page.locator('#stockRetry').click();await expect(page.locator('#stockResults button')).toHaveCount(4);
  await expect(page.locator('#f_owner_name')).toHaveValue('KEEP MANUAL DRAFT');
  // A late inventory read cannot overwrite another panel or bring data back after sign-out.
  await page.evaluate(()=>{closeDrawer();closeDrawer();rentalFixture.holdStock();document.querySelector('#btnAdd').click();});
  await expect(page.locator('#stockStatus')).toContainText('Loading');await page.evaluate(()=>{closeDrawer();document.querySelector('#btnSettings').click();rentalFixture.releaseStock();});
  await expect(page.locator('#s_agent')).toBeVisible();await expect(page.locator('#stockResults')).toHaveCount(0);
  await page.evaluate(()=>{closeDrawer();rentalFixture.holdStock();document.querySelector('#btnAdd').click();});
  await expect(page.locator('#stockStatus')).toContainText('Loading');
  await page.evaluate(()=>{document.querySelector('#btnOut').click();rentalFixture.releaseStock();});
  await expect(page.locator('#app')).toBeHidden();await expect(page.locator('#panel')).toBeEmpty();
  await context.close();
 }
 assert.deepEqual(errors,[]);console.log('PASS stock plate selection, save/link, duplicate prevention, manual fallback, draft preservation, errors/retry and late-response clearing (desktop/mobile)');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
