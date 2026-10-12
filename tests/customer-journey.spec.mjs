import {test as base, expect} from '@playwright/test';
import {initializeCustomerJourney, sdkMock, alice, bob, aliceLoan, bobLoan} from './fixtures/customer-journey.mjs';
import {pdfBytes, pngBytes} from './fixtures/preview-fixtures.mjs';

// Real pages and real data adapters; only the SDK and public-contact HTTP boundary
// are synthetic. Unexpected external requests are aborted and fail the test.
const test=base.extend({
  fixture: async({context,baseURL},use)=>{
    const external=[],errors=[];
    context.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));
    await context.route('**/*',async route=>{
      const url=new URL(route.request().url());
      if(url.origin===new URL(baseURL).origin){
        if(url.pathname==='/e2-config.js')return route.fulfill({contentType:'text/javascript',body:'window.E2_CONFIG={supabaseUrl:"https://synthetic-customer.supabase.co",publishableKey:"sb_publishable_synthetic"};'});
        return route.continue();
      }
      if(url.href==='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.4/+esm')return route.fulfill({contentType:'text/javascript',body:sdkMock});
      if(url.origin==='https://synthetic-customer.supabase.co'&&url.pathname==='/rest/v1/staff_profiles')return route.fulfill({json:[]});
      if(['http:','https:'].includes(url.protocol)){external.push(url.href);return route.abort('blockedbyclient');}
      return route.continue();
    });
    await use(async options=>context.addInitScript(initializeCustomerJourney,options||{}));
    expect(external,'No unexpected external/backend traffic').toEqual([]);
    expect(errors,'No unhandled browser errors').toEqual([]);
  },
});
const login=async(page,email='alice@example.test',password='Synthetic-only-123!')=>{
  await page.locator('#customerSignIn [name=email]').fill(email);
  await page.locator('#customerSignIn [name=password]').fill(password);
  await page.locator('#customerSignIn [type=submit]').click();
};
const count=(page,op)=>page.evaluate(op=>window.__customerFixture.snapshot().calls.filter(c=>c.op===op).length,op);
const readyDocs=page=>page.evaluate(()=>Object.values(window.__customerFixture.snapshot().docs).filter(d=>d.state==='ready'&&!d.removed_at).map(d=>({id:d.id,filename:d.filename})));
async function upload(page,{name='synthetic.pdf',buffer=pdfBytes,type='application/pdf',category='ic_front',replace}={}){
  await page.locator(replace?`[data-replace="${replace}"]`:`[data-add="${category}"]`).click();
  await page.locator('#documentFiles').setInputFiles({name,mimeType:type,buffer:Buffer.from(buffer)});
  await page.locator('#documentConsent').check();
  await page.locator('#uploadSubmit').click();
}
async function expectGate(page,path){
  if(path.startsWith('/customer')){await expect(page.locator('#customerAccount')).toBeHidden();await expect(page.locator('#customerAuth')).toBeVisible();}
  else await expect(page.locator(path.startsWith('/documents')?'#documentMain':'#main')).toContainText('Sign in');
  await expect(page.locator('body')).not.toContainText('Alice private');
}

test('registration validates, prevents duplicates, requires confirmation, then restores profile',async({page,fixture})=>{
  await fixture({session:false});await page.goto('/customer.html');await page.locator('#showRegister').click();
  const form=page.locator('#customerRegister');
  for(const [name,value] of Object.entries({full_name:'Carol Synthetic',email:'carol@example.test',phone:'0123456789',password:'Synthetic-only-123!',confirm:'Different-pass-123!'}))await form.locator(`[name=${name}]`).fill(value);
  await form.locator('[name=privacy]').check();await form.locator('[type=submit]').click();
  await expect(page.locator('#customerAuthMessage')).toContainText('do not match');expect(await count(page,'signUp')).toBe(0);
  await form.locator('[name=confirm]').fill('Synthetic-only-123!');await page.evaluate(()=>window.__customerFixture.hold('signUp'));
  await form.locator('[type=submit]').click();await form.dispatchEvent('submit');expect(await count(page,'signUp')).toBe(1);
  await page.evaluate(()=>window.__customerFixture.release('signUp'));await expect(page.locator('#customerAuthMessage')).toContainText('Check your inbox');
  await expect(page.locator('#customerForgot')).toBeDisabled();await expect(page.locator('#customerResend')).toBeDisabled();
  await login(page,'carol@example.test');await expect(page.locator('#customerAuthMessage')).toContainText('Could not sign in');
  await page.evaluate(()=>window.__customerFixture.confirm('carol@example.test'));await login(page,'carol@example.test');
  await expect(page.locator('#customerProfile [name=full_name]')).toHaveValue('Carol Synthetic');
  await page.reload();await expect(page.locator('#customerEmail')).toHaveValue('carol@example.test');
  expect(await page.evaluate(()=>window.__customerFixture.snapshot().sessions['e2-staff-auth'])).toBe('synthetic-staff');
});

