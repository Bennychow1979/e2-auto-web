import {chromium,expect} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {startPreview} from './serve-operations.mjs';

const preview=await startPreview({seed:false}),dir=process.env.DISPATCH_SCREENSHOTS;
let browser;
try{
 if(dir)await mkdir(dir,{recursive:true});
 browser=await chromium.launch(process.platform==='win32'?{channel:'msedge'}:{});
 const p=await browser.newPage({viewport:{width:1366,height:900}}),errors=[];
 p.on('pageerror',e=>errors.push(e.message));p.on('dialog',d=>d.accept());
 await p.goto(preview.url+'/operations.html?previewRole=admin');
 await p.locator('#createJob').click();
 const search=p.locator('#dispatchVehicleSearch'),vehicle=p.locator('#dispatchVehicle');
 await expect(vehicle).toHaveValue('');
 await search.fill('demo vehicle');await expect(vehicle.locator('option')).toHaveCount(3);
 await search.fill(' de mo-02 ');await expect(vehicle.locator('option')).toHaveCount(2);
 await expect(vehicle).toHaveValue('');
 await vehicle.selectOption(preview.ids.car2);
 await search.fill('missing999');await expect(vehicle).toHaveValue('');
 await expect(p.locator('#dispatchVehicleResults')).toContainText('No matching stock vehicle');
 assert.equal(await vehicle.evaluate(el=>el.checkValidity()),false,'no match cannot silently submit another vehicle');
 await search.fill('');await expect(vehicle.locator('option')).toHaveCount(3);
 await search.fill('demo02');await vehicle.selectOption(preview.ids.car2);
 await p.locator('#originSelect').selectOption('new');await p.locator('[name=origin]').fill('DEMO collection point');
 await p.locator('#destinationSelect').selectOption('new');await p.locator('[name=destination]').fill('DEMO showroom');
 if(dir){await p.locator('#dispatchDialog').evaluate(el=>el.scrollTop=0);await p.screenshot({path:resolve(dir,'dispatch-search-desktop.png')});}
 await p.locator('#dispatchForm button[type=submit]').click();
 await expect(p.locator('#jobTitle')).toContainText('DEMO02');
 await p.locator('#editDispatch').click();
 await expect(search).toBeDisabled();await expect(vehicle).toBeDisabled();await expect(vehicle).toHaveValue(preview.ids.car2);
 await p.getByRole('button',{name:'Close dispatch',exact:true}).click();
 const mobile=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 const m=await mobile.newPage();
 await m.goto(preview.url+'/operations.html?previewRole=admin');await m.locator('#createJob').tap();
 await m.locator('#dispatchVehicleSearch').tap();await m.locator('#dispatchVehicleSearch').fill('demo01');
 await expect(m.locator('#dispatchVehicle option')).toHaveCount(2);
 await m.locator('#dispatchVehicle').selectOption(preview.ids.car);
 await expect(m.locator('#dispatchVehicle')).toHaveValue(preview.ids.car);
 assert(await m.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'mobile page fits');
 assert(await m.locator('#dispatchDialog').evaluate(el=>el.scrollWidth<=el.clientWidth),'mobile form fits');
 if(dir){await m.locator('#dispatchDialog').evaluate(el=>el.scrollTop=0);await m.screenshot({path:resolve(dir,'dispatch-search-mobile.png')});}
 await mobile.close();assert.deepEqual(errors,[]);
 console.log('Dispatch search passed: plate/model filtering, spaces/case, explicit selection, empty results, correct saved vehicle, immutable edits and mobile touch. Synthetic local records only.');
}finally{if(browser)await browser.close();await preview.close();}
