import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {startPreview} from './serve-operations.mjs';
const preview=await startPreview({seed:false,lifecycle:true});let browser;
try {
 browser=await chromium.launch(process.platform==='win32'?{channel:'msedge'}:{});
 const page=await browser.newPage({viewport:{width:1365,height:900}}),errors=[];
 await page.route('**/*',r=>new URL(r.request().url()).origin===preview.url?r.continue():r.abort());
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(preview.url+'/portal.html?previewRole=admin');
 const edit=plate=>page.locator('#stockList article').filter({hasText:plate}).locator('[data-edit]');
 await edit('DEMO01').click();const fuel=page.locator('[name=fuel_type]'),manual=page.locator('[name=fuel_typeManual]');
 await expect(fuel).toHaveValue('PETROL');await fuel.selectOption('PHEV');await page.locator('#saveVehicle').click();await expect(page.locator('#editorMessage')).toContainText('Saved to the database');await expect(fuel).toHaveValue('PHEV');
 await fuel.selectOption('__manual__');await expect(manual).toBeVisible();await manual.fill('   ');await page.locator('#saveVehicle').click();await expect(page.locator('#editorMessage')).toContainText('1–40');
 await manual.fill('  hydrogen  ');await page.locator('#saveVehicle').click();await expect(page.locator('#editorMessage')).toContainText('Saved to the database');await expect(fuel).toHaveValue('HYDROGEN');await expect(manual).toBeHidden();
 await page.reload();await edit('DEMO01').click();await expect(fuel).toHaveValue('HYDROGEN');await page.locator('#closeEditor').click();
 await edit('DEMO02').click();await expect(fuel).toHaveValue('PETROL');await expect(fuel.locator('option[value=HYDROGEN]')).toHaveCount(1);
 await fuel.selectOption('__manual__');await manual.fill('LPG');await fuel.selectOption('HYBRID');await expect(manual).toBeHidden();await expect(manual).toBeDisabled();
 await fuel.selectOption('__manual__');await manual.fill('LPG');
 if(process.env.FUEL_EVIDENCE)await page.screenshot({path:process.env.FUEL_EVIDENCE+'/desktop.png'});
 await page.setViewportSize({width:390,height:844});await manual.scrollIntoViewIfNeeded();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 if(process.env.FUEL_EVIDENCE)await page.screenshot({path:process.env.FUEL_EVIDENCE+'/mobile.png'});
 assert.deepEqual(errors,[]);console.log('PASS actual portal: PHEV saved; blank custom rejected; new fuel saved, reloaded and reused on another car; select switching and mobile layout.');
} finally {await browser?.close();await preview.close();}