test('registration interruption retains inputs and cooldown prevents accidental retries',async({page,fixture})=>{
  await fixture({session:false});await page.goto('/customer.html');await page.locator('#showRegister').click();
  for(const [name,value] of Object.entries({full_name:'Carol Synthetic',email:'carol@example.test',phone:'0123456789',password:'Synthetic-only-123!',confirm:'Synthetic-only-123!'}))await page.locator(`#customerRegister [name=${name}]`).fill(value);
  await page.locator('#customerRegister [name=privacy]').check();await page.evaluate(()=>window.__customerFixture.fail('signUp'));
  await page.locator('#customerRegister [type=submit]').click();await expect(page.locator('#customerAuthMessage')).toContainText('Could not complete registration');
  await expect(page.locator('#customerRegister [name=email]')).toHaveValue('carol@example.test');
  await page.locator('#customerRegister').dispatchEvent('submit');expect(await count(page,'signUp')).toBe(1);
});

test('invalid login, profile save interruption/retry, reload, and local signout',async({page,fixture})=>{
  await fixture({session:false});await page.goto('/customer.html');await login(page,'alice@example.test','wrong');
  await expect(page.locator('#customerAccount')).toBeHidden();await expect(page.locator('#customerAuthMessage')).toContainText('Could not sign in');
  await login(page);await expect(page.locator('#customerEmail')).toHaveValue('alice@example.test');
  await page.locator('#customerProfile [name=city]').fill('Synthetic city');await page.evaluate(()=>window.__customerFixture.fail('rpc:e2_save_customer_profile'));
  await page.locator('#customerProfile [type=submit]').click();await expect(page.locator('#customerProfileMessage')).toContainText('Synthetic interrupted');
  await expect(page.locator('#customerProfile [name=city]')).toHaveValue('Synthetic city');await page.locator('#customerProfile [type=submit]').click();
  await expect(page.locator('#customerProfileMessage')).toContainText('have been saved');await page.reload();await expect(page.locator('#customerProfile [name=city]')).toHaveValue('Synthetic city');
  await page.locator('#customerSignOut').click();await expectGate(page,'/customer');await page.reload();await expectGate(page,'/customer');
  expect(await page.evaluate(()=>window.__customerFixture.snapshot().sessions['e2-staff-auth'])).toBe('synthetic-staff');
});

for(const button of ['customerForgot','customerResend'])test(`${button} handles interruptions and shared email cooldown`,async({page,fixture})=>{
  await fixture({session:false});await page.goto('/customer.html');await page.locator('#customerSignIn [name=email]').fill('alice@example.test');
  await page.evaluate(op=>window.__customerFixture.fail(op),button==='customerForgot'?'resetEmail':'resendEmail');await page.locator('#'+button).click();
  await expect(page.locator('#customerAuthMessage')).toContainText('could not be completed');await expect(page.locator('#customerForgot')).toBeDisabled();await expect(page.locator('#customerResend')).toBeDisabled();
  await page.reload();await expect(page.locator('#customerForgot')).toBeDisabled();
});

test('recovery validates, survives interrupted update, clears URL, and requires new login',async({page,fixture})=>{
  await fixture({recovery:true});await page.goto('/customer.html?code=synthetic-only#type=recovery');
  await expect(page.locator('#customerRecovery')).toBeVisible();await expect(page).toHaveURL(/\/customer.html$/);
  await page.locator('#customerPassword [name=password]').fill('Replacement-only-123!');await page.locator('#customerPassword [name=confirm]').fill('Mismatch-only-123!');await page.locator('#customerPassword button').click();
  await expect(page.locator('#customerRecoveryMessage')).toContainText('do not match');expect(await count(page,'updatePassword')).toBe(0);
  await page.locator('#customerPassword [name=confirm]').fill('Replacement-only-123!');await page.evaluate(()=>window.__customerFixture.fail('updatePassword'));await page.locator('#customerPassword button').click();
  await expect(page.locator('#customerRecoveryMessage')).toContainText('Could not save');await page.locator('#customerPassword button').click();
  await expect(page.locator('#customerAuthMessage')).toContainText('Password saved');await expectGate(page,'/customer');
  await login(page,'alice@example.test','Replacement-only-123!');await expect(page.locator('#customerAccount')).toBeVisible();
  expect(await page.evaluate(()=>sessionStorage.getItem('e2-customer-recovery'))).toBeNull();
});

