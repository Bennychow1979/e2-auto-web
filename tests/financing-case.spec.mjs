import {test as base, expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {application, fixture, financingDataMock, ids, initializeFinancingFixture} from './fixtures/financing-fixtures.mjs';

// Parse emitted browser JavaScript during collection, before Chromium launches,
// and guard against accidentally importing a new unmocked backend export.
const mock = await import(`data:text/javascript;charset=utf-8,${encodeURIComponent(financingDataMock())}`);
const actualDataSource = await readFile(new URL('../financing-data.js', import.meta.url), 'utf8');
const actualExports = [...actualDataSource.matchAll(/export\s+(?:async\s+)?(?:function|const)\s+(\w+)/g)].map(match => match[1]);
for (const name of ['db', ...actualExports]) {
  if (!(name in mock)) throw Error(`financing-data.js export is not mocked: ${name}`);
}

const test = base.extend({
  audit: [async ({page, context, baseURL}, use) => {
    const result = {externalRequests: [], pageErrors: []};
    page.on('pageerror', error => result.pageErrors.push(error.message));
    // Exercise the enabled branch without changing the deployed default-off flag.
    await page.route('**/e2-config.js', route => route.fulfill({contentType:'text/javascript',body:'window.E2_CONFIG = Object.freeze({financingCases:true});'}));
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (['http:', 'https:'].includes(url.protocol) && url.origin !== new URL(baseURL).origin) {
        result.externalRequests.push(url.href);
        await route.abort('blockedbyclient');
      } else await route.continue();
    });
    await use(result);
    expect(result.externalRequests, 'No remote resources, lender requests, or backend requests are allowed').toEqual([]);
    expect(result.pageErrors, 'No unhandled browser exceptions').toEqual([]);
    if (!page.isClosed()) await expectNoOverflow(page);
  }, {auto: true}],
});

test.use({timezoneId: 'UTC'});

const form = (page, action) => page.locator(`form[data-action="${action}"]`);
const card = (page, id) => page.locator(`#application-${id}`);
const calls = (page, method) => page.evaluate(method => window.__financeFixture.calls.filter(call => call.method === method), method);
const state = page => page.evaluate(() => ({financeCase: window.__financeFixture.financeCase, applications: window.__financeFixture.applications}));
const summary = (parent, name) => parent.locator('summary').filter({hasText: name});

async function install(page, options = {}, source = 'intake', ready = true) {
  await page.addInitScript(initializeFinancingFixture, fixture(options));
  await page.route('**/financing-data.js*', route => route.fulfill({contentType: 'text/javascript', body: financingDataMock()}));
  await page.goto(`/financing-case.html?source=${source}&id=${ids.source}`);
  if (ready) await expect(page.getByRole('heading', {name: 'Synthetic test applicant', exact: true})).toBeVisible();
}
async function expectNoOverflow(page) {
  await expect.poll(() => page.evaluate(() => ({
    viewport: innerWidth, width: document.documentElement.scrollWidth,
  }))).toEqual({viewport: page.viewportSize().width, width: page.viewportSize().width});
}
async function release(page, method, settled = 1) {
  await page.evaluate(method => window.__financeFixture.release(method), method);
  await expect.poll(() => page.evaluate(method => window.__financeFixture.settled[method] || 0, method)).toBe(settled);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function expectPrivateUICleared(page) {
  await expect(page.getByRole('link', {name: /staff sign in/i})).toBeVisible();
  await expect(page.locator('#financeMain')).not.toContainText('Synthetic');
  await expect(page.locator('#financeMain form, .financeApplication, [data-file]')).toHaveCount(0);
  await expect(page.locator('#financeFilePreview')).not.toBeVisible();
  await expect(page.locator('#financeFilePreview canvas, #financeFilePreview img, #financeFilePreview a[download]')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__financeFixture.liveURLs.size)).toBe(0);
}
// Match the computed accessible name, not a wrapping label's raw descendant
// text: nested select options and server-rendered textarea contents are text
// descendants but are correctly excluded from the control's accessible name.
async function fillDraft(page, channel) {
  await summary(page, 'Add an institution application').click();
  const draft = page.locator('form[data-action="save-application"][data-id=""]');
  await draft.getByRole('combobox', {name: 'Bank / credit company', exact: true}).selectOption(ids[channel]);
  const channelSelect = draft.getByRole('combobox', {name: 'Submission channel', exact: true});
  await expect(channelSelect).toHaveValue('');
  await expect(channelSelect).toHaveAttribute('required', '');
  await channelSelect.selectOption(channel);
  await draft.getByRole('checkbox', {name: 'synthetic-identity.pdf', exact: true}).check();
  if (channel === 'email') {
    await draft.getByRole('textbox', {name: 'Email subject (email only)', exact: true}).fill('Synthetic email subject');
    await draft.getByRole('textbox', {name: 'Email message (email only)', exact: true}).fill('Synthetic prepared email. Attach documents manually.');
  }
  return draft;
}

for (const source of ['intake', 'loan']) {
  test(`${source}: opening an application is read-only until Start case tracking is pressed`, async ({page}) => {
    await install(page, {role: 'sales', tracking: false, handed: false}, source);
    expect(await calls(page, 'start')).toEqual([]);
    await expect(page.getByRole('button', {name: 'Start case tracking', exact: true})).toBeVisible();
    await expect(form(page, 'review')).toHaveCount(0);
    await page.getByRole('button', {name: 'Start case tracking', exact: true}).click();
    await expect(form(page, 'review')).toBeVisible();
    expect((await calls(page, 'start')).map(call => call.args)).toEqual([[source, ids.source]]);
    await expect(page.getByRole('button', {name: 'Start case tracking', exact: true})).toHaveCount(0);
  });
}

test('Salesman records missing documents, checks completeness, and explicitly hands over to a coordinator', async ({page}) => {
  await install(page, {role: 'sales', handed: false});
  let review = form(page, 'review');
  await review.getByRole('textbox', {name: 'Missing items, one per line', exact: true}).fill('Latest statement month\nClear back of identity document');
  await review.getByRole('textbox', {name: 'Review / customer follow-up note', exact: true}).fill('Synthetic review: ask customer through approved channel.');
  await review.getByRole('button', {name: 'Save completeness review', exact: true}).click();
  await expect(page.getByRole('heading', {name: 'Items to follow up.', exact: true})).toBeVisible();
  await expect(form(page, 'handoff')).toHaveCount(0);
  expect((await state(page)).financeCase.review_state).toBe('needs_information');
  expect((await calls(page, 'review'))[0].args[1].missing_items).toEqual(['Latest statement month', 'Clear back of identity document']);
  await expect(page.getByText(/no message has been sent automatically/)).toBeVisible();

  review = form(page, 'review');
  await review.getByRole('textbox', {name: 'Missing items, one per line', exact: true}).fill('');
  await review.getByRole('textbox', {name: 'Review / customer follow-up note', exact: true}).fill('All required synthetic documents checked.');
  await review.locator('[name="details"]').check();
  await review.locator('[name="documents"]').check();
  await review.getByRole('button', {name: 'Save completeness review', exact: true}).click();
  const handoff = form(page, 'handoff');
  await expect(handoff).toBeVisible();
  await handoff.getByRole('combobox', {name: 'Receiving coordinator', exact: true}).selectOption(ids.coordinator);
  await handoff.getByRole('textbox', {name: 'Handover note', exact: true}).fill('Synthetic complete package ready for independent lender applications.');
  await handoff.getByRole('button', {name: 'Hand over complete case →', exact: true}).click();
  expect(await calls(page, 'handoff')).toEqual([]);
  await handoff.locator('[name="access"]').check();
  await handoff.getByRole('button', {name: 'Hand over complete case →', exact: true}).click();
  await expect(handoff).toHaveCount(0);
  expect((await calls(page, 'handoff'))[0].args.slice(1)).toEqual([ids.coordinator, 'Synthetic complete package ready for independent lender applications.']);
  await expect(page.locator('summary').filter({hasText: 'Add an institution application'})).toHaveCount(0);
});

