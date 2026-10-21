import {chromium,expect} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {startPreview} from './serve-operations.mjs';
const preview=await startPreview({seed:false}),dir=process.env.DISPATCH_DRAFT_EVIDENCE;
let browser;
try{
 if(dir)await mkdir(dir,{recursive:true});
 browser=await chromium.launch(process.platform==='win32'?{channel:'msedge'}:{});
 const errors=[],external=[];
 const context=await browser.newContext({viewport:{width:1366,height:900}});
 await context.route('**/*',route=>{
  if(new URL(route.request().url()).origin!==preview.url){external.push(route.request().url());return route.abort();}
  return route.continue();
 });
 const p=await context.newPage();p.on('pageerror',e=>{errors.push(e.message);console.error('PAGE ERROR',e.message)});p.on('dialog',d=>d.accept());
 await p.goto(preview.url+'/operations.html?previewRole=admin');await p.locator('#createJob').click();
 const search=p.locator('#dispatchVehicleSearch'),add=p.locator('#addDispatchVehicle'),f=p.frameLocator('#dispatchDraftFrame');
 await expect(add).toBeHidden();await search.fill('DEMO01');await expect(add).toBeHidden();
 await search.fill('DEMO88');await expect(add).toBeVisible();
 await p.locator('#dispatchForm [name=assigned_to]').selectOption(preview.ids.runner2);
 await p.locator('#dispatchForm [name=kind]').selectOption('carro_pickup');
 await p.locator('#originSelect').selectOption('new');await p.locator('#dispatchForm [name=origin]').fill('DEMO Carro');
 await p.locator('#destinationSelect').selectOption('new');await p.locator('#dispatchForm [name=destination]').fill('DEMO Showroom');
 await p.locator('#dispatchForm [name=appointment_at]').fill('2026-10-25T10:00');
 await p.locator('#dispatchForm [name=instructions]').fill('LOCAL PREVIEW ONLY — keep this instruction');
 if(dir){await search.focus();await p.screenshot({path:resolve(dir,'add-vehicle-desktop.png')});}
 await add.click();await expect(f.locator('#vehicleEditor')).toBeVisible();
 await expect(f.locator('[name=plate]')).toHaveValue('DEMO88');
 await expect(f.locator('#publishVehicle')).toBeHidden();
 const token=new URL(await p.locator('#dispatchDraftFrame').getAttribute('src')).searchParams.get('dispatchDraft');
 await p.evaluate(({token,id})=>window.postMessage({type:'e2-dispatch-saved',token,vehicleId:id},location.origin),{token,id:preview.ids.car});
 await expect(p.locator('#dispatchVehicle')).toHaveValue('');
 await expect(p.locator('#dispatchDraftDialog')).toBeVisible();
 // Cancel an edited form without losing dispatch details or creating a record.
 await f.locator('[name=plate]').fill('DEMO89');await p.locator('#closeDispatchDraft').click();
 await expect(p.locator('#dispatchDraftDialog')).not.toBeVisible();
 await expect(search).toHaveValue('DEMO88');
 await add.click();await expect(f.locator('#vehicleEditor')).toBeVisible();
 await expect(f.locator('[name=brand]')).toBeHidden();await expect(f.locator('[name=price]')).toBeHidden();
 // Existing unique plate is rejected; no unrelated vehicle is selected.
 await f.locator('[name=plate]').fill('DEMO01');await f.locator('#saveVehicle').click();
 await expect(f.locator('#editorMessage')).toContainText(/duplicate|already exists/i);
 await expect(p.locator('#dispatchVehicle')).toHaveValue('');
 await f.locator('[name=plate]').fill('DEMO88');
 if(dir){await f.locator('[name=plate]').focus();await p.screenshot({path:resolve(dir,'vehicle-draft-desktop.png')});}
 // A failed workspace refresh must allow retrying the saved draft, not duplicate insert.
 let failRefresh=true;
 await p.route('**/preview-api/rpc',route=>{
  if(failRefresh&&route.request().postDataJSON()?.name==='e2_operations_workspace'){failRefresh=false;return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Preview connection interrupted'})});}
  return route.continue();
 });
 await f.locator('#saveVehicle').click();
 await expect(p.locator('#dispatchDraftMessage')).toContainText('Preview connection interrupted');
 await expect(f.locator('#saveVehicle')).toBeEnabled();await f.locator('#saveVehicle').click();
 await expect(p.locator('#dispatchDraftDialog')).not.toBeVisible();
 await expect(search).toHaveValue('DEMO88');
 const id=await p.locator('#dispatchVehicle').inputValue();assert(id);
 for(const [name,value] of Object.entries({assigned_to:preview.ids.runner2,kind:'carro_pickup',origin:'DEMO Carro',destination:'DEMO Showroom',appointment_at:'2026-10-25T10:00',instructions:'LOCAL PREVIEW ONLY — keep this instruction'}))await expect(p.locator(`#dispatchForm [name=${name}]`)).toHaveValue(value);
 const vehicles=await (await context.request.get(preview.url+'/preview-api/vehicles',{headers:{'X-Preview-Role':'admin'}})).json();
 const created=vehicles.filter(v=>v.plate==='DEMO88');assert.equal(created.length,1);assert.equal(created[0].publication,'draft');assert.equal(created[0].id,id);assert.equal(created[0].import_pending,true);
 for(const field of ['brand','model','year','engine_litres','transmission','fuel_type','price','mileage'])assert.equal(created[0][field],null,field+' is unknown, not a placeholder');
 assert.equal(vehicles.some(v=>v.plate==='DEMO89'),false);
 const publicRows=await (await context.request.get(preview.url+'/preview-api/vehicles',{headers:{'X-Preview-Role':'anonymous'}})).json();
 assert(!publicRows.some(v=>v.id===id),'draft is not publicly readable');
 if(dir){await search.focus();await p.screenshot({path:resolve(dir,'draft-selected-desktop.png')});}
 await p.locator('#dispatchForm button[type=submit]').click();await expect(p.locator('#jobTitle')).toContainText('DEMO88');
 await p.locator('#editDispatch').click();await expect(add).toBeHidden();await expect(p.locator('#dispatchVehicle')).toHaveValue(id);
 const mobile=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 const m=await mobile.newPage();m.on('dialog',d=>d.accept());m.on('pageerror',e=>errors.push(e.message));
 await m.goto(preview.url+'/operations.html?previewRole=admin');await m.locator('#createJob').tap();await m.locator('#dispatchVehicleSearch').fill('DEMO99');
 if(dir)await m.screenshot({path:resolve(dir,'add-vehicle-mobile.png')});
 await m.locator('#addDispatchVehicle').tap();const mf=m.frameLocator('#dispatchDraftFrame');await expect(mf.locator('#vehicleEditor')).toBeVisible();
 assert(await m.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 assert(await mf.locator('#vehicleEditor').evaluate(el=>el.scrollWidth<=el.clientWidth),'mobile editor has no horizontal overflow');
 if(dir)await m.screenshot({path:resolve(dir,'vehicle-draft-mobile.png')});
 await mf.locator('#saveVehicle').tap();await expect(m.locator('#dispatchDraftDialog')).not.toBeVisible();
 await expect(m.locator('#dispatchVehicle option:checked')).toContainText('DEMO99');
 // Neither the Runner UI nor the database allows a Runner to create stock.
 const runner=await context.newPage();await runner.goto(preview.url+'/operations.html?previewRole=runner');await expect(runner.locator('#createJob')).toBeHidden();
 const denied=await context.request.post(preview.url+'/preview-api/table',{headers:{'X-Preview-Role':'runner'},data:{table:'vehicles',mode:'insert',value:{id:crypto.randomUUID(),plate:'DEMONO',brand:'Demo',model:'Vehicle',year:2020,engine_litres:1.5,transmission:'Auto',fuel_type:'PETROL',price:50000,publication:'draft'}}});assert(!denied.ok());
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 console.log('Dispatch draft passed: no-match action, existing editor, private draft, duplicate plate rejection, cancel, preserved job fields, retry without duplicate, saved job linkage, mobile touch/layout and Runner RLS denial. No production data or network used.');
}finally{if(browser)await browser.close();await preview.close();}