test('expired confirmation/recovery links show actionable retry and clear URL',async({page,fixture})=>{
  await fixture({session:false});await page.goto('/customer.html?error=expired#synthetic-token');await expect(page.locator('#customerAuthMessage')).toContainText('expired or was already used');await expect(page).toHaveURL(/\/customer.html$/);await expectGate(page,'/customer');
});

for(const path of ['/customer.html',`/my-e2.html?application=${aliceLoan}`,`/documents.html?application=${aliceLoan}`]){
  test(`cross-tab account switch immediately clears old customer data: ${path}`,async({page,context,fixture})=>{
    await fixture();await page.goto(path);
    if(path.startsWith('/customer'))await expect(page.locator('#customerEmail')).toHaveValue('alice@example.test');
    else await expect(page.locator('body')).toContainText('Alice private vehicle');
    const other=await context.newPage();await other.goto('/customer.html');await expect(other.locator('#customerAccount')).toBeVisible();
    await other.evaluate(id=>window.__customerFixture.switchUser(id),bob);await expectGate(page,path);
    await page.reload();
    if(path.startsWith('/customer'))await expect(page.locator('#customerEmail')).toHaveValue('bob@example.test');
    else {await expect(page.locator('body')).not.toContainText('Alice private');await expect(page.locator('body')).not.toContainText('Alice Example');}
  });
  test(`account switch cancels a pending initial identity read: ${path}`,async({page,fixture})=>{
    await fixture({hold:['getUser']});await page.goto(path);await expect.poll(()=>count(page,'getUser')).toBeGreaterThan(0);
    await page.evaluate(id=>{window.__customerFixture.switchUser(id);window.__customerFixture.release('getUser');},bob);
    await expectGate(page,path);
    if(path.startsWith('/customer'))await expect(page.locator('#customerProfile [name=full_name]')).toHaveValue('');
  });
}

test('same-account token refresh preserves an unsaved profile',async({page,fixture})=>{
  await fixture();await page.goto('/customer.html');await expect(page.locator('#customerAccount')).toBeVisible();await page.locator('#customerProfile [name=city]').fill('Unsaved synthetic city');
  for(const event of ['TOKEN_REFRESHED','SIGNED_IN']){await page.evaluate(({id,event})=>window.__customerFixture.switchUser(id,event),{id:alice,event});await expect(page.locator('#customerProfile [name=city]')).toHaveValue('Unsaved synthetic city');}
});

test('pending profile response cannot repopulate signed-out or switched account',async({page,fixture})=>{
  await fixture();await page.goto('/customer.html');await expect(page.locator('#customerAccount')).toBeVisible();await page.locator('#customerProfile [name=city]').fill('Alice private city');
  await page.evaluate(()=>window.__customerFixture.hold('rpc:e2_save_customer_profile'));await page.locator('#customerProfile [type=submit]').click();
  await expect.poll(()=>count(page,'rpc:e2_save_customer_profile')).toBe(1);await page.evaluate(id=>{window.__customerFixture.switchUser(id);window.__customerFixture.release('rpc:e2_save_customer_profile');},bob);
  await expectGate(page,'/customer');await expect(page.locator('#customerProfile [name=city]')).toHaveValue('');
});

test('own application and progress only; cross-customer and signed-out direct links deny access',async({page,fixture})=>{
  await fixture();await page.goto(`/my-e2.html?application=${aliceLoan}`);await expect(page.locator('#loanHistory')).toContainText('Alice private progress');await expect(page.locator('body')).not.toContainText('Bob private');
  await page.goto(`/my-e2.html?application=${bobLoan}`);await expect(page.locator('#main')).toContainText('My applications');await expect(page.locator('body')).not.toContainText('Bob private');
  await page.goto(`/documents.html?application=${bobLoan}`);await expect(page.locator('#documentMain')).toContainText('unavailable');await expect(page.locator('[data-add]')).toHaveCount(0);
  await page.evaluate(()=>window.__customerFixture.switchUser(null,'SIGNED_OUT'));await page.goto(`/my-e2.html?application=${aliceLoan}`);await expectGate(page,'/my-e2');await page.goto(`/documents.html?application=${aliceLoan}`);await expectGate(page,'/documents');
});

