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
 for(const width of [1440,390]){
  const payments=[{seq:1,paid_date:'2026-11-21',amount:500,method:'LEGACY METHOD',note:''},{seq:2,paid_date:'2026-11-22',amount:500,method:'CASH',note:''}];
  await scenario('Payment draft and legacy method survive saving another section',width,async p=>{
   await seed(p,{payments});await p.locator('#pr_0 button',{hasText:'编辑'}).click();await expect(p.locator('#ep_0_method')).toHaveValue('LEGACY METHOD');
   await p.locator('#ep_0_amount').fill('450');await p.locator('#x_notes').fill('Keep unrelated note');await p.locator('#btnExtras').click();
   await expect(p.locator('#toast')).toContainText('已保存');await expect(p.locator('#ep_0_amount')).toHaveValue('450');
   await p.locator('#pr_0 button',{hasText:'保存'}).click();await expect(p.locator('#toast')).toContainText('已修改付款');
   const saved=await p.evaluate(()=>rentalFixture.snapshot().contracts[0].data);
   assert.equal(saved.payments[0].amount,450);assert.equal(saved.payments[0].method,'LEGACY METHOD');assert.equal(saved.payments[0].edit_log[0].before.amount,500);assert.equal(saved.notes,'KEEP UNRELATED NOTE');
  });
  await scenario('Void reason survives an unrelated save and unpaid count recovers',width,async p=>{
   await seed(p,{payments,paid_count_excel:3});await p.locator('#pr_1 button',{hasText:'作废'}).click();await p.locator('#vp_1_reason').fill('duplicate entry');
   await p.locator('#x_notes').fill('Keep void draft');await p.locator('#btnExtras').click();await expect(p.locator('#toast')).toContainText('已保存');
   await expect(p.locator('#vp_1_reason')).toHaveValue('duplicate entry');await p.locator('#pr_1 button',{hasText:'确定'}).click();await expect(p.locator('#toast')).toContainText('已作废');
   const saved=await p.evaluate(()=>rentalFixture.snapshot().contracts[0].data);
   assert.equal(saved.payments.length,2);assert.equal(saved.payments[1].void_reason,'DUPLICATE ENTRY');assert.equal(saved.payments[0].seq,4);
   await expect(p.locator('#panel')).toContainText('记录第 5 期付款');
  });
  await scenario('Conflict does not discard the payment correction draft',width,async p=>{
   await seed(p,{payments});await p.locator('#pr_0 button',{hasText:'编辑'}).click();await p.locator('#ep_0_amount').fill('450');await p.evaluate(()=>rentalFixture.conflict());
   await p.locator('#pr_0 button',{hasText:'保存'}).click();await expect(p.locator('#toast')).toContainText('Record changed');await p.evaluate(()=>rentalFixture.refresh());
   await expect(p.locator('#ep_0_amount')).toHaveValue('450');assert.equal(await p.evaluate(()=>rentalFixture.snapshot().contracts[0].data.payments[0].amount),500);
  });
  await scenario('Typing during a payment save remains an unsaved draft',width,async p=>{
   await seed(p,{payments});await p.locator('#pr_0 button',{hasText:'编辑'}).click();await p.locator('#ep_0_amount').fill('450');await p.evaluate(()=>reviewFixture.holdResponse());
   await p.locator('#pr_0 button',{hasText:'保存'}).click();await expect.poll(()=>p.evaluate(()=>rentalFixture.snapshot().contracts[0].data.payments[0].amount)).toBe(450);
   await p.locator('#ep_0_amount').fill('475');await p.evaluate(()=>reviewFixture.releaseResponse());await expect(p.locator('#toast')).toContainText('已修改付款');
   await expect(p.locator('#ep_0_amount')).toHaveValue('475');assert.equal(await p.evaluate(()=>rentalFixture.snapshot().contracts[0].data.payments[0].amount),450);
  });
  await scenario('Late payment save cannot show a message after logout',width,async p=>{
   await seed(p,{payments});await p.locator('#pr_0 button',{hasText:'编辑'}).click();await p.locator('#ep_0_amount').fill('450');await p.evaluate(()=>reviewFixture.holdResponse());
   await p.locator('#pr_0 button',{hasText:'保存'}).click();await expect.poll(()=>p.evaluate(()=>rentalFixture.snapshot().contracts[0].data.payments[0].amount)).toBe(450);
   await p.evaluate(()=>document.querySelector('#btnOut').click());await expect(p.locator('#login')).toBeVisible();await p.evaluate(()=>reviewFixture.releaseResponse());await p.waitForTimeout(50);
   await expect(p.locator('#toast')).toBeEmpty();await expect(p.locator('#panel')).toBeEmpty();await expect(p.locator('#rows')).toBeEmpty();
  });
 }
 assert.deepEqual(errors,[]);
}finally{await browser.close();await new Promise(r=>server.close(r));}