test('Admin creates independent portal/email drafts and email remains a manual attachment checklist', async ({page}, testInfo) => {
  await install(page);
  await expect(form(page, 'review')).toHaveCount(0);
  await expect(form(page, 'institution')).toHaveCount(0);
  const portalDraft = await fillDraft(page, 'portal');
  await portalDraft.getByRole('button', {name: 'Create application draft', exact: true}).click();
  await expect(page.locator('.financeApplication')).toHaveCount(1);
  const emailDraft = await fillDraft(page, 'email');
  await emailDraft.getByRole('textbox', {name: 'Institution-specific missing documents, one per line', exact: true}).fill('Synthetic additional employment letter');
  await emailDraft.getByRole('button', {name: 'Create application draft', exact: true}).click();
  await expect(page.locator('.financeApplication')).toHaveCount(2);
  const applications = (await state(page)).applications;
  expect(applications.map(a => [a.channel, a.status, a.submitted_at])).toEqual([['portal', 'draft', null], ['email', 'draft', null]]);
  expect(applications[0].missing_documents).toEqual([]);
  expect(applications[1].missing_documents).toEqual(['Synthetic additional employment letter']);
  expect(applications[0].id).not.toBe(applications[1].id);
  expect(await calls(page, 'recordSubmission')).toEqual([]);
  const portal = card(page, applications[0].id), email = card(page, applications[1].id);
  await expect(portal.getByRole('button', {name: /Open configured lender portal/})).toHaveCount(0);
  await summary(portal, 'Review before submission').click();
  const review = form(portal, 'review-application');
  await review.locator('[name="note"]').fill('Synthetic destination and portal package checked.');
  await review.locator('[name="review"]').check();
  await review.getByRole('button', {name: 'Mark reviewed, not submitted', exact: true}).click();
  await expect(portal.getByRole('button', {name: /Open configured lender portal/})).toHaveAttribute('data-portal', applications[0].id);
  await summary(email, 'Review prepared email & attachment checklist').click();
  const text = email.getByRole('textbox', {name: 'Prepared email review', exact: true});
  await expect(text).toBeVisible();
  await expect(text).toHaveValue(/To: financing@example.test\nSubject: Synthetic email subject/);
  await expect(text).toHaveValue(/Attachment checklist \(attach these files manually\):\n- synthetic-identity.pdf/);
  await expect(text).not.toHaveValue(/- synthetic-statement.pdf/);
  await expect(text).toHaveValue(/Prepared only\. This does not send email or attach files\./);
  await expect(text).toHaveAttribute('readonly', '');
  await expect(page.locator('a[href^="mailto:"], button[data-send], form[action^="http"]')).toHaveCount(0);
  await expect(page.getByRole('button', {name: /^(send email|submit to lender|send now)$/i})).toHaveCount(0);
  await expectNoOverflow(page);
  await page.screenshot({path: testInfo.outputPath(`synthetic-admin-multi-application-${testInfo.project.name}.png`), fullPage: true});
});

test('review is explicitly confirmed and never marks a draft as submitted', async ({page}) => {
  const a = application();
  await install(page, {applications: [a]});
  const view = card(page, a.id);
  await expect(form(view, 'submission')).toHaveCount(0);
  await summary(view, 'Review before submission').click();
  const review = form(view, 'review-application');
  await review.getByRole('textbox', {name: 'Document and destination review note', exact: true}).fill('Synthetic destination and file checklist checked.');
  await review.getByRole('button', {name: 'Mark reviewed, not submitted', exact: true}).click();
  expect(await calls(page, 'reviewApplication')).toEqual([]);
  await review.locator('[name="review"]').check();
  await review.getByRole('button', {name: 'Mark reviewed, not submitted', exact: true}).click();
  await expect(view.locator('.financeDraftBadge')).toHaveText('Reviewed, not submitted');
  expect((await state(page)).applications[0].submitted_at).toBeNull();
  expect(await calls(page, 'recordSubmission')).toEqual([]);
  await expect(view.locator('dd').filter({hasText: 'Not recorded'})).toHaveCount(2);
});

for (const channel of ['portal', 'email']) {
  test(`${channel}: actual submission requires time, reference, evidence, and personal confirmation`, async ({page}) => {
    const a = application(channel, 'ready');
    await install(page, {applications: [a]});
    const view = card(page, a.id);
    await summary(view, `Record an actual ${channel === 'email' ? 'email sent' : 'portal submission'}`).click();
    const submission = form(view, 'submission'), submit = submission.getByRole('button', {name: 'Record completed submission', exact: true});
    await submission.locator('[name="time"]').fill('');
    await submit.click();
    expect(await calls(page, 'recordSubmission')).toEqual([]);
    await submission.locator('[name="time"]').fill('2026-01-03T10:25');
    await submit.click();
    expect(await calls(page, 'recordSubmission')).toEqual([]);
    await submission.locator('[name="reference"]').fill(`SYNTHETIC-${channel}-ref`);
    await submit.click();
    expect(await calls(page, 'recordSubmission')).toEqual([]);
    await submission.locator('[name="evidence"]').fill(channel === 'email' ? 'Synthetic sent-message ID verified with recipient and attachment list.' : 'Synthetic portal completed result and reference verified.');
    await submit.click();
    expect(await calls(page, 'recordSubmission')).toEqual([]);
    await submission.locator('[name="confirmed"]').check();
    await submission.locator('[name="time"]').fill('2099-01-01T10:25');
    await submit.click();
    await expect(page.getByRole('alert')).toContainText('not a future date');
    expect(await calls(page, 'recordSubmission')).toEqual([]);
    await expect(submission.locator('[name="reference"]')).toHaveValue(`SYNTHETIC-${channel}-ref`);
    await submission.locator('[name="time"]').fill('2026-01-03T10:25');
    await expectNoOverflow(page);
    await submit.click();
    await expect(view.locator('.financeDraftBadge')).toHaveText('Submitted');
    const recorded = await calls(page, 'recordSubmission');
    expect(recorded).toHaveLength(1);
    expect(recorded[0].args[1]).toEqual({submitted_at: '2026-01-03T10:25:00.000Z', external_reference: `SYNTHETIC-${channel}-ref`, evidence: channel === 'email' ? 'Synthetic sent-message ID verified with recipient and attachment list.' : 'Synthetic portal completed result and reference verified.'});
    await expect(form(view, 'submission')).toHaveCount(0);
    await expect(view).toContainText(`SYNTHETIC-${channel}-ref`);
  });
}