test('document upload retry, duplicate submit, lost finalize response, PDF and PNG previews',async({page,fixture},testInfo)=>{
  await fixture();await page.goto(`/documents.html?application=${aliceLoan}`);await expect(page.locator('[data-add=ic_front]')).toBeVisible();
  await page.evaluate(()=>window.__customerFixture.fail('upload'));await upload(page);await expect(page.locator('#uploadMessage')).toContainText('Synthetic interrupted');expect(await readyDocs(page)).toEqual([]);
  await page.locator('#closeUpload').click();await page.evaluate(()=>{window.__customerFixture.hold('upload');window.__customerFixture.fail('rpc:e2_finish_document','after');});await upload(page);
  await page.locator('#uploadForm').dispatchEvent('submit');await expect.poll(()=>count(page,'upload')).toBe(2);await page.evaluate(()=>window.__customerFixture.release('upload'));
  await expect(page.locator('#documentStatus')).toContainText('1 file uploaded');expect((await readyDocs(page))).toHaveLength(1);expect(await count(page,'rpc:e2_reserve_document')).toBe(2);
  await page.locator('[data-preview]').click();await expect(page.locator('#previewDialog canvas')).toBeVisible();await expect(page.locator('#previewContent')).toContainText('Page 1 of 2');
  await testInfo.attach('synthetic-customer-pdf',{body:await page.screenshot(),contentType:'image/png'});await page.locator('#closePreview').click();
  await upload(page,{name:'synthetic.png',buffer:pngBytes,type:'image/png',category:'ic_back'});await expect(page.locator('#uploadDialog')).toBeHidden();
  const docs=await readyDocs(page);expect(docs).toHaveLength(2);await page.locator(`[data-preview="${docs.find(d=>d.filename.endsWith('.png')).id}"]`).click();await expect(page.locator('#previewContent img')).toBeVisible();
  await page.evaluate(()=>window.__customerFixture.switchUser(null,'SIGNED_OUT'));await expectGate(page,'/documents');await expect(page.locator('#previewDialog')).toBeHidden();await expect(page.locator('#previewContent canvas, #previewContent img, #previewContent a[download]')).toHaveCount(0);
});

test('failed replacement preserves original and retry replaces once',async({page,fixture})=>{
  await fixture();await page.goto(`/documents.html?application=${aliceLoan}`);await upload(page);await expect(page.locator('#uploadDialog')).toBeHidden();const original=(await readyDocs(page))[0];
  await page.evaluate(()=>window.__customerFixture.fail('rpc:e2_finish_document'));await upload(page,{name:'replacement.pdf',replace:original.id});await expect(page.locator('#uploadMessage')).toContainText('Synthetic interrupted');expect(await readyDocs(page)).toEqual([original]);
  await page.locator('#closeUpload').click();await upload(page,{name:'replacement.pdf',replace:original.id});await expect(page.locator('#uploadDialog')).toBeHidden();expect((await readyDocs(page)).map(d=>d.filename)).toEqual(['replacement.pdf']);
});

test('signout during upload or download prevents stale document UI returning',async({page,fixture})=>{
  await fixture();await page.goto(`/documents.html?application=${aliceLoan}`);await upload(page);await expect(page.locator('#uploadDialog')).toBeHidden();
  await page.evaluate(()=>window.__customerFixture.hold('download'));await page.locator('[data-preview]').click();await expect.poll(()=>count(page,'download')).toBe(1);
  await page.evaluate(()=>{window.__customerFixture.switchUser(null,'SIGNED_OUT');window.__customerFixture.release('download');});await expectGate(page,'/documents');await expect(page.locator('#previewDialog')).toBeHidden();
  await page.evaluate(id=>window.__customerFixture.switchUser(id),alice);await page.reload();await expect(page.locator('[data-add=ic_back]')).toBeVisible();await page.evaluate(()=>window.__customerFixture.hold('upload'));await upload(page,{name:'interrupted.pdf',category:'ic_back'});
  await expect.poll(()=>count(page,'upload')).toBe(2);await page.evaluate(()=>{window.__customerFixture.switchUser(null,'SIGNED_OUT');window.__customerFixture.release('upload');});await expectGate(page,'/documents');await expect(page.locator('#uploadDialog')).toBeHidden();expect(await count(page,'rpc:e2_finish_document')).toBe(1);
});

