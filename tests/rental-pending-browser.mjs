// Pending disbursement: car can be added without account no / first payment date, is listed for pre-booking,
// cannot be rented out or WhatsApp'd until admin completes the loan data and unticks the flag.
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
try{
 browser=await chromium.launch(process.platform==='win32'?{channel:'msedge'}:{});await mkdir('test-results',{recursive:true});
 for(const [name,width,height] of [['desktop',1440,1000],['mobile',390,844]]){
  const context=await browser.newContext({viewport:{width,height},timezoneId:'Asia/Kuala_Lumpur'});
  await context.route('**/*',route=>new URL(route.request().url()).origin!==origin?route.abort():route.continue());
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/rental.html?role=super_admin');
  await expect(page.locator('#rentalStatus')).toContainText('已读取 1 台');
  // 1. Add a car with the flag ticked: account no & first payment date left blank.
  await page.locator('#btnAdd').click();await page.locator('#f_plate').fill('PEND1');await page.locator('#f_brand').fill('PERODUA');await page.locator('#f_model').fill('MYVI');await page.locator('#f_year').fill('2024');
  await page.locator('#f_owner_name').fill('PENDING OWNER');await page.locator('#f_owner_phone').fill('0123456789');await page.locator('#f_agent').selectOption('DEMO AGENT');await page.locator('#f_financier').selectOption('DEMO');
  await page.locator('#f_loan_amount').fill('50000');await page.locator('#f_monthly').fill('850');await page.locator('#f_tenure').fill('84');
  await expect(page.locator('#e_account_no')).toHaveText('户口号码空白 Account required');await expect(page.locator('#e_first_payment_date')).toHaveText('必填 Required');
  await page.locator('#f_pending_disbursement').check();
  await expect(page.locator('#e_account_no')).toHaveText('');await expect(page.locator('#e_first_payment_date')).toHaveText('');await expect(page.locator('#payPreview')).toContainText('待放款');
  await page.evaluate(()=>{document.querySelector('#f_pending_disbursement').scrollIntoView({block:'center'});});await page.screenshot({path:`test-results/pending-${name}-form.png`});
  await page.locator('#btnSave').click();await expect(page.locator('#toast')).toContainText('已新增 Added PEND1');
  const saved=await page.evaluate(()=>rentalFixture.snapshot().contracts.find(c=>c.id==='PEND1').data);
  assert.equal(saved.pending_disbursement,true);assert.equal(saved.account_no,null);assert.equal(saved.first_payment_date,null);assert.equal(saved.monthly,850);
  // 2. List shows the pending chip and no WhatsApp button; filter works; stat appears.
  const row=page.locator('tr[data-id="PEND1"]');await expect(row).toContainText('Pre-booking');await expect(row).toContainText('待放款');await expect(row.locator('button.wa')).toHaveCount(0);
  await expect(page.locator('#stats')).toContainText('待放款');
  await page.locator('#fStatus').selectOption('pending');await expect(page.locator('#rows tr')).toHaveCount(1);await page.locator('#fStatus').selectOption('open');
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),name+' page overflow');
  await expect(page.locator('#toast')).not.toHaveClass(/show/);await page.locator('tr[data-id="PEND1"]').scrollIntoViewIfNeeded();await page.screenshot({path:`test-results/pending-${name}-list.png`,fullPage:name==='mobile'});
  // 3. Detail: rent-out form hidden, notice shown, pay-to says pending, no WhatsApp buttons.
  await expect(page.locator('#toast')).not.toHaveClass(/show/);await row.locator('b').first().click();await expect(page.locator('#btnPendingEdit')).toBeVisible();await expect(page.locator('#btnRentOut')).toHaveCount(0);await expect(page.locator('#h_to')).toHaveCount(0);
  await expect(page.locator('#panel')).toContainText('还没有户口号码');await expect(page.locator('#btnPay')).toHaveCount(0);await expect(page.locator('#panel')).not.toContainText('null');await expect(page.locator('#btnOwnerWA')).toHaveCount(0);await expect(page.locator('#waPrev')).toHaveCount(0);
  await page.evaluate(()=>{document.querySelector('#drawer').scrollTop=0;document.querySelector('#panel').scrollTop=0;});await page.screenshot({path:`test-results/pending-${name}-detail.png`});
  // 4. Stock list for agents: appears as Pre-booking, never mentions disbursement.
  await page.evaluate(()=>{closeDrawer();});await page.locator('#btnStock').click();const stock=await page.locator('#stockText').inputValue();
  assert(stock.includes('PEND1'));assert(stock.includes('PRE-BOOKING — 1 cars'));assert(!/disburs|放款/i.test(stock));assert(stock.includes('RM850'));assert(!stock.includes('PENDING OWNER'));
  await page.screenshot({path:`test-results/pending-${name}-stock.png`});
  await page.evaluate(()=>{closeDrawer();});
  // 4b. Pre-booking with deposit: saved, shown as Reserved, agent list says RESERVED without the renter's name; cancel keeps history; re-book.
  await row.locator('b').first().click();await expect(page.locator('#btnBook')).toBeVisible();
  await page.locator('#b_partner').selectOption('DIRECT');await page.locator('#b_to').fill('Booker One');await page.locator('#b_phone').fill('0199999999');await page.locator('#btnBook').click();await expect(page.locator('#toast')).toContainText('请填订金');
  await page.locator('#b_deposit').fill('500');await page.locator('#b_note').fill('wants red');await page.locator('#btnBook').click();await expect(page.locator('#toast')).toContainText('已记录预订 BOOKER ONE');
  let b=await page.evaluate(()=>rentalFixture.snapshot().contracts.find(c=>c.id==='PEND1').data.booking);assert.equal(b.to,'BOOKER ONE');assert.equal(b.deposit,500);assert.equal(b.partner,'');assert.equal(b.note,'WANTS RED');
  await expect(page.locator('#btnCancelBooking')).toBeVisible();await expect(page.locator('#btnBook')).toHaveCount(0);await expect(page.locator('#panel')).toContainText('RM500');
  await expect(page.locator('#toast')).not.toHaveClass(/show/);await page.screenshot({path:`test-results/pending-${name}-booked.png`});
  await page.locator('#btnCancelBooking').click();await page.locator('#btnCancelBooking').click();await expect(page.locator('#toast')).toContainText('预订已取消');
  const after=await page.evaluate(()=>rentalFixture.snapshot().contracts.find(c=>c.id==='PEND1').data);assert.equal(after.booking,null);assert.equal(after.booking_history.length,1);assert.equal(after.booking_history[0].status,'CANCELLED');
  await expect(page.locator('#btnBook')).toBeVisible();await page.locator('#b_partner').selectOption('DIRECT');await page.locator('#b_to').fill('Booker Two');await page.locator('#b_phone').fill('0188888888');await page.locator('#b_deposit').fill('300');await page.locator('#btnBook').click();await expect(page.locator('#toast')).toContainText('已记录预订 BOOKER TWO');
  await page.evaluate(()=>{closeDrawer();});await expect(row).toContainText('已预订 Reserved');await expect(row).toContainText('BOOKER TWO');await expect(page.locator('#stats')).toContainText('已预订');
  await page.locator('#fStatus').selectOption('booked');await expect(page.locator('#rows tr')).toHaveCount(1);await page.locator('#fStatus').selectOption('open');
  await page.locator('#btnStock').click();const stock2=await page.locator('#stockText').inputValue();assert(stock2.includes('RESERVED'));assert(!stock2.includes('BOOKER'));assert(!stock2.includes('0188888888'));assert(!/disburs|放款/i.test(stock2));assert(stock2.includes('RESERVED — 1 cars'));
  await page.evaluate(()=>{closeDrawer();});
  // 5. Selected-rows WhatsApp skips pending cars.
  await row.locator('input.sel').check();await page.locator('#btnSelWA').click();await expect(page.locator('#toast')).toContainText('待放款');await row.locator('input.sel').uncheck();
  // 6. Admin completes loan data: untick → fields required again → fill → save → rent-out available.
  await row.locator('b').first().click();await page.locator('#btnPendingEdit').click();await expect(page.locator('#f_pending_disbursement')).toBeChecked();
  await page.locator('#f_pending_disbursement').uncheck();await expect(page.locator('#e_account_no')).toHaveText('户口号码空白 Account required');await expect(page.locator('#e_first_payment_date')).toHaveText('必填 Required');
  await page.locator('#btnSave').click();await expect(page.locator('#toast')).toContainText('还有栏位不对');
  await page.locator('#f_account_no').fill('9876543210');await page.locator('#f_first_payment_date').fill('2026-12-15');await page.locator('#btnSave').click();await expect(page.locator('#toast')).toContainText('已保存');
  const done=await page.evaluate(()=>rentalFixture.snapshot().contracts.find(c=>c.id==='PEND1').data);
  assert.equal(done.pending_disbursement,false);assert.equal(done.account_no,'9876543210');assert.equal(done.first_payment_date,'2026-12-15');assert(/已放款/.test(done.history.at(-1).action));
  await expect(page.locator('#btnRentOut')).toBeVisible();await expect(page.locator('#btnPay')).toBeVisible();await expect(page.locator('#btnPendingEdit')).toHaveCount(0);await expect(page.locator('#panel')).toContainText('9876543210');
  // 7. Rent-out form is pre-filled from the booking; saving converts the booking into a handover.
  await expect(page.locator('#h_to')).toHaveValue('BOOKER TWO');await expect(page.locator('#h_phone')).toHaveValue('0188888888');await expect(page.locator('#h_partner')).toHaveValue('DIRECT');await expect(page.locator('#btnCancelBooking')).toBeVisible();
  await expect(page.locator('#toast')).not.toHaveClass(/show/);await page.screenshot({path:`test-results/pending-${name}-rentout.png`});
  await page.locator('#h_rent').fill('2000');await page.locator('#btnRentOut').click();await expect(page.locator('#toast')).toContainText('已租出给 BOOKER TWO');
  const conv=await page.evaluate(()=>rentalFixture.snapshot().contracts.find(c=>c.id==='PEND1').data);assert.equal(conv.booking,null);assert.equal(conv.booking_history.length,2);assert.equal(conv.booking_history[1].status,'CONVERTED');assert.equal(conv.handovers.at(-1).to,'BOOKER TWO');assert.equal(conv.handovers.at(-1).deposit,300);assert(/由预订转入/.test(conv.history.at(-1).action));
  await expect(page.locator('#btnCancelBooking')).toHaveCount(0);await expect(page.locator('#btnReturn')).toBeVisible();
  await page.evaluate(()=>{closeDrawer();});await expect(page.locator('tr[data-id="PEND1"]')).not.toContainText('Pre-booking');await expect(page.locator('tr[data-id="PEND1"]')).toContainText('已租出 Rented');await expect(page.locator('tr[data-id="PEND1"] button.wa')).toHaveCount(1);
  await context.close();
 }
 assert.deepEqual(errors,[]);
 console.log('PASS pending disbursement + pre-booking: optional account/first-payment while pending, pre-booking chip & filter, rent-out/payment/WhatsApp blocked, booking with deposit / cancel / re-book, agent list RESERVED without renter data, admin completion pre-fills rent-out and converts the booking (desktop/mobile)');
}finally{await browser?.close();server.close();}
