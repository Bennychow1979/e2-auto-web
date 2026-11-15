import {chromium,expect} from '@playwright/test';
import {readFile,mkdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import assert from 'node:assert/strict';
const files={'/rental.html':'rental.html','/rental.js':'rental.js','/rental.css':'rental.css','/rental-data.mjs':'rental-data.mjs','/e2-data.js':'tests/fixtures/rental-sdk.mjs'};
const server=createServer(async(req,res)=>{const p=new URL(req.url,'http://localhost').pathname;
 if(p==='/e2-config.js'){res.setHeader('Content-Type','text/javascript');res.end('');return;}
 if(!files[p]){res.writeHead(404);res.end();return;}
 res.setHeader('Content-Type',p.endsWith('.html')?'text/html':p.endsWith('.css')?'text/css':'text/javascript');res.end(await readFile(files[p]));
});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
let browser;const errors=[],external=[];
try{
 browser=await chromium.launch(process.platform==='win32'?{channel:'msedge'}:{});await mkdir('test-results',{recursive:true});
 for(const [name,width,height,role] of [['desktop',1440,1000,'super_admin'],['mobile',390,844,'office_admin'],['denied',1280,800,'admin'],['anonymous',390,844,'anon']]){
  const context=await browser.newContext({viewport:{width,height},timezoneId:'Asia/Kuala_Lumpur'});
  await context.route('**/*',route=>{if(new URL(route.request().url()).origin!==origin){external.push(route.request().url());return route.abort();}return route.continue();});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/rental.html?role='+role);
  if(['admin','anon'].includes(role)){
   await expect(page.locator('#login')).toBeVisible();await expect(page.locator('#app')).toBeHidden();await expect(page.locator('body')).not.toContainText('SYNTHETIC OWNER');assert.equal(await page.evaluate(()=>rentalFixture.snapshot().reads),0);
  }else{
   await expect(page.locator('#rentalStatus')).toContainText('已读取 1 台');await expect(page.locator('#rows')).toContainText('DEMO1');
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),name+' page overflow');
   if(role==='super_admin'){await page.locator('#btnAccess').click();await expect(page.locator('#panel')).toContainText('office@example.test');await page.locator('#closeAccess').click();}else await expect(page.locator('#btnAccess')).toBeHidden();
   await page.locator('tr[data-id="DEMO1"] b').first().click();await expect(page.locator('#p_date')).toBeVisible();await expect(page.locator('#panel')).toContainText('12/08/2026');
   await page.locator('#p_amt').fill('500');await page.locator('#btnPay').click();await expect.poll(()=>page.evaluate(()=>rentalFixture.snapshot().contracts[0].data.payments.length)).toBe(1);
   await expect(page.locator('#panel')).toContainText('instalment #2');
   await page.evaluate(()=>rentalFixture.conflict());await page.locator('#btnPay').click();await expect(page.locator('#toast')).toContainText('Record changed');assert.equal(await page.evaluate(()=>rentalFixture.snapshot().contracts[0].data.payments.length),1);
   await page.evaluate(()=>{closeDrawer();window.scrollTo(0,0);document.querySelector('#toast').classList.remove('show');});await page.screenshot({path:'test-results/rental-'+name+'.png',fullPage:true});
   await page.evaluate(()=>rentalFixture.revoke());await expect(page.locator('#app')).toBeHidden();await expect(page.locator('#rows')).toBeEmpty();await expect(page.locator('#panel')).toBeEmpty();
  }
  await context.close();
 }
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);console.log('PASS rental desktop/mobile, staff gates, access controls, payment save/conflict, revocation and private UI clearing');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