test('only an approved offer can be recorded as the customer choice with explicit instructions', async ({page}) => {
  const portal = application('portal', 'submitted'), email = application('email', 'under_review');
  await install(page, {applications: [portal, email]});
  await expect(form(page, 'select')).toHaveCount(0);
  const view = card(page, portal.id);
  await summary(view, 'Record lender follow-up / offer').click();
  const outcome = form(view, 'outcome');
  await outcome.getByRole('combobox', {name: 'Lender-reported status', exact: true}).selectOption('approved');
  await outcome.locator('[name="amount"]').fill('55000');
  await outcome.locator('[name="rate"]').fill('3.25');
  await outcome.locator('[name="tenure"]').fill('60');
  await outcome.locator('[name="note"]').fill('Synthetic lender response: approved, flat annual rate; conditions verified externally.');
  await outcome.getByRole('button', {name: 'Record follow-up', exact: true}).click();
  await expect(view.locator('.financeDraftBadge')).toHaveText('Approved');
  await expect(card(page, email.id).locator('.financeDraftBadge')).toHaveText('Under review');
  await expect(form(card(page, email.id), 'select')).toHaveCount(0);
  await summary(view, 'Record this as the customer’s selected offer').click();
  const select = form(view, 'select'), submit = select.getByRole('button', {name: 'Record customer-selected offer', exact: true});
  await submit.click();
  expect(await calls(page, 'selectOffer')).toEqual([]);
  await select.locator('[name="instruction"]').fill('Synthetic customer explicitly selected this approved offer during a verified call.');
  await submit.click();
  expect(await calls(page, 'selectOffer')).toEqual([]);
  await select.locator('[name="choice"]').check();
  await submit.click();
  await expect(view.getByText('Customer-selected offer', {exact: true})).toBeVisible();
  await expect(page.locator('.financeNotice').filter({hasText: 'Customer-selected offer:'})).toContainText('RM55,000 · 3.25% · 60 months');
  expect((await state(page)).financeCase.selected_application_id).toBe(portal.id);
  expect((await calls(page, 'selectOffer'))[0].args[1]).toMatchObject({id: portal.id, revision: 2, status: 'approved'});
  expect((await state(page)).applications[1].status).toBe('under_review');
  await expect(form(view, 'select')).toHaveCount(0);
});

for (const role of ['sales', 'office_admin', 'admin']) {
  test(`unrelated ${role} has no review, handover, application, outcome, choice, or configuration controls`, async ({page}) => {
    await install(page, {role, userId: ids.other, applications: [application('portal', 'ready'), application('email', 'approved')]});
    await expect(page.locator('#financeMain form')).toHaveCount(0);
    await expect(page.locator('summary').filter({hasText: 'Add an institution application'})).toHaveCount(0);
    await expect(page.locator('summary').filter({hasText: 'Institution settings'})).toHaveCount(0);
    expect((await calls(page, 'load')).length).toBe(1);
  });
}

test('only Super Admin sees institution configuration controls', async ({page}) => {
  await install(page, {role: 'super_admin'});
  await summary(page, 'Institution settings · Super Admin').click();
  await expect(form(page, 'institution')).toHaveCount(3);
  await summary(page, 'Add a verified institution').click();
  await expect(page.getByRole('textbox', {name: 'Verified HTTPS portal URL', exact: true}).last()).toBeVisible();
});

test('all 13 pending institutions are visible without creating or enabling configuration', async ({page}, testInfo) => {
  await install(page);
  const checklist = page.locator('#institutionChecklist');
  await expect(checklist.locator('li')).toHaveCount(13);
  await expect(checklist.locator('li strong')).toHaveText(['AEON Credit','Chailease','GFS','X Star','Carsome','FS','Elk','Maybank','Public Bank','AmBank','CIMB','HLB','Bank Muamalat']);
  await expect(checklist.getByText('Pending verification',{exact:true})).toHaveCount(13);
  await expect(form(page,'institution')).toHaveCount(0);
  expect(await calls(page,'saveInstitution')).toEqual([]);
  await summary(page,'Add an institution application').click();
  await expect(form(page,'save-application').locator('[name="institution"] option')).toHaveCount(3);
  await checklist.screenshot({path:testInfo.outputPath('pending-institutions.png')});
  await testInfo.attach('Pending institution checklist',{path:testInfo.outputPath('pending-institutions.png'),contentType:'image/png'});
});

test('selecting an owner-listed name prefills an inactive form with no guessed type or destination', async ({page}) => {
  await install(page,{role:'super_admin'});
  await summary(page,'Institution settings · Super Admin').click();
  await summary(page,'Add a verified institution').click();
  const draft=page.locator('form[data-action="institution"][data-id=""]');
  await draft.getByRole('combobox',{name:'Pending institution',exact:true}).selectOption('AEON Credit');
  await expect(draft.getByRole('textbox',{name:'Institution display name',exact:true})).toHaveValue('AEON Credit');
  await expect(draft.getByRole('combobox',{name:'Institution type',exact:true})).toHaveValue('');
  await expect(draft.locator('[name="portal"]')).toHaveValue('');
  await expect(draft.locator('[name="email"]')).toHaveValue('');
  await expect(draft.locator('[name="required"]')).toHaveValue('');
  await expect(draft.getByRole('checkbox',{name:'Available for new applications',exact:true})).not.toBeChecked();
  await draft.getByRole('button',{name:'Save institution configuration',exact:true}).click();
  expect(await calls(page,'saveInstitution')).toEqual([]);
  await draft.getByRole('combobox',{name:'Institution type',exact:true}).selectOption('credit_company');
  await draft.getByRole('button',{name:'Save institution configuration',exact:true}).click();
  expect((await calls(page,'saveInstitution'))[0].args[1]).toEqual({name:'AEON Credit',kind:'credit_company',portal_url:null,email_to:null,required_documents:[],active:false});
  await expect(page.getByRole('alert')).toContainText('Institution mutation not part of this browser fixture.');
});

test('unavailable public institution checklist does not hide saved lender applications', async ({page}) => {
  await page.route('**/config/finance-institutions.draft.json',route=>route.fulfill({status:503,body:'Unavailable'}));
  await install(page,{applications:[application('portal','ready')]});
  await expect(page.locator('#institutionChecklist')).toContainText('Institution checklist unavailable.');
  await expect(page.locator('.financeApplication')).toHaveCount(1);
  expect(await calls(page,'saveInstitution')).toEqual([]);
  await page.unroute('**/config/finance-institutions.draft.json');
  await page.getByRole('button',{name:'Refresh case',exact:true}).click();
  await expect(page.locator('#institutionChecklist li')).toHaveCount(13);
});

