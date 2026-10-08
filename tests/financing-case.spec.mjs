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
async function fillDraft(page, channel) {
  await summary(page, 'Add an institution application').click();
  const draft = page.locator('form[data-action="save-application"][data-id=""]');
  await draft.getByLabel('Bank / credit company', {exact: true}).selectOption(ids[channel]);
  await draft.getByLabel('Submission channel', {exact: true}).selectOption(channel);
  await draft.getByLabel('synthetic-identity.pdf', {exact: true}).check();
  if (channel === 'email') {
    await draft.getByLabel('Email subject (email only)', {exact: true}).fill('Synthetic email subject');
    await draft.getByLabel('Email message (email only)', {exact: true}).fill('Synthetic prepared email. Attach documents manually.');
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
  await review.getByLabel('Missing items, one per line', {exact: true}).fill('Latest statement month\nClear back of identity document');
  await review.getByLabel('Review / customer follow-up note', {exact: true}).fill('Synthetic review: ask customer through approved channel.');
  await review.getByRole('button', {name: 'Save completeness review', exact: true}).click();
  await expect(page.getByRole('heading', {name: 'Items to follow up.', exact: true})).toBeVisible();
  await expect(form(page, 'handoff')).toHaveCount(0);
  expect((await state(page)).financeCase.review_state).toBe('needs_information');
  expect((await calls(page, 'review'))[0].args[1].missing_items).toEqual(['Latest statement month', 'Clear back of identity document']);
  await expect(page.getByText(/no message has been sent automatically/)).toBeVisible();

  review = form(page, 'review');
  await review.getByLabel('Missing items, one per line', {exact: true}).fill('');
  await review.getByLabel('Review / customer follow-up note', {exact: true}).fill('All required synthetic documents checked.');
  await review.locator('[name="details"]').check();
  await review.locator('[name="documents"]').check();
  await review.getByRole('button', {name: 'Save completeness review', exact: true}).click();
  const handoff = form(page, 'handoff');
  await expect(handoff).toBeVisible();
  await handoff.getByLabel('Receiving coordinator', {exact: true}).selectOption(ids.coordinator);
  await handoff.getByLabel('Handover note', {exact: true}).fill('Synthetic complete package ready for independent lender applications.');
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
  await emailDraft.getByLabel('Institution-specific missing documents, one per line', {exact: true}).fill('Synthetic additional employment letter');
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
  await review.getByLabel('Document and destination review note', {exact: true}).fill('Synthetic destination and file checklist checked.');
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
  await outcome.getByLabel('Lender-reported status', {exact: true}).selectOption('approved');
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
  await expect(page.getByLabel('Verified HTTPS portal URL', {exact: true}).last()).toBeVisible();
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
  await draft.getByLabel('Internal application note', {exact: true}).fill('Keep this synthetic draft note.');
  await draft.getByRole('button', {name: 'Create application draft', exact: true}).click();
  await expect(page.getByRole('alert')).toHaveText('Synthetic revision conflict. Review and retry.');
  await expect(draft.getByLabel('Bank / credit company', {exact: true})).toHaveValue(ids.email);
  await expect(draft.getByLabel('Submission channel', {exact: true})).toHaveValue('email');
  await expect(draft.getByLabel('Email subject (email only)', {exact: true})).toHaveValue('Synthetic email subject');
  await expect(draft.getByLabel('Email message (email only)', {exact: true})).toHaveValue('Synthetic prepared email. Attach documents manually.');
  await expect(draft.getByLabel('Internal application note', {exact: true})).toHaveValue('Keep this synthetic draft note.');
  await expect(draft.getByLabel('synthetic-identity.pdf', {exact: true})).toBeChecked();
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
  await install(page, {role: 'admin', userId: ids.coordinator, assigned: false, applications: [application('portal', 'ready'), application('email', 'approved')]});
  await expect(page.locator('#financeMain form')).toHaveCount(1);
  await expect(form(page, 'assign-admin')).toBeVisible();
  await expect(page.locator('summary').filter({hasText: 'Add an institution application'})).toHaveCount(0);
  await expect(form(page, 'submission')).toHaveCount(0);
  await expect(form(page, 'outcome')).toHaveCount(0);
  await expect(form(page, 'select')).toHaveCount(0);
  await expect(page.getByRole('button', {name: /Open configured lender portal/})).toHaveCount(0);
  let assign = form(page, 'assign-admin');
  await assign.getByLabel('Responsible Submission Admin', {exact: true}).selectOption(ids.office);
  await assign.getByLabel('Assignment / reassignment reason', {exact: true}).fill('Synthetic initial assignment to available submission staff.');
  await assign.getByRole('button', {name: 'Save Admin assignment', exact: true}).click();
  expect(await calls(page, 'assignAdmin')).toEqual([]);
  await assign.locator('[name="access"]').check();
  await assign.getByRole('button', {name: 'Save Admin assignment', exact: true}).click();
  await expect.poll(async () => (await state(page)).financeCase.office_admin).toBe(ids.office);
  await expect(page.locator('#financeMain form')).toHaveCount(1);
  assign = form(page, 'assign-admin');
  await assign.getByLabel('Responsible Submission Admin', {exact: true}).selectOption(ids.other);
  await assign.getByLabel('Assignment / reassignment reason', {exact: true}).fill('Synthetic reassignment for workload coverage.');
  await assign.locator('[name="access"]').check();
  await assign.getByRole('button', {name: 'Save Admin assignment', exact: true}).click();
  await expect.poll(async () => (await state(page)).financeCase.office_admin).toBe(ids.other);
  expect((await state(page)).financeCase.coordinator).toBe(ids.coordinator);
  expect((await calls(page, 'assignAdmin')).map(call => call.args[1])).toEqual([ids.office, ids.other]);
  await expect(page.locator('#financeMain form')).toHaveCount(1);
});

test('coordinator id without active dispatcher capability grants no assignment controls', async ({page}) => {
  await install(page, {role: 'admin', userId: ids.coordinator, dispatcher: false, assigned: false});
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
  await edit.getByLabel('Email subject (email only)', {exact: true}).fill('Changed synthetic subject requires a new review');
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
