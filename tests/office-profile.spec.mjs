import {test as base,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
const office='11111111-1111-4111-8111-111111111111',owner='22222222-2222-4222-8222-222222222222',other='33333333-3333-4333-8333-333333333333';
function initialize(options){
 if(!localStorage.officeProfileFixture)localStorage.officeProfileFixture=JSON.stringify({...options,profiles:{},calls:[],signedOut:false});
 window.officeState=()=>JSON.parse(localStorage.officeProfileFixture);
 window.officeSet=value=>localStorage.officeProfileFixture=JSON.stringify({...window.officeState(),...value});
 window.officeAuth=[];
}
const mock=`
export const configured=true;
export const check=r=>{if(r.error)throw r.error;return r.data};
export const friendlyError=e=>e.message;
export const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const rm=v=>'RM'+Number(v).toFixed(2);
export const getVehicles=async()=>[];
const current=()=>window.officeState(),ok=data=>({data});
const user=()=>({id:current().id,email:current().role+'@example.test'});
const actor=()=>({role:current().role,active:current().active});
const allowed=target=>current().active&&['super_admin','admin','office_admin','sales','account'].includes(current().role)&&(current().role==='super_admin'||target===current().id);
const call=(name,args)=>window.officeSet({calls:[...current().calls,{name,args}]});
export const db={
 auth:{getSession:async()=>ok({session:current().signedOut?null:{user:user()}}),getUser:async()=>ok({user:current().signedOut?null:user()}),onAuthStateChange:cb=>{window.officeAuth.push(cb)},signOut:async()=>{window.officeSet({signedOut:true});for(const cb of window.officeAuth)cb('SIGNED_OUT',null);return ok(null)}},
 from(table){let target;const q={select(){return q},eq(k,v){if(k==='user_id')target=v;return q},order(){return q},range(){return q},not(){return q},limit(){return q},single:async()=>ok(table==='staff_memberships'?actor():current().profiles[target]||null),maybeSingle:async()=>q.single(),then(resolve,reject){return Promise.resolve(ok([])).then(resolve,reject)}};return q},
 async rpc(name,args={}){
  call(name,args);
  if(name==='e2_profile_editor')return ok(allowed(args.target));
  if(name==='e2_is_super_admin')return ok(current().role==='super_admin');
  if(['rental_ok','e2_finance_is_dispatcher'].includes(name))return ok(false);
  if(name==='e2_list_staff'){
   if(current().role!=='super_admin')throw Error('Super Admin required');
   return ok([{user_id:'${owner}',email:'super@example.test',role:'super_admin',active:true,email_confirmed:true},{user_id:'${office}',email:'office@example.test',role:'office_admin',active:true,email_confirmed:true},{user_id:'${other}',email:'customer@example.test',role:'customer',active:true,email_confirmed:true}]);
  }
  if(name==='e2_save_profile'){
   if(!allowed(args.target))throw Error('You cannot edit this staff profile');
   if(current().failSave){window.officeSet({failSave:false});throw Error('Connection interrupted. Retry saving.');}
   const previous=current().profiles[args.target];if((previous?.revision||0)!==args.expected_revision)throw Error('Profile changed. Reload.');
   const row={...args.details,user_id:args.target,revision:args.expected_revision+1,is_public:false};window.officeSet({profiles:{...current().profiles,[args.target]:row}});return ok(row);
  }
  throw Error('Unexpected RPC '+name);
 },
 storage:{from:()=>({upload:async(path,blob,options)=>{call('upload',{path,type:blob.type,...options});return ok({path})},createSignedUrl:async()=>ok({signedUrl:'/assets/e2-logo.png'}),remove:async()=>ok(null)})}
};`;
const test=base.extend({setup:async({page,context,baseURL},use)=>{
 const external=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
 await context.route('**/*',route=>{
  const url=new URL(route.request().url());if(url.origin!==new URL(baseURL).origin){external.push(url.href);return route.abort()}
  if(url.pathname==='/e2-data.js')return route.fulfill({contentType:'text/javascript',body:mock});
  if(url.pathname==='/e2-config.js')return route.fulfill({contentType:'text/javascript',body:'window.E2_CONFIG={financingCases:false}'});
  return route.continue();
 });
 await use(async(options={})=>context.addInitScript(initialize,{id:office,role:'office_admin',active:true,...options}));
 expect(external).toEqual([]);expect(errors).toEqual([]);
}});

test('Office workspace leads to assigned applications and first profile save with portrait',async({page,setup},info)=>{
 await setup();await page.goto('/intake-workspace.html');await expect(page.getByRole('heading',{name:'Your office. Every next step.'})).toBeVisible();
 await page.getByRole('navigation',{name:'Workspace navigation'}).getByRole('link',{name:/Registered applications/}).click();
 await expect(page.locator('#staffLoans')).toContainText('Submitted applications within your assigned access.');
 await expect(page.getByRole('navigation').getByRole('link',{name:'Office workspace'})).toHaveAttribute('href','intake-workspace.html');
 await page.getByRole('navigation').getByRole('link',{name:'My profile'}).click();
 await expect(page.locator('#accountRole')).toHaveText('Office Admin');await expect(page.locator('#profileMessage')).toContainText('Add your details');
 await expect(page.locator('#teamLink')).toBeHidden();await expect(page.locator('#publishControls')).toBeHidden();
 await page.locator('[name=display_name]').fill('Synthetic Office Admin');await page.locator('[name=position]').fill('Office Admin');await page.locator('[name=whatsapp]').fill('012-345 6789');
 await page.locator('#portraitInput').setInputFiles({name:'synthetic-logo.png',mimeType:'image/png',buffer:await readFile(new URL('../assets/e2-logo.png',import.meta.url))});
 await expect(page.locator('#profileMessage')).toContainText('Photo prepared');await page.getByRole('button',{name:'Save profile',exact:true}).click();
 await expect(page.locator('#profileMessage')).toContainText('Profile saved');await expect(page.locator('#visibilityState')).toContainText('Private');
 const data=await page.evaluate(()=>window.officeState());expect(data.profiles[office].photo_path).toMatch(new RegExp('^'+office+'/.*webp$'));expect(data.profiles[office].whatsapp).toBe('60123456789');expect(data.profiles[office].is_public).toBe(false);
 await page.reload();await expect(page.locator('[name=display_name]')).toHaveValue('Synthetic Office Admin');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.screenshot({path:info.outputPath('office-profile.png'),fullPage:true});await page.locator('#profileHome').click();
 await expect(page.locator('#intakeWorkspace')).toContainText('Your office.');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.screenshot({path:info.outputPath('office-workspace.png')});
});

test('Office profile save failure keeps the draft and can be retried without publication',async({page,setup})=>{
 await setup({failSave:true});await page.goto('/profile.html');await expect(page.locator('#profileWorkspace')).toBeVisible();
 await page.locator('[name=display_name]').fill('Retry Office');await page.getByRole('button',{name:'Save profile',exact:true}).click();
 await expect(page.locator('#profileMessage')).toContainText('Connection interrupted');await expect(page.locator('[name=display_name]')).toHaveValue('Retry Office');
 expect(await page.evaluate(()=>window.officeState().profiles)).toEqual({});await page.getByRole('button',{name:'Save profile',exact:true}).click();await expect(page.locator('#profileMessage')).toContainText('Profile saved');
 await page.locator('#profileSignOut').click();await expect(page.locator('#profileWorkspace')).toBeHidden();await expect(page.locator('#gateMessage')).toHaveText('Signed out.');
});
for(const [label,options,url] of [['inactive Office',{active:false},'/profile.html'],['Customer',{role:'customer'},'/profile.html'],['another employee',{},'/profile.html?user='+other]])test(label+' cannot enter the staff profile editor',async({page,setup})=>{
 await setup(options);await page.goto(url);await expect(page.locator('#profileWorkspace')).toBeHidden();await expect(page.locator('#gateMessage')).toContainText(/active staff|cannot edit/i);
});
test('Super Admin can discover and edit Office profile from Users and profile picker',async({page,setup})=>{
 await setup({id:owner,role:'super_admin'});await page.goto('/team.html');await expect(page.locator('#teamWorkspace')).toBeVisible();
 const row=page.locator('.userRow').filter({hasText:'office@example.test'});await row.getByRole('link',{name:'Edit profile ↗'}).click();
 await expect(page.locator('#staffPicker')).toHaveValue(office);await expect(page.locator('#staffPicker option[value="'+office+'"]').first()).toHaveText('office@example.test');
 await page.locator('[name=display_name]').fill('Office maintained by Super Admin');await page.getByRole('button',{name:'Save profile',exact:true}).click();await expect(page.locator('#profileMessage')).toContainText('Profile saved');
 expect((await page.evaluate(()=>window.officeState())).profiles[office].is_public).toBe(false);
});

test('Office navigation fits a 320px screen including financing-case return links',async({page,setup},info)=>{
 await setup();await page.setViewportSize({width:320,height:800});
 for(const path of ['/intake-workspace.html','/loans.html','/financing-case.html']){
  await page.goto(path);const nav=page.getByRole('navigation',{name:'Workspace navigation'});
  await expect(nav.getByRole('link',{name:/My profile/i})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  if(path==='/intake-workspace.html')await page.screenshot({path:info.outputPath('office-workspace-320.png')});
 }
 await page.getByRole('navigation',{name:'Workspace navigation'}).getByRole('link',{name:'My Profile'}).click();await expect(page.locator('#accountRole')).toHaveText('Office Admin');
});