test('same-assignee UI guard preserves reviews and does not submit an assignment request', async ({page}) => {
  await install(page,{role:'office_admin',userId:ids.coordinator,applications:[application('portal','ready')]});
  const assign=form(page,'assign-admin'), button=assign.getByRole('button',{name:'Save Admin assignment',exact:true});
  const before=await state(page);
  await expect(button).toBeDisabled();
  await assign.getByRole('combobox',{name:'Responsible Submission Admin',exact:true}).selectOption(ids.other);
  await expect(button).toBeEnabled();
  await assign.getByRole('combobox',{name:'Responsible Submission Admin',exact:true}).selectOption(ids.office);
  await expect(button).toBeDisabled();
  await assign.evaluate(node=>node.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  expect(await calls(page,'assignAdmin')).toEqual([]);
  expect(await state(page)).toEqual(before);
});

test('profile-less Admin labels stay distinguishable and assignment values remain UUIDs', async ({page}) => {
  await install(page,{role:'super_admin'});
  await page.evaluate(({office,other})=>{
    const staff=window.__financeFixture.staff;
    Object.assign(staff.find(member=>member.user_id===office),{display_name:'E2 staff',email:'synthetic-office-one@example.test'});
    Object.assign(staff.find(member=>member.user_id===other),{display_name:'E2 staff',email:'synthetic-office-two@example.test'});
  },{office:ids.office,other:ids.other});
  await page.getByRole('button',{name:'Refresh case',exact:true}).click();
  const choices=form(page,'assign-admin').getByRole('combobox',{name:'Responsible Submission Admin',exact:true});
  await expect(choices.locator(`option[value="${ids.office}"]`)).toHaveText('synthetic-office-one@example.test · Submission Admin');
  await expect(choices.locator(`option[value="${ids.other}"]`)).toHaveText('synthetic-office-two@example.test · Inventory Admin');
  await expect(page.locator('.financeOwners')).toContainText('synthetic-office-one@example.test');
});

test('repeated draft submission is locked until completion and creates only one application', async ({page}) => {
  await install(page, {defer: ['saveApplication']});
  const draft = await fillDraft(page, 'portal');
  await draft.getByRole('button', {name: 'Create application draft', exact: true}).click();
  await expect(page.locator('#financeMain')).toHaveAttribute('aria-busy', 'true');
  await expect(draft.getByRole('button', {name: 'Create application draft', exact: true})).toBeDisabled();
  await draft.evaluate(node => {node.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true})); node.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}));});
  expect(await calls(page, 'saveApplication')).toHaveLength(1);
  await release(page, 'saveApplication');
  await expect(page.locator('.financeApplication')).toHaveCount(1);
  expect((await state(page)).applications).toHaveLength(1);
});

test('save failure preserves every entered field and allows a deliberate retry', async ({page}) => {
  await install(page);
  await page.evaluate(() => {window.__financeFixture.failures.saveApplication = 'Synthetic revision conflict. Review and retry.';});
  const draft = await fillDraft(page, 'email');
  await draft.getByRole('textbox', {name: 'Internal application note', exact: true}).fill('Keep this synthetic draft note.');
  await draft.getByRole('button', {name: 'Create application draft', exact: true}).click();
  await expect(page.getByRole('alert')).toHaveText('Synthetic revision conflict. Review and retry.');
  await expect(draft.getByRole('combobox', {name: 'Bank / credit company', exact: true})).toHaveValue(ids.email);
  await expect(draft.getByRole('combobox', {name: 'Submission channel', exact: true})).toHaveValue('email');
  await expect(draft.getByRole('textbox', {name: 'Email subject (email only)', exact: true})).toHaveValue('Synthetic email subject');
  await expect(draft.getByRole('textbox', {name: 'Email message (email only)', exact: true})).toHaveValue('Synthetic prepared email. Attach documents manually.');
  await expect(draft.getByRole('textbox', {name: 'Internal application note', exact: true})).toHaveValue('Keep this synthetic draft note.');
  await expect(draft.getByRole('checkbox', {name: 'synthetic-identity.pdf', exact: true})).toBeChecked();
  await expect(draft.getByRole('button', {name: 'Create application draft', exact: true})).toBeEnabled();
  await expectNoOverflow(page);
  await page.evaluate(() => {delete window.__financeFixture.failures.saveApplication;});
  await draft.getByRole('button', {name: 'Create application draft', exact: true}).click();
  await expect(page.locator('.financeApplication')).toHaveCount(1);
  expect(await calls(page, 'saveApplication')).toHaveLength(2);
});

for (const event of ['SIGNED_OUT', 'USER_UPDATED']) {
  for (const pending of ['who', 'load', 'download']) {
    test(`${event}: a pending ${pending} cannot restore sensitive case data`, async ({page}) => {
      await install(page, {applications: [application('email', 'ready')], defer: [pending]}, 'intake', pending === 'download');
      if (pending === 'download') {
        await summary(card(page, application('email').id), 'Review prepared email & attachment checklist').click();
        await page.locator(`[data-file="${ids.file}"]`).click();
        await expect(page.locator('#financeFilePreview')).toBeVisible();
      }
      await expect.poll(() => page.evaluate(method => window.__financeFixture.pending.filter(item => item.method === method).length, pending)).toBe(1);
      await page.evaluate(event => window.__financeFixture.auth(event, event === 'SIGNED_OUT' ? null : {user: {id: 'different-authenticated-user'}}), event);
      if (pending === 'who' && event === 'USER_UPDATED') {
        await expect(page.locator('#financeMain')).not.toContainText('Synthetic');
        expect(await calls(page, 'load')).toEqual([]);
      } else await expectPrivateUICleared(page);
      await release(page, pending);
      await expectPrivateUICleared(page);
      if (pending === 'who') expect(await calls(page, 'load')).toEqual([]);
    });
  }
}

test('Sign out clears a rendered PDF, prepared email, and private object URLs', async ({page}) => {
  const a = application('email', 'ready');
  await install(page, {applications: [a]});
  await summary(card(page, a.id), 'Review prepared email & attachment checklist').click();
  await page.locator(`[data-file="${ids.file}"]`).click();
  await expect(page.locator('#financeFilePreview canvas')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__financeFixture.liveURLs.size)).toBe(1);
  // A modal blocks the header button, so use the actual auth callback as the
  // backend would on expiration; the ordinary header button has its own test.
  await page.evaluate(() => window.__financeFixture.auth('SIGNED_OUT', null));
  await expectPrivateUICleared(page);
});

test('Sign out button clears the case while a save is pending', async ({page}) => {
  await install(page, {defer: ['saveApplication']});
  const draft = await fillDraft(page, 'email');
  await draft.getByRole('button', {name: 'Create application draft', exact: true}).click();
  await page.getByRole('button', {name: 'Sign out', exact: true}).click();
  await expectPrivateUICleared(page);
  await release(page, 'saveApplication');
  await expectPrivateUICleared(page);
  expect(await calls(page, 'signOut')).toHaveLength(1);
});


