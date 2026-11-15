import {chromium,expect} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {startDashboardPreview} from './serve-management-dashboard.mjs';
const preview=await startDashboardPreview(),errors=[],external=[];
let browser;
try {
  await mkdir('test-results',{recursive:true});
  browser=await chromium.launch(process.platform==='win32'?{channel:'msedge'}:{});
  for(const [name,width,height] of [['desktop',1440,1000],['mobile',390,844]]) {
    const context=await browser.newContext({viewport:{width,height},isMobile:name==='mobile',hasTouch:name==='mobile'});
    await context.route('**/*',route=>{
      if(new URL(route.request().url()).origin!==preview.url){external.push(route.request().url());return route.abort()}
      return route.continue();
    });
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
    await page.goto(preview.url);await expect(page.locator('#membersTotal')).toHaveText('128');
    await expect(page.locator('#stockTotal')).toHaveText('72');await expect(page.locator('#deliveredTotal')).toHaveText('12');
    await expect(page.locator('#stockBars .bar')).toHaveCount(4);
    await expect(page.locator('#actions a[href="loans.html"]')).toBeVisible();
    await expect(page.locator('#actions a[href="intake-workspace.html"]')).toBeVisible();
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No page-wide overflow: '+name);
    if(name==='mobile'){
      const action=await page.locator('#actions a').last().boundingBox();assert(action.x>=0&&action.x+action.width<=width,'Mobile action links fit without horizontal scrolling');
      await expect(page.locator('#navigation')).toBeHidden();await page.locator('#menu').click();
      await expect(page.locator('#navigation')).toBeVisible();await expect(page.locator('#menu')).toHaveAttribute('aria-expanded','true');
      await page.keyboard.press('Escape');await expect(page.locator('#navigation')).toBeHidden();
    }else await expect(page.locator('#navigation')).toBeVisible();
    await page.locator('#refresh').click();await expect(page.locator('#loadStatus')).toContainText('已读取最新数据');
    await page.screenshot({path:'test-results/dashboard-'+name+'.png',fullPage:true});
    await context.close();
  }
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  console.log('Dashboard desktop/mobile passed: synthetic counts, age bands, correct task links, refresh, menu/Escape and no page overflow. No production data or network used.');
}finally{if(browser)await browser.close();await preview.close()}
