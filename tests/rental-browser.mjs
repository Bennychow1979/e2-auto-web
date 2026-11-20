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
let browser;const errors=[],external=[];
try{
 browser=await chromium.launch(process.platform==='win32'?{channel:'msedge'}:{});await mkdir('test-results',{recursive:true});
 for(const [name,width,height,role] of [['desktop',1440,1000,'super_admin'],['mobile',390,844,'office_admin'],['denied',1280,800,'admin'],['anonymous',390,844,'anon']]){
  const context=await browser.newContext({viewport:{width,height},timezoneId:'Asia/Kuala_Lumpur'});
  await context.route('**/*',route=>{if(new URL(route.request().url()).origin!==origin){external.push(route.request().url());return route.abort();}return route.continue();});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.clock.install();await page.goto(origin+'/rental.html?role='+role);
  if(['admin','anon'].includes(role)){
   await expect(page.locator('#login')).toBeVisible();await expect(page.locator('#app')).toBeHidden();await expect(page.locator('body')).not.toContainText('SYNTHETIC OWNER');assert.equal(await page.evaluate(()=>rentalFixture.snapshot().reads),0);await expect(page.locator('#returnDashboard')).toBeHidden();
  }else{
   await expect(page.locator('#rentalStatus')).toContainText('已读取 1 台');await expect(page.locator('#who')).toHaveText(role==='super_admin'?'Demo Manager':'demo@example.test');if(role==='super_admin')await expect(page.locator('#returnDashboard')).toBeVisible();else await expect(page.locator('#returnDashboard')).toBeHidden();await expect(page.locator('#rows')).toContainText('DEMO1');
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),name+' page overflow');
   if(role==='super_admin'){await page.locator('#btnAccess').click();await expect(page.locator('#panel')).toContainText('office@example.test');await page.locator('#closeAccess').click();}else await expect(page.locator('#btnAccess')).toBeHidden();
   await page.locator('tr[data-id="DEMO1"] b').first().click();await expect(page.locator('#p_date')).toBeVisible();await expect(page.locator('#panel')).toContainText('12/08/2026');
   // Both the 15-second poll and realtime updates must preserve entry forms.
   await page.locator('#btnEdit').click();await page.locator('#f_owner_name').fill('DRAFT OWNER');
   await page.clock.runFor(16000);await expect(page.locator('#f_owner_name')).toHaveValue('DRAFT OWNER');
   await page.evaluate(()=>rentalFixture.refresh());await expect(page.locator('#f_owner_name')).toHaveValue('DRAFT OWNER');
   await page.locator('#btnCancel').click();
   await page.locator('#h_partner').selectOption('DIRECT');await page.locator('#h_to').fill('DRAFT RENTER');
   await page.locator('#h_phone').fill('0123456789');await page.locator('#p_note').fill('DRAFT PAYMENT');
   await page.locator('#x_notes').fill('DRAFT NOTES');
   await page.clock.runFor(16000);await page.evaluate(()=>rentalFixture.refresh());
   await expect(page.locator('#h_to')).toHaveValue('DRAFT RENTER');await expect(page.locator('#p_note')).toHaveValue('DRAFT PAYMENT');
   // A successful save clears only its own section, retaining other drafts.
   await page.evaluate(()=>rentalFixture.holdSave());await page.locator('#btnExtras').click();
   await page.locator('#x_notes').fill('TYPED DURING SAVE');await page.evaluate(()=>rentalFixture.releaseSave());
   await expect(page.locator('#toast')).toContainText('已保存');await expect(page.locator('#x_notes')).toHaveValue('TYPED DURING SAVE');
   await page.locator('#btnExtras').click();await expect.poll(()=>page.evaluate(()=>rentalFixture.snapshot().contracts[0].data.notes)).toBe('TYPED DURING SAVE');
   await expect(page.locator('#h_to')).toHaveValue('DRAFT RENTER');await expect(page.locator('#p_note')).toHaveValue('DRAFT PAYMENT');
   await page.locator('#btnRentOut').click();await expect(page.locator('#r_type')).toBeVisible();
   await expect(page.locator('#p_note')).toHaveValue('DRAFT PAYMENT');
   await page.locator('#r_type').selectOption('RETURN');await page.locator('#r_note').fill('DRAFT RETURN');
   await page.clock.runFor(16000);await expect(page.locator('#r_note')).toHaveValue('DRAFT RETURN');
   if(name==='desktop'){await page.evaluate(()=>askVoid('DEMO1',0));await page.locator('#vr_0').fill('DRAFT VOID');await page.evaluate(()=>rentalFixture.refresh());await expect(page.locator('#vr_0')).toHaveValue('DRAFT VOID');}
   await page.locator('#panel .x').click();await page.evaluate(()=>rentalFixture.refresh());
   await expect(page.locator('#r_note')).toHaveValue('DRAFT RETURN');
   await page.locator('#panel .x').click();await expect(page.locator('#drawer')).not.toHaveClass(/open/);
   // Opening settings/add from a detail must not leave the old detail selected.
   await page.locator('tr[data-id="DEMO1"] b').first().click();
   await page.evaluate(()=>document.querySelector('#btnSettings').click());await page.locator('#s_agent').fill('DRAFT AGENT');
   await page.evaluate(()=>rentalFixture.refresh());await expect(page.locator('#s_agent')).toHaveValue('DRAFT AGENT');
   await page.evaluate(()=>{closeDrawer();closeDrawer();document.querySelector('#btnAdd').click();});
   await page.locator('#f_owner_name').fill('NEW OWNER');await page.clock.runFor(16000);
   await expect(page.locator('#f_owner_name')).toHaveValue('NEW OWNER');
   await page.evaluate(()=>{closeDrawer();closeDrawer();});await page.locator('tr[data-id="DEMO1"] b').first().click();
   await page.locator('#p_amt').fill('500');await page.locator('#btnPay').click();await expect.poll(()=>page.evaluate(()=>rentalFixture.snapshot().contracts[0].data.payments.length)).toBe(1);
   assert.equal(await page.evaluate(()=>rentalFixture.snapshot().contracts[0].data.payments[0].by),role==='super_admin'?'Demo Manager':'demo@example.test');
   await expect(page.locator('#panel')).toContainText('instalment #2');
   if(role==='super_admin'){
    // two rent-outs with a return in between: entry #1 is history, entry #3 is the current rent-out
    const rentOut=async(to,rent)=>{await page.locator('#h_partner').selectOption('DIRECT');await page.locator('#h_to').fill(to);await page.locator('#h_phone').fill('010-0000000');await page.locator('#h_rent').fill(rent);await page.locator('#btnRentOut').click();};
    assert.equal(await page.evaluate(()=>rentalFixture.snapshot().contracts[0].data.handovers.length),1);  // DRAFT RENTER from the earlier steps
    await page.locator('#r_type').selectOption('RETURN');await page.locator('#btnReturn').click();await expect.poll(()=>page.evaluate(()=>rentalFixture.snapshot().contracts[0].data.handovers.length)).toBe(2);
    await rentOut('second renter','100');await expect.poll(()=>page.evaluate(()=>rentalFixture.snapshot().contracts[0].data.handovers.length)).toBe(3);
    await expect(page.locator('#panel')).toContainText('收到 upfront RM100');
    // P1: only one editor at a time, and each row reads its own inputs
    await page.locator('#hr_0 button',{hasText:'编辑'}).click();await expect(page.locator('#eh_0_to')).toHaveValue('DRAFT RENTER');
    await page.locator('#hr_2 button',{hasText:'编辑'}).click();await expect(page.locator('#toast')).toContainText('先保存或取消');await expect(page.locator('#eh_2_to')).toHaveCount(0);
    // P1: auto-refresh / Realtime must not wipe an open editor, even before typing
    await page.evaluate(()=>rentalFixture.refresh());await page.waitForTimeout(300);await expect(page.locator('#eh_0_to')).toHaveValue('DRAFT RENTER');
    await page.locator('#eh_0_phone').fill('011-1111111');await page.evaluate(()=>rentalFixture.refresh());await page.clock.runFor(16000);await expect(page.locator('#eh_0_phone')).toHaveValue('011-1111111');
    // editing history entry #1 must not change the current upfront summary
    await page.locator('#eh_0_rent').fill('999');await page.locator('#hr_0 button',{hasText:'保存'}).click();
    await expect.poll(()=>page.evaluate(()=>rentalFixture.snapshot().contracts[0].data.handovers[0].phone)).toBe('011-1111111');
    let c=await page.evaluate(()=>rentalFixture.snapshot().contracts[0].data);assert.equal(c.handovers[0].rent,999);assert.equal(c.handovers[0].edit_log[0].before.phone,'0123456789');assert.equal(c.handovers[0].edited_by,'Demo Manager');assert.equal(c.actual_rent,100);
    await expect(page.locator('#panel')).toContainText('收到 upfront RM100');await expect(page.locator('#hr_0')).toContainText('已修改');
    // P2: editing the current rent-out's upfront updates the summary
    await page.locator('#hr_2 button',{hasText:'编辑'}).click();await page.locator('#eh_2_rent').fill('200');await page.locator('#hr_2 button',{hasText:'保存'}).click();
    await expect.poll(()=>page.evaluate(()=>rentalFixture.snapshot().contracts[0].data.actual_rent)).toBe(200);await expect(page.locator('#panel')).toContainText('收到 upfront RM200');await expect(page.locator('tr[data-id="DEMO1"]')).toContainText('RM200');
    // cancel leaves nothing dirty; a no-op save is reported
    await page.locator('#hr_1 button',{hasText:'编辑'}).click();await page.locator('#hr_1 button',{hasText:'取消'}).click();await expect(page.locator('#eh_1_date')).toHaveCount(0);assert.equal(await page.evaluate(()=>window.__dirty),false);
    await page.locator('#hr_1 button',{hasText:'编辑'}).click();await page.locator('#hr_1 button',{hasText:'保存'}).click();await expect(page.locator('#toast')).toContainText('没有改动');await expect(page.locator('#eh_1_date')).toHaveCount(0);

    // Cancel and no-op handover saves preserve unrelated drafts, including across refresh.
    await page.locator('#p_note').fill('KEEP PAYMENT DRAFT');
    await page.locator('#x_notes').fill('KEEP NOTES DRAFT');
    for(const action of ['取消','保存']){
     await page.locator('#hr_1 button',{hasText:'编辑'}).click();
     await page.locator('#hr_1 button',{hasText:action}).click();
     await expect(page.locator('#eh_1_date')).toHaveCount(0);
     await page.evaluate(()=>rentalFixture.refresh());await page.clock.runFor(16000);
     await expect(page.locator('#p_note')).toHaveValue('KEEP PAYMENT DRAFT');
     await expect(page.locator('#x_notes')).toHaveValue('KEEP NOTES DRAFT');
     assert.equal(await page.evaluate(()=>window.__dirty),true);
    }
    // Saving another section restores an open handover editor and its unsaved values.
    await page.locator('#hr_0 button',{hasText:'编辑'}).click();await page.locator('#eh_0_phone').fill('012-2222222');
    await page.locator('#btnExtras').click();await expect(page.locator('#eh_0_phone')).toHaveValue('012-2222222');
    await expect(page.locator('#p_note')).toHaveValue('KEEP PAYMENT DRAFT');
    await page.locator('#hr_0 button',{hasText:'取消'}).click();
    await page.evaluate(()=>{closeDrawer();closeDrawer();});await page.locator('tr[data-id="DEMO1"] b').first().click();

    // P1: plate correction is one RPC — a failed move changes nothing and leaves no duplicate
    await page.locator('#btnEdit').click();await expect(page.locator('#f_plate')).toHaveValue('DEMO1');await page.locator('#f_plate').fill('DEMO2');await expect(page.locator('#plateMove')).toBeVisible();
    await page.evaluate(()=>rentalFixture.conflict());await page.locator('#btnSave').click();await expect(page.locator('#toast')).toContainText('Record changed');
    c=await page.evaluate(()=>rentalFixture.snapshot().contracts);assert.equal(c.length,1);assert.equal(c[0].data.car_status,'SOLD');assert.equal(c[0].data.plate,'DEMO1');
    await expect(page.locator('#f_plate')).toHaveValue('DEMO2');  // form kept for retry after refresh
    await page.evaluate(()=>{closeDrawer();closeDrawer();});await page.evaluate(()=>rentalFixture.refresh());await page.clock.runFor(100);await page.locator('tr[data-id="DEMO1"] b').first().click();await page.locator('#btnEdit').click();await page.locator('#f_plate').fill('DEMO2');await page.locator('#f_financier').selectOption('CARSOME');await page.locator('#btnSave').click();
    await expect(page.locator('#toast')).toContainText('DEMO2');
    await expect.poll(()=>page.evaluate(()=>rentalFixture.snapshot().contracts.length)).toBe(2);
    c=await page.evaluate(()=>rentalFixture.snapshot().contracts);const moved=c.find(x=>x.id==='DEMO1'),fresh=c.find(x=>x.id==='DEMO2');
    assert.equal(moved.data.car_status,'MOVED');assert.equal(moved.data.moved_to,'DEMO2');assert.equal(fresh.data.plate,'DEMO2');assert.equal(fresh.data.plate_changed_from,'DEMO1');assert.equal(fresh.data.payments.length,1);assert.equal(fresh.data.handovers.length,3);assert.equal(fresh.revision,1);assert.match(fresh.data.check_note,/^CARSOME REF-2/);assert.equal(fresh.data.pay_reference,'DEMO2');
    await expect(page.locator('#rentalStatus')).toContainText('已读取 1 台');await expect(page.locator('#rows')).toContainText('DEMO2');await expect(page.locator('tr[data-id="DEMO1"]')).toHaveCount(0);
    await expect(page.locator('#p_date')).toBeVisible();await expect(page.locator('#panel')).toContainText('DEMO2');  // moved record reopened automatically

    // Completing Ref-2 while moving again clears only the automatic warning.
    await page.locator('#btnEdit').click();await page.locator('#f_plate').fill('DEMO3');await page.locator('#f_jompay_ref2').fill('12345678');await page.locator('#btnSave').click();
    await expect.poll(()=>page.evaluate(()=>rentalFixture.snapshot().contracts.find(x=>x.id==='DEMO3')?.data.check_note)).toBe('');
    await expect(page.locator('#p_date')).toBeVisible();await expect(page.locator('#panel h2').first()).toContainText('DEMO3');
    assert.equal(await page.evaluate(()=>rentalFixture.snapshot().contracts.find(x=>x.id==='DEMO3').data.pay_reference),'DEMO3');
    // Adding a punctuation alias is rejected by the form before a save.
    await page.evaluate(()=>{closeDrawer();document.querySelector('#btnAdd').click();});await page.locator('#f_plate').fill('DEMO-3');
    await expect(page.locator('#e_plate')).toContainText('Plate already exists');
    await page.evaluate(()=>{closeDrawer();closeDrawer();});await page.locator('tr[data-id="DEMO3"] b').first().click();

   }
   await page.locator('#x_notes').fill('KEEP ON FAILURE');await page.evaluate(()=>rentalFixture.conflict());await page.locator('#btnExtras').click();await expect(page.locator('#toast')).toContainText('Record changed');await page.evaluate(()=>rentalFixture.refresh());await expect(page.locator('#x_notes')).toHaveValue('KEEP ON FAILURE');await page.locator('#btnPay').click();await expect(page.locator('#toast')).toContainText('Record changed');assert.equal(await page.evaluate(()=>rentalFixture.snapshot().contracts.find(x=>x.data.car_status!=='MOVED').data.payments.length),1);
   await page.evaluate(()=>{closeDrawer();closeDrawer();window.scrollTo(0,0);document.querySelector('#toast').classList.remove('show');});await page.screenshot({path:'test-results/rental-'+name+'.png',fullPage:true});
   await page.locator('tr.r b').first().click();await page.locator('#p_note').fill('PRIVATE DRAFT');
   await page.evaluate(()=>rentalFixture.revoke());await expect(page.locator('#app')).toBeHidden();await expect(page.locator('#returnDashboard')).toBeHidden();await expect(page.locator('#rows')).toBeEmpty();await expect(page.locator('#panel')).toBeEmpty();
  }
  await context.close();
 }
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);console.log('PASS rental desktop/mobile, staff gates, access controls, payment save/conflict, revocation and private UI clearing');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