test('coordinator assigns and reassigns the Admin but cannot process lender applications', async ({page}) => {
  await install(page, {role: 'office_admin', userId: ids.coordinator, assigned: false, applications: [application('portal', 'ready'), application('email', 'approved')]});
  await expect(page.locator('#financeMain form')).toHaveCount(1);
  await expect(form(page, 'assign-admin')).toBeVisible();
  await expect(page.locator('summary').filter({hasText: 'Add an institution application'})).toHaveCount(0);
  await expect(form(page, 'submission')).toHaveCount(0);
  await expect(form(page, 'outcome')).toHaveCount(0);
  await expect(form(page, 'select')).toHaveCount(0);
  await expect(page.getByRole('button', {name: /Open configured lender portal/})).toHaveCount(0);
  let assign = form(page, 'assign-admin');
  await assign.getByRole('combobox', {name: 'Responsible Submission Admin', exact: true}).selectOption(ids.office);
  await assign.getByRole('textbox', {name: 'Assignment / reassignment reason', exact: true}).fill('Synthetic initial assignment to available submission staff.');
  await assign.getByRole('button', {name: 'Save Admin assignment', exact: true}).click();
  expect(await calls(page, 'assignAdmin')).toEqual([]);
  await assign.locator('[name="access"]').check();
  await assign.getByRole('button', {name: 'Save Admin assignment', exact: true}).click();
  await expect.poll(async () => (await state(page)).financeCase.office_admin).toBe(ids.office);
  await expect(page.locator('#financeMain form')).toHaveCount(1);
  assign = form(page, 'assign-admin');
  await assign.getByRole('combobox', {name: 'Responsible Submission Admin', exact: true}).selectOption(ids.other);
  await assign.getByRole('textbox', {name: 'Assignment / reassignment reason', exact: true}).fill('Synthetic reassignment for workload coverage.');
  await assign.locator('[name="access"]').check();
  await assign.getByRole('button', {name: 'Save Admin assignment', exact: true}).click();
  await expect.poll(async () => (await state(page)).financeCase.office_admin).toBe(ids.other);
  expect((await state(page)).financeCase.coordinator).toBe(ids.coordinator);
  expect((await calls(page, 'assignAdmin')).map(call => call.args[1])).toEqual([ids.office, ids.other]);
  await expect(page.locator('#financeMain form')).toHaveCount(1);
});

test('global coordinator can route another receiving coordinator’s handed-over case without submission powers', async ({page}) => {
  await install(page, {role: 'office_admin', userId: ids.coordinator, caseOverrides: {coordinator: ids.other}, applications: [application('portal', 'ready')]});
  const assign = form(page, 'assign-admin');
  await expect(assign).toBeVisible();
  await expect(page.getByText('Your coordinator capability covers all submitted loan cases.', {exact: false})).toBeVisible();
  await expect(form(page, 'submission')).toHaveCount(0);
  await expect(form(page, 'outcome')).toHaveCount(0);
  await expect(page.getByRole('button', {name: /Open configured lender portal/})).toHaveCount(0);
  await assign.getByRole('combobox', {name: 'Responsible Submission Admin', exact: true}).selectOption(ids.other);
  await assign.getByRole('textbox', {name: 'Assignment / reassignment reason', exact: true}).fill('Synthetic global coordinator workload reassignment.');
  await assign.locator('[name="access"]').check();
  await assign.getByRole('button', {name: 'Save Admin assignment', exact: true}).click();
  await expect.poll(async () => (await state(page)).financeCase.office_admin).toBe(ids.other);
  expect((await state(page)).financeCase.coordinator).toBe(ids.other);
  expect(await calls(page, 'assignAdmin')).toHaveLength(1);
  await expect(form(page, 'assign-admin')).toBeVisible();
});

for (const source of ['intake', 'loan']) {
  test(`${source}: global coordinator can review a submitted case before handover but cannot bypass the Salesman check`, async ({page}) => {
    await install(page, {role: 'office_admin', userId: ids.coordinator, handed: false}, source);
    await expect(page.getByRole('heading', {name: 'Synthetic test applicant', exact: true})).toBeVisible();
    await expect(page.locator('[data-file]')).toHaveCount(2);
    await expect(form(page, 'assign-admin')).toHaveCount(0);
    await expect(form(page, 'review')).toHaveCount(0);
    await expect(form(page, 'handoff')).toHaveCount(0);
    await expect(form(page, 'submission')).toHaveCount(0);
    expect(await calls(page, 'assignAdmin')).toHaveLength(0);
  });
}

test('global coordinator explicitly adopts a legacy handover without changing source or bypassing review', async ({page}) => {
  const legacy = {office_admin: ids.office, handed_at: '2026-01-02T00:00:00.000Z', status: 'Sent to Office', revision: 7};
  await install(page, {role: 'office_admin', userId: ids.coordinator, tracking: false, sourceOverrides: legacy});
  expect(await calls(page, 'adoptLegacy')).toHaveLength(0);
  expect(await calls(page, 'start')).toHaveLength(0);
  await expect(page.getByRole('button', {name: 'Start case tracking', exact: true})).toHaveCount(0);
  await expect(page.getByText('Existing Salesman account', {exact:true})).toBeVisible();
  await expect(page.getByText(ids.sales, {exact:true})).toBeVisible();
  await expect(page.getByText('Current Submission Admin account', {exact:true})).toBeVisible();
  await expect(page.getByText(ids.office, {exact:true})).toBeVisible();
  const original = await page.evaluate(() => structuredClone(window.__financeFixture.source));
  const adopt = form(page, 'adopt-legacy');
  await adopt.getByRole('textbox', {name: 'Reason for adopting this existing handover', exact: true}).fill('Synthetic coordinator reviewed the existing Salesman and Admin mapping.');
  await adopt.getByRole('button', {name: 'Adopt legacy handover into case tracking', exact: true}).click();
  expect(await calls(page, 'adoptLegacy')).toHaveLength(0);
  await adopt.locator('[name="adopt"]').check();
  await adopt.getByRole('button', {name: 'Adopt legacy handover into case tracking', exact: true}).click();
  await expect(form(page, 'assign-admin')).toBeVisible();
  expect((await state(page)).financeCase.office_admin).toBe(ids.office);
  expect((await state(page)).financeCase.review_state).toBe('pending');
  expect((await state(page)).financeCase.coordinator).toBe(ids.coordinator);
  expect(await page.evaluate(() => window.__financeFixture.source)).toEqual(original);
  expect((await calls(page, 'adoptLegacy'))[0].args[1].revision).toBe(7);
  await expect(page.locator('summary').filter({hasText: 'Add an institution application'})).toHaveCount(0);
  await expect(form(page, 'submission')).toHaveCount(0);
});

for (const role of ['sales','office_admin']) {
  test(`${role}: legacy adoption is unavailable without global coordinator capability`, async ({page}) => {
    await install(page, {role, tracking: false, sourceOverrides: {office_admin: ids.office, handed_at: '2026-01-02T00:00:00.000Z', revision: 7}});
    await expect(form(page, 'adopt-legacy')).toHaveCount(0);
    await expect(page.getByRole('button', {name: 'Start case tracking', exact: true})).toHaveCount(0);
    await expect(page.getByText('A configured global loan coordinator or Super Admin must review and explicitly adopt this existing handover.', {exact: true})).toBeVisible();
    expect(await calls(page, 'adoptLegacy')).toHaveLength(0);
    expect(await calls(page, 'start')).toHaveLength(0);
  });
}

