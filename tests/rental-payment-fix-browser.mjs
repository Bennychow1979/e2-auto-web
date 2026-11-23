// Payment records can be edited (old values kept) or voided (kept on record, renumbered, excluded from counts) — never deleted.
import {chromium,expect} from '@playwright/test';
import {readFile,mkdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import assert from 'node:assert/strict';
const files={'/workspace-theme.css':'workspace-theme.css','/rental-stock.mjs':'rental-stock.mjs','/rental.html':'rental.html','/rental.js':'rental.js','/rental.css':'rental.css','/rental-data.mjs':'rental-data.mjs','/e2-data.js':'tests/fixtures/rental-sdk.mjs'};
const server=createServer(async(req,res)=>{const p=new URL(req.url,'http://localhost').pathname;
 if(p==='/e2-config.js'){res.setHeader('Content-Type','text/javascript');res.end('');return;}
 if(!files[p]){res.writeHead(404);res.end();return;}
 res.setHeader('Content-Type',p.endsWith('.html')?'text/html':p.endsWith('.css')?'text/css':'text/javascript');res.end(await readFile(files[p]));
});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
let browser;const errors=[];
const snap=page=>page.evaluate(()=>rentalFixture.snapshot().contracts[0].data);
try{
 browser=await chromium.launch(process.platform==='win32'?{channel:'msedge'}:{});await mkdir('test-results',{recursive:true});
 for(const [name,width,height] of [['desktop',1440,1000],['mobile',390,844]]){
  const context=await browser.newContext({viewport:{width,height},timezoneId:'Asia/Kuala_Lumpur'});
  await context.route('**/*',route=>new URL(route.request().url()).origin!==origin?route.abort():route.continue());
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/rental.html?role=super_admin');
  await expect(page.locator('#rentalStatus')).toContainText('已读取 1 台');
  await page.locator('tr[data-id="DEMO1"] b').first().click();
  // Log two payments: the second is a double key-in.
  for(const amt of ['1175','1175']){await page.locator('#p_amt').fill(amt);await page.locator('#btnPay').click();await expect(page.locator('#toast')).toContainText('已记录');await expect(page.locator('#toast')).not.toHaveClass(/show/);}
  let d=await snap(page);assert.equal(d.payments.length,2);assert.deepEqual(d.payments.map(p=>p.seq),[1,2]);
  await expect(page.locator('#panel')).toContainText('记录第 3 期付款');
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),name+' page overflow');
  await page.screenshot({path:`test-results/payfix-${name}-rows.png`});
  // Edit payment #1: wrong amount → 1127, keep old value in log.
  await page.locator('#pr_0 button',{hasText:'编辑'}).click();await expect(page.locator('#ep_0_amount')).toHaveValue('1175');
  await page.screenshot({path:`test-results/payfix-${name}-edit.png`});
  await page.locator('#ep_0_amount').fill('1127');await page.locator('#ep_0_note').fill('keyed wrong amount');await page.locator('#pr_0 button',{hasText:'保存'}).click();await expect(page.locator('#toast')).toContainText('已修改付款');
  d=await snap(page);assert.equal(d.payments[0].amount,1127);assert.equal(d.payments[0].note,'KEYED WRONG AMOUNT');assert.equal(d.payments[0].edit_log[0].before.amount,1175);assert.equal(d.payments[0].edit_log[0].before.note,'');assert.match(d.history.at(-1).action,/修改第 1 期付款: amount 1175→1127/);
  await expect(page.locator('#pr_0')).toContainText('原本 was: amount=1175');
  // Edit with no change → no write.
  await page.locator('#pr_0 button',{hasText:'编辑'}).click();await page.locator('#pr_0 button',{hasText:'保存'}).click();await expect(page.locator('#toast')).toContainText('没有改动');assert.equal((await snap(page)).history.length,d.history.length);
  // Void payment #2 (double key-in): reason required, record kept, count drops, next instalment becomes #2.
  await page.locator('#pr_1 button',{hasText:'作废'}).click();await page.locator('#pr_1 button',{hasText:'确定'}).click();await expect(page.locator('#toast')).toContainText('Reason required');
  await page.locator('#vp_1_reason').fill('double key in');await page.locator('#pr_1 button',{hasText:'确定'}).click();await expect(page.locator('#toast')).toContainText('已作废');
  d=await snap(page);assert.equal(d.payments.length,2);assert.equal(d.payments[1].void,true);assert.equal(d.payments[1].void_reason,'DOUBLE KEY IN');assert.equal(d.payments[1].seq,2);assert.match(d.history.at(-1).action,/作废第 2 期付款 RM1,175/);
  await expect(page.locator('#pr_1')).toContainText('作废 VOID');await expect(page.locator('#pr_1')).toContainText('DOUBLE KEY IN');await expect(page.locator('#pr_1 button')).toHaveCount(0);
  await expect(page.locator('#panel')).toContainText('记录第 2 期付款');await expect(page.locator('#panel')).toContainText('1 期');
  await expect(page.locator('#toast')).not.toHaveClass(/show/);await page.screenshot({path:`test-results/payfix-${name}-void.png`});
  // New payment after the void takes #2; the voided row still shows.
  await page.locator('#p_amt').fill('1127');await page.locator('#btnPay').click();await expect(page.locator('#toast')).toContainText('第 2 期');
  d=await snap(page);assert.deepEqual(d.payments.map(p=>[p.seq,!!p.void]),[[1,false],[2,true],[2,false]]);
  await expect(page.locator('#panel')).toContainText('记录第 3 期付款');
  // Office admin (not super admin) can also fix payments; the audit name is theirs.
  await context.close();
  const ctx2=await browser.newContext({viewport:{width,height}});await ctx2.route('**/*',route=>new URL(route.request().url()).origin!==origin?route.abort():route.continue());
  const p2=await ctx2.newPage();p2.on('pageerror',e=>errors.push(e.message));await p2.goto(origin+'/rental.html?role=office_admin');await expect(p2.locator('#rentalStatus')).toContainText('已读取 1 台');
  await p2.locator('tr[data-id="DEMO1"] b').first().click();await p2.locator('#p_amt').fill('500');await p2.locator('#btnPay').click();await expect(p2.locator('#toast')).toContainText('已记录');
  await expect(p2.locator('#pr_0 button',{hasText:'编辑'})).toBeVisible();
  await p2.locator('#pr_0 button',{hasText:'作废'}).click();await p2.locator('#vp_0_reason').fill('test');await p2.locator('#pr_0 button',{hasText:'确定'}).click();await expect(p2.locator('#toast')).toContainText('已作废');
  const d2=await snap(p2);assert.equal(d2.payments[0].void_by,'demo@example.test');
  await ctx2.close();
 }
 assert.deepEqual(errors,[]);
 console.log('PASS payment fix: edit keeps old values and logs, no-change edit is a no-op, void requires reason, keeps the row, renumbers and recounts, office admin can fix too (desktop/mobile)');
}finally{await browser?.close();server.close();}