test('login through new draft, save/reload, upload, submit and updated progress',async({page,fixture})=>{
  await fixture({session:false});await page.goto('/customer.html');await login(page);await expect(page.locator('#customerAccount')).toBeVisible();await page.locator('#customerAccount a[href="my-e2.html"]').click();
  await page.locator('#main [data-page=choose]').click();await page.locator('[data-start]').click();await page.locator('#startForm input[type=checkbox]').check();await page.locator('#startForm [type=submit]').click();
  await expect(page.locator('#loanForm')).toBeVisible();const appId=new URL(page.url()).searchParams.get('application');
  await page.locator('#field_deposit').fill('8000');await page.locator('#field_tenure').selectOption('5 years');await page.locator('#saveDraft').click();await expect(page.locator('#toast')).toContainText('has been saved');await page.reload();await expect(page.locator('#field_deposit')).toHaveValue('8000');
  for(let step=0;step<6;step++){
    const controls=await page.locator('#loanForm [name]').evaluateAll(nodes=>nodes.map(n=>({name:n.name,tag:n.tagName,type:n.type,value:n.value,options:n.options?[...n.options].map(o=>o.value):null})));
    for(const c of controls){const el=page.locator(`#loanForm [name="${c.name}"]`);if(c.value)continue;if(c.tag==='SELECT')await el.selectOption(c.options.find(Boolean));else await el.fill(c.type==='number'?'2':c.type==='email'?'alice@example.test':c.type==='tel'?'60111111111':c.name==='ic'?'900101000001':'Synthetic '+c.name);}
    await page.locator('#loanForm [type=submit]').click();await expect(page.locator('.wizardBody .eyebrow')).toContainText(`STEP ${step+2} OF 7`);
  }
  await page.locator('#loanForm [data-page=documents]').click();await page.locator('#applicantType').selectOption('worker');await page.locator('#typeForm button').click();await expect(page.locator('[data-add=ic_front]')).toBeVisible();await upload(page);await expect(page.locator('#uploadDialog')).toBeHidden();
  await page.locator('#returnLink').click();await expect(page.locator('#confirmDetails')).toBeVisible();await page.locator('#confirmDetails').check();await page.locator('#confirmContacts').check();await page.locator('#loanForm [type=submit]').click();await expect(page.locator('#loanHistory')).toContainText('Synthetic submission received');
  await page.evaluate(id=>window.__customerFixture.progress(id,'In review','Synthetic E2 review update'),appId);await page.reload();await expect(page.locator('#loanHistory')).toContainText('Synthetic E2 review update');await expect(page.locator('body')).not.toContainText('Bob private');
});

for(const button of ['customerForgot','customerResend'])test(`${button} reports accepted request without claiming email delivery`,async({page,fixture})=>{
  await fixture({session:false});await page.goto('/customer.html');await page.locator('#customerSignIn [name=email]').fill('alice@example.test');await page.locator('#'+button).click();
  await expect(page.locator('#customerAuthMessage')).toContainText('If this email is eligible');expect(await count(page,button==='customerForgot'?'resetEmail':'resendEmail')).toBe(1);await expect(page.locator('#customerForgot')).toBeDisabled();await expect(page.locator('#customerResend')).toBeDisabled();
});

test('draft interruption keeps edits, same-user refresh preserves them, account switch cancels late save',async({page,fixture})=>{
  await fixture();await page.goto('/my-e2.html?car=cccccccc-cccc-4ccc-8ccc-cccccccccccc');await page.locator('#startForm input[type=checkbox]').check();await page.locator('#startForm [type=submit]').click();await expect(page.locator('#loanForm')).toBeVisible();
  await page.locator('#field_deposit').fill('12345');await page.locator('#field_tenure').selectOption('5 years');
  await page.evaluate(id=>window.__customerFixture.switchUser(id,'TOKEN_REFRESHED'),alice);await expect(page.locator('#field_deposit')).toHaveValue('12345');
  await page.evaluate(()=>window.__customerFixture.fail('rpc:e2_save_loan'));await page.locator('#saveDraft').click();await expect(page.locator('#loanError')).toContainText('Synthetic interrupted');await expect(page.locator('#field_deposit')).toHaveValue('12345');
  await page.evaluate(()=>window.__customerFixture.hold('rpc:e2_save_loan'));await page.locator('#saveDraft').click();await expect.poll(()=>count(page,'rpc:e2_save_loan')).toBe(2);
  await page.evaluate(id=>{window.__customerFixture.switchUser(id);window.__customerFixture.release('rpc:e2_save_loan');},bob);await expectGate(page,'/my-e2');await expect(page.locator('#loanForm')).toHaveCount(0);
});

test('late application history cannot restore old customer progress after switch',async({page,fixture})=>{
  await fixture({hold:['select:loan_events']});await page.goto(`/my-e2.html?application=${aliceLoan}`);await expect.poll(()=>count(page,'select:loan_events')).toBe(1);await expect(page.locator('#loanHistory')).toContainText('Loading progress');
  await page.evaluate(id=>{window.__customerFixture.switchUser(id);window.__customerFixture.release('select:loan_events');},bob);await expectGate(page,'/my-e2');await expect(page.locator('#loanHistory')).toHaveCount(0);
});