test('coordinator id without active dispatcher capability grants no assignment controls', async ({page}) => {
  await install(page, {role: 'office_admin', userId: ids.coordinator, dispatcher: false, assigned: false});
  await expect(page.locator('#financeMain form')).toHaveCount(0);
});

test('previously assigned Admin has no processing controls after case reassignment', async ({page}) => {
  await install(page, {caseOverrides: {office_admin: ids.other}, applications: [application('portal', 'ready'), application('email', 'approved')]});
  await expect(page.locator('#financeMain form')).toHaveCount(0);
  await expect(page.getByRole('button', {name: /Open configured lender portal/})).toHaveCount(0);
});

test('stale institution configuration disables destinations and submission until fresh draft review', async ({page}) => {
  const portal = application('portal', 'ready', {institution_revision: 0});
  const email = application('email', 'ready', {institution_revision: 0});
  await install(page, {applications: [portal, email]});
  await expect(page.locator('.financeNotice').filter({hasText: 'Institution configuration changed or is inactive.'})).toHaveCount(2);
  await expect(page.getByRole('button', {name: /Open configured lender portal/})).toHaveCount(0);
  await expect(page.getByRole('textbox', {name: 'Prepared email review', exact: true})).toHaveCount(0);
  await expect(form(page, 'submission')).toHaveCount(0);
  await expect(form(page, 'review-application')).toHaveCount(0);
  const portalView = card(page, portal.id);
  await summary(portalView, 'Edit prepared application').click();
  await form(portalView, 'save-application').getByRole('button', {name: 'Save draft changes', exact: true}).click();
  await expect(portalView.locator('.financeDraftBadge')).toHaveText('Draft');
  await expect(form(portalView, 'review-application')).toHaveCount(1);
  await expect(form(portalView, 'submission')).toHaveCount(0);
  expect((await state(page)).applications[0].institution_revision).toBe(1);
  expect((await state(page)).applications[1].institution_revision).toBe(0);
});

test('changing reviewed draft fields invalidates readiness without recording a submission', async ({page}) => {
  const a = application('email', 'ready');
  await install(page, {applications: [a]});
  const view = card(page, a.id);
  await summary(view, 'Edit prepared application').click();
  const edit = form(view, 'save-application');
  await edit.getByRole('textbox', {name: 'Email subject (email only)', exact: true}).fill('Changed synthetic subject requires a new review');
  await edit.getByRole('button', {name: 'Save draft changes', exact: true}).click();
  await expect(view.locator('.financeDraftBadge')).toHaveText('Draft');
  await expect(form(view, 'submission')).toHaveCount(0);
  expect((await state(page)).applications[0].submitted_at).toBeNull();
  expect(await calls(page, 'recordSubmission')).toEqual([]);
});


test('repeated completion confirmation records one actual submission while the request is pending', async ({page}) => {
  const a = application('email', 'ready');
  await install(page, {applications: [a], defer: ['recordSubmission']});
  const view = card(page, a.id);
  await summary(view, 'Record an actual email sent').click();
  const submission = form(view, 'submission');
  await submission.locator('[name="time"]').fill('2026-01-03T10:25');
  await submission.locator('[name="reference"]').fill('SYNTHETIC-ONE-SEND');
  await submission.locator('[name="evidence"]').fill('Synthetic sent-message receipt with correct recipient and attachment list.');
  await submission.locator('[name="confirmed"]').check();
  await submission.getByRole('button', {name: 'Record completed submission', exact: true}).click();
  await expect(submission.getByRole('button', {name: 'Record completed submission', exact: true})).toBeDisabled();
  await submission.evaluate(node => {node.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true})); node.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}));});
  expect(await calls(page, 'recordSubmission')).toHaveLength(1);
  await release(page, 'recordSubmission');
  await expect(view.locator('.financeDraftBadge')).toHaveText('Submitted');
  await expect(form(view, 'submission')).toHaveCount(0);
  expect(await calls(page, 'recordSubmission')).toHaveLength(1);
});


for (const channel of ['portal', 'email']) {
  test(`${channel}: revalidates prepared destination before opening or revealing it`, async ({page}) => {
    const a = application(channel, 'ready');
    await install(page, {applications: [a]});
    await page.evaluate(() => {window.__financeFixture.defer.push('load');});
    const view = card(page, a.id);
    if (channel === 'portal') await view.getByRole('button', {name: /Open configured lender portal/}).click();
    else await summary(view, 'Review prepared email & attachment checklist').click();
    await expect.poll(async () => (await calls(page, 'load')).length).toBe(2);
    expect(await page.evaluate(() => window.__financeFixture.openedWindows)).toEqual(channel === 'portal' ? [['about:blank', '_blank']] : []);
    expect(await page.evaluate(() => window.__financeFixture.lenderNavigations)).toEqual([]);
    if (channel === 'portal') expect(await page.evaluate(() => window.__financeFixture.popups[0])).toMatchObject({opener: null, closed: false, navigations: []});
    if (channel === 'email') await expect(view.getByRole('textbox', {name: 'Prepared email review', exact: true})).not.toBeVisible();
    await release(page, 'load', 2);
    if (channel === 'portal') {
      await expect.poll(() => page.evaluate(() => window.__financeFixture.lenderNavigations)).toEqual(['https://portal.example.test/financing']);
      expect(await page.evaluate(() => window.__financeFixture.popups[0])).toMatchObject({opener: null, closed: false, navigations: ['https://portal.example.test/financing']});
    } else await expect(view.getByRole('textbox', {name: 'Prepared email review', exact: true})).toBeVisible();
    expect(await calls(page, 'recordSubmission')).toEqual([]);
  });

  for (const changed of ['institution', 'application', 'case']) {
    test(`${channel}: a live ${changed} revision change blocks the stale prepared destination`, async ({page}) => {
      const a = application(channel, 'ready');
      await install(page, {applications: [a]});
      await page.evaluate(({changed, institutionId}) => {
        const s = window.__financeFixture;
        if (changed === 'institution') s.institutions.find(i => i.id === institutionId).revision++;
        else if (changed === 'application') s.applications[0].revision++;
        else s.financeCase.revision++;
      }, {changed, institutionId: ids[channel]});
      const view = card(page, a.id);
      if (channel === 'portal') await view.getByRole('button', {name: /Open configured lender portal/}).click();
      else await summary(view, 'Review prepared email & attachment checklist').click();
      await expect(page.getByRole('alert')).toContainText('Case or institution configuration changed.');
      expect(await calls(page, 'load')).toHaveLength(2);
      expect(await page.evaluate(() => window.__financeFixture.openedWindows)).toEqual(channel === 'portal' ? [['about:blank', '_blank']] : []);
      expect(await page.evaluate(() => window.__financeFixture.lenderNavigations)).toEqual([]);
      if (channel === 'portal') expect(await page.evaluate(() => window.__financeFixture.popups[0])).toMatchObject({opener: null, closed: true, navigations: []});
      if (channel === 'email') {
        await expect(view.locator('details[data-email]')).not.toHaveAttribute('open', '');
        await expect(view.getByRole('textbox', {name: 'Prepared email review', exact: true})).not.toBeVisible();
      }
      expect(await calls(page, 'recordSubmission')).toEqual([]);
      if (changed === 'institution') {
        await page.getByRole('button', {name: 'Refresh case', exact: true}).click();
        await expect(view).toContainText('Institution configuration changed or is inactive.');
        await expect(view.getByRole('button', {name: /Open configured lender portal/})).toHaveCount(0);
        await expect(view.locator('details[data-email]')).toHaveCount(0);
      }
    });
  }

  test(`${channel}: sign out during destination revalidation prevents late opening or email reveal`, async ({page}) => {
    const a = application(channel, 'ready');
    await install(page, {applications: [a]});
    await page.evaluate(() => {window.__financeFixture.defer.push('load');});
    const view = card(page, a.id);
    if (channel === 'portal') await view.getByRole('button', {name: /Open configured lender portal/}).click();
    else await summary(view, 'Review prepared email & attachment checklist').click();
    await expect.poll(async () => (await calls(page, 'load')).length).toBe(2);
    await page.getByRole('button', {name: 'Sign out', exact: true}).click();
    await expectPrivateUICleared(page);
    await release(page, 'load', 2);
    await expectPrivateUICleared(page);
    expect(await page.evaluate(() => window.__financeFixture.openedWindows)).toEqual(channel === 'portal' ? [['about:blank', '_blank']] : []);
    expect(await page.evaluate(() => window.__financeFixture.lenderNavigations)).toEqual([]);
    if (channel === 'portal') expect(await page.evaluate(() => window.__financeFixture.popups[0])).toMatchObject({opener: null, closed: true, navigations: []});
  });
}

