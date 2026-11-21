import {chromium,expect} from '@playwright/test';
import {readFile,mkdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import assert from 'node:assert/strict';
const files={'/workspace-theme.css':'workspace-theme.css','/rental-stock.mjs':'rental-stock.mjs','/rental.html':'rental.html','/rental.js':'rental.js','/rental.css':'rental.css','/rental-data.mjs':'rental-data.mjs','/e2-data.js':'tests/fixtures/rental-sdk.mjs'};
// Isolated synthetic state and delayed response controls; never contact Supabase.
const hooks=`
let responseGate=null,releaseResponse=null;
const originalRpc=db.rpc;
db.rpc=async(name,args)=>{const result=await originalRpc(name,args);if(name==='rental_save'&&responseGate){const pending=responseGate;responseGate=null;await pending;}return result;};
window.reviewFixture={async seed(patch,extra=[]){contracts[0].data={...contracts[0].data,agent:'DEMO AGENT',...patch};contracts.push(...extra);await rentalFixture.refresh();},
 holdResponse(){responseGate=new Promise(resolve=>releaseResponse=resolve);},releaseResponse(){releaseResponse();}};`;
const server=createServer(async(req,res)=>{
 const p=new URL(req.url,'http://localhost').pathname;
 if(p==='/e2-config.js'){res.setHeader('Content-Type','text/javascript');res.end('');return;}
 if(!files[p]){res.writeHead(404);res.end();return;}
 res.setHeader('Content-Type',p.endsWith('.html')?'text/html':p.endsWith('.css')?'text/css':'text/javascript');
 res.end(await readFile(files[p],'utf8')+(p==='/e2-data.js'?hooks:''));
});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch();const errors=[];
const booking={to:'BOOKER ONE',phone:'0199999999',partner:'',date:'2026-11-21',deposit:300,note:'BOOKING NOTE',by:'Demo Manager',at:'2026-11-21T00:00:00Z'};
async function scenario(name,width,fn){
 const ctx=await browser.newContext({viewport:{width,height:900}});
 await ctx.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
 const p=await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));
 try{await p.goto(origin+'/rental.html');await expect(p.locator('#rentalStatus')).toContainText('已读取 1 台');await fn(p);console.log('PASS '+name+' ('+width+'px)');}
 finally{await ctx.close();}
}
async function seed(p,patch,extra=[]){await p.evaluate(async({patch,extra})=>reviewFixture.seed(patch,extra),{patch,extra});await p.locator('tr[data-id="DEMO1"] b').first().click();}
try{
 await mkdir('test-results',{recursive:true});
 for(const width of [1440,390]){
  await scenario('Closed contract preserves deposit through edits and reopening',width,async p=>{
   await seed(p,{pending_disbursement:true,booking});
   await p.locator('#c_reason').selectOption('OWNER TAKE BACK');await p.locator('#btnClose').click();await p.locator('#btnClose').click();
   await expect(p.locator('#btnReopen')).toBeVisible();await expect(p.locator('#panel')).toContainText('BOOKER ONE');
   await p.evaluate(()=>{const f=document.querySelector('#fStatus');f.value='booked';f.dispatchEvent(new Event('input'));});
   await expect(p.locator('#rows tr')).toHaveCount(0);
   await p.evaluate(()=>{const f=document.querySelector('#fStatus');f.value='open';f.dispatchEvent(new Event('input'));});
   await p.locator('#btnEdit').click();await p.locator('#f_owner_phone').fill('0112345678');await p.locator('#btnSave').click();
   await expect(p.locator('#toast')).toContainText('已保存');
   let data=await p.evaluate(()=>rentalFixture.snapshot().contracts[0].data);assert.deepEqual(data.booking,booking);
   await p.locator('#btnReopen').click();await expect(p.locator('#btnPendingEdit')).toBeVisible();await expect(p.locator('#panel')).toContainText('RM300');
   await p.locator('#btnCancelBooking').click();await p.locator('#btnCancelBooking').click();
   await expect(p.locator('#btnBook')).toBeVisible();data=await p.evaluate(()=>rentalFixture.snapshot().contracts[0].data);
   assert.equal(data.booking,null);assert.equal(data.booking_history[0].deposit,300);assert.equal(data.booking_history[0].status,'CANCELLED');
  });
  await scenario('Conversion defaults to deposit and rejects blank/undersized totals',width,async p=>{
   await seed(p,{pending_disbursement:false,booking,target_price:null});
   await expect(p.locator('#h_to')).toHaveValue('BOOKER ONE');await expect(p.locator('#h_rent')).toHaveValue('300');
   for(const value of ['', '100']){
    await p.locator('#h_rent').fill(value);await p.locator('#btnRentOut').click();await expect(p.locator('#toast')).toContainText('必须包含已收订金');
    assert.equal(await p.evaluate(()=>rentalFixture.snapshot().contracts[0].data.handovers.length),0);
   }
   await p.locator('#h_rent').fill('300');await p.locator('#btnRentOut').click();await expect(p.locator('#btnReturn')).toBeVisible();
   const data=await p.evaluate(()=>rentalFixture.snapshot().contracts[0].data);
   assert.equal(data.handovers.at(-1).deposit,300);assert.equal(data.handovers.at(-1).rent,300);assert.equal(data.actual_rent,300);
   assert.equal(data.booking,null);assert.equal(data.booking_history[0].status,'CONVERTED');await expect(p.locator('#hr_0')).toContainText('deposit RM300');
   await p.locator('#hr_0 button',{hasText:'编辑'}).click();await p.locator('#eh_0_rent').fill('100');
   await p.locator('#hr_0 button',{hasText:'保存'}).click();await expect(p.locator('#toast')).toContainText('must include');
   assert.equal(await p.evaluate(()=>rentalFixture.snapshot().contracts[0].data.actual_rent),300);
  });
  await scenario('All-owner preview and copied payment details exclude pending cars',width,async p=>{
   const shared={owner_name:'SYNTHETIC OWNER',owner_phone:'010-0000001',monthly:500,tenure:60,car_status:'SOLD',payments:[],handovers:[]};
   await seed(p,{},[{id:'PEND2',revision:1,data:{...shared,plate:'PEND2',pending_disbursement:true,account_no:null,first_payment_date:null}},{id:'READY3',revision:1,data:{...shared,plate:'READY3',account_no:'12345678',first_payment_date:'2026-12-01'}}]);
   await p.locator('#panel button',{hasText:'预览全部 Preview all'}).click();await expect(p.locator('#waPrev2')).toBeVisible();
   const preview=await p.locator('#waPrev2').innerText();assert(!preview.includes('PEND2'));assert(preview.includes('READY3'));
   await p.evaluate(()=>{Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.copied=text;}}});copyWA(['DEMO1','PEND2','READY3'],'owner');});
   assert.equal(await p.evaluate(()=>window.copied),preview);
  });
  await scenario('Booking draft survives poll, conflict and refresh',width,async p=>{
   await p.clock.install();await seed(p,{pending_disbursement:true});
   await p.locator('#b_partner').selectOption('DIRECT');await p.locator('#b_to').fill('KEEP DRAFT');await p.locator('#b_phone').fill('010000');await p.locator('#b_deposit').fill('300');
   await p.clock.runFor(16000);await expect(p.locator('#b_to')).toHaveValue('KEEP DRAFT');
   await p.evaluate(()=>rentalFixture.conflict());await p.locator('#btnBook').click();await expect(p.locator('#toast')).toContainText('Record changed');
   await p.evaluate(()=>rentalFixture.refresh());await expect(p.locator('#b_to')).toHaveValue('KEEP DRAFT');await expect(p.locator('#b_deposit')).toHaveValue('300');
  });
  await scenario('Late booking save does not restore private data after logout',width,async p=>{
   await seed(p,{pending_disbursement:true});await p.locator('#b_partner').selectOption('DIRECT');await p.locator('#b_to').fill('PRIVATE BOOKER');await p.locator('#b_phone').fill('010000');await p.locator('#b_deposit').fill('300');
   await p.evaluate(()=>reviewFixture.holdResponse());await p.locator('#btnBook').click();
   await expect.poll(()=>p.evaluate(()=>rentalFixture.snapshot().contracts[0].data.booking?.to)).toBe('PRIVATE BOOKER');
   await p.evaluate(()=>document.querySelector('#btnOut').click());await expect(p.locator('#login')).toBeVisible();
   await p.evaluate(()=>reviewFixture.releaseResponse());await p.waitForTimeout(50);
   await expect(p.locator('#panel')).toBeEmpty();await expect(p.locator('body')).not.toContainText('PRIVATE BOOKER');await expect(p.locator('#rows')).toBeEmpty();
  });
 }
 for(const width of [390,320])await scenario('Handover cards and editors fit phone width',width,async p=>{
  await seed(p,{handovers:[{type:'OUT',to:'SYNTHETIC RENTER',phone:'01999999999',date:'2026-11-21',rent:300,note:'Test handover',by:'Demo Manager'}]});
  const fits=()=>p.evaluate(()=>{const e=document.querySelector('#hr_0');return e.scrollWidth<=e.clientWidth+1&&e.getBoundingClientRect().right<=innerWidth;});
  assert(await fits());await p.locator('#hr_0 button',{hasText:'编辑'}).click();assert(await fits());
  await p.screenshot({path:'test-results/rental-handover-card-'+width+'.png'});
 });
 assert.deepEqual(errors,[]);
}finally{await browser.close();await new Promise(r=>server.close(r));}
