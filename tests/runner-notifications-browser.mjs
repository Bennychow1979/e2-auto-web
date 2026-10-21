import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {startPreview} from './serve-operations.mjs';
const preview=await startPreview();let browser;
try{
 browser=await chromium.launch(process.platform==='win32'?{channel:'msedge'}:{});
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 const p=await context.newPage(),errors=[],external=[];p.on('pageerror',e=>errors.push(e.message));
 await context.route('**/*',route=>{if(new URL(route.request().url()).origin!==preview.url){external.push(route.request().url());return route.abort();}return route.continue();});
 await p.goto(preview.url+'/operations.html?previewRole=admin');await expect(p.locator('#notificationPreview')).toContainText('0 jobs overdue');
 await p.locator('#advancePreviewTime').tap();await expect(p.locator('#notificationPreview')).toContainText('2 jobs overdue');
 await p.locator('#notificationPreview summary').tap();await expect(p.locator('#notificationPreview')).toContainText('超时提醒');
 assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Mobile notification panel fits');
 await p.selectOption('#previewRole','runner');await expect(p.locator('#notificationPreview')).toContainText('Opening a notification does not accept');
 await expect(p.locator('#records')).not.toContainText('DEMO02');
 await p.locator('#notificationPreview summary').tap();await p.locator('#notificationPreview a').click();
 await expect(p.locator('#jobDialog')).toBeVisible();await expect(p.locator('#acceptJob')).toBeVisible();await expect(p.locator('#movementForm')).toBeHidden();
 await p.locator('#acceptJob').tap();await expect(p.locator('#acceptance')).toContainText('已接单');await expect(p.locator('#acceptJob')).toBeHidden();await expect(p.locator('#movementForm')).toBeVisible();
 await p.reload();await expect(p.locator('#acceptance')).toContainText('已接单');
 const jobUrl=new URL(p.url());jobUrl.searchParams.set('previewRole','runner2');await p.goto(jobUrl.href);await expect(p.locator('#message')).toContainText('此账号无权查看');
 await p.goto(preview.url+'/operations.html?previewRole=admin');await expect(p.locator('#notificationPreview')).toContainText('1 jobs overdue');await expect(p.locator('#records')).toContainText('已接单');
 await p.locator('#records .record').filter({hasText:'DEMO01'}).getByRole('button').tap();await expect(p.locator('#acceptJob')).toBeHidden();
 const forbidden=await context.request.post(preview.url+'/preview-api/rpc',{headers:{'X-Preview-Role':'runner'},data:{name:'e2_preview_advance_time'}});assert.equal(forbidden.status(),400);
 // Production RPC does not supply the test-server notification simulation.
 await p.route('**/preview-api/rpc',async route=>{
  if(route.request().postDataJSON().name!=='e2_operations_workspace')return route.continue();
  const response=await route.fetch(),body=await response.json();delete body.notification_preview;
  await route.fulfill({response,json:body});
 });
 await p.goto(preview.url+'/operations.html?previewRole=admin');
 await expect(p.locator('#notificationPreview')).toContainText('Telegram notifications are off');
 await expect(p.locator('#advancePreviewTime')).toHaveCount(0);
 await expect(p.locator('#notificationPreview')).not.toContainText('SIMULATED ONLY');
 assert.deepEqual(errors,[]);assert.deepEqual(external,[],'No external request, including Telegram');
 console.log('Notification preview, overdue reminder, deep-link access, mobile acceptance and zero external traffic passed.');
 await context.close();
}finally{if(browser)await browser.close();await preview.close();}