test('leaving the page hides prepared email and returning requires a fresh destination check', async ({page}) => {
  const a = application('email', 'ready');
  await install(page, {applications: [a]});
  const view = card(page, a.id), email = view.getByRole('textbox', {name: 'Prepared email review', exact: true});
  await summary(view, 'Review prepared email & attachment checklist').click();
  await expect(email).toBeVisible();
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', {configurable: true, value: true});
    document.dispatchEvent(new Event('visibilitychange'));
    delete document.hidden;
    window.__financeFixture.institutions.find(i => i.kind === 'credit_company').revision++;
  });
  await expect(email).not.toBeVisible();
  await expect(view.locator('details[data-email]')).not.toHaveAttribute('open', '');
  await summary(view, 'Review prepared email & attachment checklist').click();
  await expect(page.getByRole('alert')).toContainText('Case or institution configuration changed.');
  await expect(email).not.toBeVisible();
  expect(await calls(page, 'load')).toHaveLength(3);
});


test('blocked portal popup shows a recoverable message without verifying or navigating a destination', async ({page}) => {
  const a = application('portal', 'ready');
  await install(page, {applications: [a]});
  await page.evaluate(() => {window.__financeFixture.popupBlocked = true;});
  const open = card(page, a.id).getByRole('button', {name: /Open configured lender portal/});
  await open.click();
  await expect(page.getByRole('alert')).toHaveText('The browser blocked the portal tab. Allow popups for E2 and try again.');
  await expect(open).toBeEnabled();
  expect(await calls(page, 'load')).toHaveLength(1);
  expect(await page.evaluate(() => window.__financeFixture.openedWindows)).toEqual([['about:blank', '_blank']]);
  expect(await page.evaluate(() => window.__financeFixture.popups)).toEqual([]);
  expect(await page.evaluate(() => window.__financeFixture.lenderNavigations)).toEqual([]);
  expect(await calls(page, 'recordSubmission')).toEqual([]);
});

function registeredListMock(dispatcher = true) {
  const userId = dispatcher ? ids.coordinator : ids.office;
  const rows = [{id:ids.source,vehicle_summary:{name:'Synthetic registered vehicle',plate:'TEST ONLY',price:60000},details:{name:'Synthetic registered applicant'},status:'Submitted to E2',assigned_sales:dispatcher?ids.sales:ids.office,submitted_at:'2026-01-01T00:00:00Z',updated_at:'2026-01-01T00:00:00Z',revision:1}];
  return `
    export const check = r => { if(r.error) throw r.error; return r.data; };
    const rows = ${JSON.stringify(rows)};
    export const db = {
      auth: { getSession: async () => ({data:{session:{user:{id:${JSON.stringify(userId)}}}}}),
        onAuthStateChange(callback) {window.__registeredAuth=callback;},
        signOut: async () => {window.__registeredAuth('SIGNED_OUT',null);return {data:null};}},
      rpc: async name => {if(name==='e2_is_super_admin')return {data:false};if(name==='e2_finance_is_dispatcher')return {data:${dispatcher}};throw Error('Unexpected mutation in read-only registered-list fixture: '+name);},
      from(table) {const q={select(){return q},eq(){return q},not(){return q},order(){return q},range(){return q},
        single:async()=>({data:table==='staff_memberships'?{role:'office_admin',active:true}:rows[0]}),
        then(resolve,reject){return Promise.resolve({data:table==='loan_events'?[]:rows}).then(resolve,reject)}};return q;}
    };`;
}
for (const dispatcher of [true,false]) {
  // Parse the mock even if CI cannot launch its browser.
  await import(`data:text/javascript;charset=utf-8,${encodeURIComponent(registeredListMock(dispatcher))}`);
}

test('global coordinator registered-loan list exposes read access without unrelated legacy progress controls', async ({page}) => {
  await page.route('**/e2-data.js*', route=>route.fulfill({contentType:'text/javascript',body:registeredListMock(true)}));
  await page.goto('/loans.html');
  await expect(page.getByText('All submitted registered loan cases are visible to your coordinator capability.',{exact:false})).toBeVisible();
  await page.locator(`[data-loan="${ids.source}"]`).click();
  await expect(page.getByRole('heading',{name:'Synthetic registered applicant',exact:true})).toBeVisible();
  await expect(page.locator('#statusLoan,#assignLoan')).toHaveCount(0);
  await expect(page.getByRole('link',{name:'Review & submit financing case ↗',exact:true})).toHaveAttribute('href',`financing-case.html?source=loan&id=${ids.source}`);
  await page.evaluate(()=>window.__registeredAuth('USER_UPDATED',{user:{id:'different-synthetic-account'}}));
  await expect(page.getByRole('link',{name:'Staff sign in ↗',exact:true})).toBeVisible();
  await expect(page.locator('#staffLoans')).not.toContainText('Synthetic registered applicant');
});

test('assigned legacy registered-loan Admin keeps their own permitted follow-up controls', async ({page}) => {
  await page.route('**/e2-data.js*', route=>route.fulfill({contentType:'text/javascript',body:registeredListMock(false)}));
  await page.goto('/loans.html');
  await expect(page.getByText('Submitted applications within your assigned access.',{exact:false})).toBeVisible();
  await page.locator(`[data-loan="${ids.source}"]`).click();
  await expect(page.locator('#statusLoan')).toBeVisible();
  await expect(page.locator('#assignLoan')).toHaveCount(0);
});


for (const cancellation of ['close', 'leave page']) {
  test('email preview: '+cancellation+' invalidates the earlier pending validation', async ({page}) => {
    const a = application('email', 'ready');
    await install(page, {applications:[a]});
    await page.evaluate(() => window.__financeFixture.defer.push('load'));
    const view = card(page,a.id), toggle = summary(view,'Review prepared email & attachment checklist');
    const email = view.getByRole('textbox',{name:'Prepared email review',exact:true});
    await toggle.click();
    await expect.poll(async () => (await calls(page,'load')).length).toBe(2);
    if (cancellation === 'close') await toggle.click();
    else await page.evaluate(() => {
      Object.defineProperty(document,'hidden',{configurable:true,value:true});
      document.dispatchEvent(new Event('visibilitychange'));
      delete document.hidden;
    });
    await expect(view.locator('details[data-email]')).not.toHaveAttribute('open','');
    await page.evaluate(() => window.__financeFixture.financeCase.revision++);
    await toggle.click();
    await expect.poll(async () => (await calls(page,'load')).length).toBe(3);
    await release(page,'load',2);
    await expect(email).not.toBeVisible();
    await release(page,'load',3);
    await expect(page.getByRole('alert')).toContainText('Case or institution configuration changed.');
    await expect(email).not.toBeVisible();
    expect(await calls(page,'recordSubmission')).toEqual([]);
  });
}

test('email preview: a cancelled request failure cannot close a newer validated preview', async ({page}) => {
  const a = application('email','ready');
  await install(page,{applications:[a]});
  await page.evaluate(() => window.__financeFixture.defer.push('load'));
  const view=card(page,a.id), toggle=summary(view,'Review prepared email & attachment checklist');
  const email=view.getByRole('textbox',{name:'Prepared email review',exact:true});
  await toggle.click();
  await expect.poll(async () => (await calls(page,'load')).length).toBe(2);
  await toggle.click();
  await expect(view.locator('details[data-email]')).not.toHaveAttribute('open','');
  await toggle.click();
  await expect.poll(async () => (await calls(page,'load')).length).toBe(3);
  await page.evaluate(() => {
    const pending=window.__financeFixture.pending.filter(p=>p.method==='load'&&!p.released)[1];
    pending.released=true;pending.resolve();
  });
  await expect(email).toBeVisible();
  await page.evaluate(() => {window.__financeFixture.failures.load='Synthetic cancelled request failure.';});
  await release(page,'load',3);
  await expect(email).toBeVisible();
  await expect(page.getByRole('alert')).toBeEmpty();
});

test('repeated Admin assignment stays locked and refresh disables the new current Admin', async ({page}) => {
  await install(page,{role:'office_admin',userId:ids.coordinator,defer:['assignAdmin']});
  const assign=form(page,'assign-admin');
  await assign.locator('[name="office"]').selectOption(ids.other);
  await assign.locator('[name="note"]').fill('Synthetic workload reassignment.');
  await assign.locator('[name="access"]').check();
  await assign.getByRole('button',{name:'Save Admin assignment',exact:true}).click();
  await expect(assign.getByRole('button')).toBeDisabled();
  await assign.evaluate(node=>{
    node.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
    node.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
  });
  expect(await calls(page,'assignAdmin')).toHaveLength(1);
  await release(page,'assignAdmin');
  await expect(form(page,'assign-admin').locator('[name="office"]')).toHaveValue(ids.other);
  await expect(form(page,'assign-admin').getByRole('button')).toBeDisabled();
  expect(await calls(page,'assignAdmin')).toHaveLength(1);
});

test('stale Admin reassignment preserves the newer owner and recovers through explicit refresh', async ({page}) => {
  await install(page,{role:'office_admin',userId:ids.coordinator,applications:[application('portal','ready')]});
  const assign=form(page,'assign-admin');
  await assign.locator('[name="office"]').selectOption(ids.other);
  await assign.locator('[name="note"]').fill('Synthetic attempted reassignment from an old view.');
  await assign.locator('[name="access"]').check();
  await page.evaluate(other=>{
    const s=window.__financeFixture;
    s.financeCase.office_admin=other;s.financeCase.revision++;
    s.failures.assignAdmin='Case changed. Reload before saving.';
  },ids.other);
  const current=await state(page);
  await assign.getByRole('button').click();
  await expect(page.getByRole('alert')).toHaveText('Case changed. Reload before saving.');
  expect(await state(page)).toEqual(current);
  expect((await calls(page,'assignAdmin'))[0].args[0].revision).toBe(1);
  await expect(assign.locator('[name="note"]')).toHaveValue('Synthetic attempted reassignment from an old view.');
  await page.getByRole('button',{name:'Refresh case',exact:true}).click();
  await expect(form(page,'assign-admin').locator('[name="office"]')).toHaveValue(ids.other);
  await expect(form(page,'assign-admin').getByRole('button')).toBeDisabled();
  expect(await calls(page,'assignAdmin')).toHaveLength(1);
});

for (const source of ['intake','loan']) {
  test(source+': revoked access after closing a pending file clears the case and discards late bytes', async ({page}) => {
    await install(page,{defer:['download']},source);
    await page.locator('[data-file="'+ids.file+'"]').click();
    await expect(page.locator('#financeFilePreview')).toBeVisible();
    await page.locator('#financeFileClose').click();
    await page.evaluate(() => {window.__financeFixture.failures.load='Assigned case access required.';});
    await page.getByRole('button',{name:'Refresh case',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Case unavailable.',exact:true})).toBeVisible();
    await release(page,'download');
    await expect(page.locator('#financeMain')).not.toContainText('Synthetic');
    await expect(page.locator('#financeMain form, .financeApplication, [data-file]')).toHaveCount(0);
    await expect(page.locator('#financeFilePreview')).not.toBeVisible();
    await expect(page.locator('#financeFilePreview canvas, #financeFilePreview a[download]')).toHaveCount(0);
    expect(await page.evaluate(() => window.__financeFixture.createdURLs)).toEqual([]);
  });
}

test('page navigation during Admin reassignment cannot repopulate the departed workspace', async ({page}) => {
  await install(page,{role:'office_admin',userId:ids.coordinator,defer:['assignAdmin']});
  const assign=form(page,'assign-admin');
  await assign.locator('[name="office"]').selectOption(ids.other);
  await assign.locator('[name="note"]').fill('Synthetic assignment already in flight before navigation.');
  await assign.locator('[name="access"]').check();
  await assign.getByRole('button').click();
  await expect(page.locator('#financeMain')).toHaveAttribute('aria-busy','true');
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true})));
  await release(page,'assignAdmin');
  await expect(page.locator('#financeMain')).toBeEmpty();
  await expect(page.locator('#financeFilePreview')).not.toBeVisible();
  expect(await calls(page,'load')).toHaveLength(1);
  expect(await calls(page,'assignAdmin')).toHaveLength(1);
});
