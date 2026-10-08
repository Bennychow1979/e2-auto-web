import {test as base, expect} from '@playwright/test';
import {
  applicationId, staffId, files, browserFixture, initializePreviewFixture,
} from './fixtures/preview-fixtures.mjs';

// The real intake adapter and loan workspace use this deliberately old-schema
// db. Every unlisted table/RPC throws, including all new financing APIs. Nothing
// here can create an SDK client, access real credentials, or send backend data.
function legacyDataMock() {
  return `
    const state = () => window.__releaseGateFixture;
    export const check = result => {if (result.error) throw result.error; return result.data;};
    export const getVehicles = async () => [];
    export const db = {
      auth: {
        getUser: async () => ({data: {user: state().signedIn ? {id: state().staffId} : null}}),
        getSession: async () => ({data: {session: state().signedIn ? {user: {id: state().staffId}} : null}}),
        onAuthStateChange(callback) {state().auth = callback;},
        async signOut(options) {state().calls.push({method: 'signOut', options}); state().signedIn = false; state().auth?.('SIGNED_OUT', null); return {data: {}};},
      },
      from(table) {
        const s = state(); s.calls.push({table});
        if (!['staff_memberships', 'intake_submissions', 'intake_files', 'intake_events', 'intake_links', 'loan_applications', 'loan_events'].includes(table)) {
          throw Error('Financing schema unavailable or unexpected table: ' + table);
        }
        let single = false;
        const result = () => ({data: table === 'staff_memberships' ? {role: s.role, active: s.active}
          : ['intake_submissions', 'loan_applications'].includes(table) ? (single ? s.application : [s.application])
          : table === 'intake_files' ? s.files : []});
        const query = {
          select() {return query;}, eq() {return query;}, not() {return query;}, order() {return query;}, range() {return query;}, limit() {return query;},
          single() {single = true; return Promise.resolve(result());},
          then(resolve, reject) {return Promise.resolve(result()).then(resolve, reject);},
        };
        return query;
      },
      async rpc(name, args) {
        const s = state(); s.calls.push({rpc: name, args});
        if (name === 'e2_is_super_admin') return {data: false};
        if (name === 'e2_intake_office_choices') return {data: []};
        if (['e2_intake_progress', 'e2_update_loan_status'].includes(name)) {
          s.application.status = args.next_status; s.application.revision++; return {data: true};
        }
        throw Error('Financing schema unavailable or unexpected RPC: ' + name);
      },
      storage: {from(bucket) {
        const s = state(); s.calls.push({bucket});
        if (bucket !== 'intake-documents') throw Error('Unexpected private bucket: ' + bucket);
        return {download: async path => ({data: await window.__previewFixture.download(path)})};
      }},
    };
  `;
}
// Parse emitted browser code during collection, including on hosts without IPC.
const mockExports = await import(`data:text/javascript;charset=utf-8,${encodeURIComponent(legacyDataMock())}`);
for (const name of ['db', 'check', 'getVehicles']) {
  if (!(name in mockExports)) throw Error(`Legacy test adapter is missing ${name}`);
}

const test = base.extend({
  audit: [async ({page, context, baseURL}, use) => {
    const result = {requests: [], externalRequests: [], pageErrors: []};
    page.on('request', request => result.requests.push(request.url()));
    page.on('pageerror', error => result.pageErrors.push(error.message));
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (['http:', 'https:'].includes(url.protocol) && url.origin !== new URL(baseURL).origin) {
        result.externalRequests.push(url.href); await route.abort('blockedbyclient');
      } else await route.continue();
    });
    await use(result);
    expect(result.externalRequests, 'No external requests or real backend calls are allowed').toEqual([]);
    expect(result.pageErrors, 'No unhandled browser exceptions').toEqual([]);
    if (!page.isClosed()) {
      const calls = await page.evaluate(() => window.__releaseGateFixture?.calls || []);
      expect(calls.filter(call => /financ/i.test(call.rpc || call.table || '')), 'Disabled rollout cannot require any finance RPC or table').toEqual([]);
    }
  }, {auto: true}],
});
test.use({timezoneId: 'UTC'});

async function setConfig(page, variant) {
  if (variant === 'committed default') return;
  const body = variant === 'missing config' ? 'delete window.E2_CONFIG;'
    : `window.E2_CONFIG = Object.freeze(${JSON.stringify(variant === 'missing flag' ? {} : {financingCases: variant === 'truthy string' ? 'true' : false})});`;
  await page.route('**/e2-config.js*', route => route.fulfill({contentType: 'text/javascript', body}));
}

for (const variant of ['committed default', 'missing config', 'missing flag', 'truthy string']) {
  for (const source of ['intake', 'loan']) {
    test(`${variant}: ${source} case route stops before any data import`, async ({page, audit}) => {
      await setConfig(page, variant);
      await page.route(/\/(?:financing-data|e2-data)\.js(?:\?|$)/, route => route.fulfill({
        contentType: 'text/javascript', body: 'throw Error("Disabled financing must never import this data adapter.");',
      }));
      await page.goto(`/financing-case.html?source=${source}&id=${applicationId}`);
      await expect(page.getByText('Financing case tracking is not enabled yet.', {exact: true})).toBeVisible();
      await expect(page.locator('#financeMain a[href="intake-workspace.html"]')).toBeVisible();
      await expect(page.locator('#financeMain a[href="loans.html"]')).toBeVisible();
      await expect(page.locator('#financeMain form')).toHaveCount(0);
      await expect(page.locator('#financeSignOut')).toBeHidden();
      await expect(page.locator('#financeFilePreview')).not.toBeVisible();
      expect(audit.requests.filter(url => /\/(?:financing-data|e2-data)\.js(?:\?|$)/.test(url)), 'Disabled route must not even request a backend adapter').toEqual([]);
    });
  }
}

async function installLegacy(page, kind, variant = 'explicit false', options = {}) {
  await setConfig(page, variant);
  await page.addInitScript(initializePreviewFixture, browserFixture);
  await page.addInitScript(fixture => {window.__releaseGateFixture = {...fixture, calls: [], auth: null};}, {
    staffId, files, role: 'sales', active: true, signedIn: true, ...options,
    application: {
      id: applicationId, revision: 1, salesperson: staffId, assigned_sales: staffId, office_admin: null,
      vehicle_id: 'synthetic-car', vehicle_summary: {name: 'Synthetic legacy vehicle', plate: 'TEST ONLY', price: 50000},
      applicant_type: 'worker', details: {name: 'Synthetic legacy applicant', guarantor: 'Not requested'},
      status: kind === 'intake' ? 'Received by Salesman' : 'Submitted to E2',
      submitted_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
    },
  });
  await page.route('**/e2-data.js*', route => route.fulfill({contentType: 'text/javascript', body: legacyDataMock()}));
  await page.route('**/financing-data.js*', route => route.fulfill({contentType: 'text/javascript', body: 'throw Error("No financing schema in this legacy fixture.");'}));
  await page.goto(kind === 'intake' ? '/intake-workspace.html' : '/loans.html');
}

const staffScreens = [
  {kind: 'intake', open: `[data-open="${applicationId}"]`, main: '#intakeWorkspace', form: '#progressIntake', status: 'status', note: 'note', save: 'Save progress', rpc: 'e2_intake_progress'},
  {kind: 'loan', open: `[data-loan="${applicationId}"]`, main: '#staffLoans', form: '#statusLoan', status: 'status', note: 'note', save: 'Update progress', rpc: 'e2_update_loan_status'},
];
for (const variant of ['explicit false', 'missing flag']) {
  for (const screen of staffScreens) {
    test(`${variant}: legacy ${screen.kind} list, detail, status, documents and sign out work with no finance schema`, async ({page, audit}) => {
      await installLegacy(page, screen.kind, variant);
      await expect(page.locator(screen.open)).toBeVisible();
      await expect(page.getByRole('button', {name: 'Sign out', exact: true})).toBeVisible();
      await page.locator(screen.open).click();
      await expect(page.getByRole('heading', {name: 'Synthetic legacy applicant', exact: true})).toBeVisible();
      await expect(page.locator('a[href*="financing-case.html"]')).toHaveCount(0);
      await expect(page.getByText(/older follow-up controls below only apply before case tracking starts/)).toHaveCount(0);
      const form = page.locator(screen.form);
      await expect(form).toBeVisible();
      await form.locator(`[name="${screen.status}"]`).selectOption('Needs information');
      await form.locator(`[name="${screen.note}"]`).fill('Synthetic legacy follow-up, no financing rollout required.');
      await form.getByRole('button', {name: screen.save, exact: true}).click();
      await expect(page.locator(`${screen.main} .eyebrow`)).toHaveText('Needs information');
      const calls = await page.evaluate(() => window.__releaseGateFixture.calls);
      expect(calls.filter(call => call.rpc === screen.rpc)).toEqual([{
        rpc: screen.rpc,
        args: {target: applicationId, next_status: 'Needs information', message: 'Synthetic legacy follow-up, no financing rollout required.', expected_revision: 1},
      }]);
      if (screen.kind === 'intake') {
        await page.locator('[data-file="image-file"]').click();
        const preview = page.locator('#staffFilePreview');
        await expect(preview).toBeVisible();
        await expect.poll(() => preview.locator('img').evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
        await expect(preview.getByRole('link', {name: 'Download file', exact: true})).toHaveAttribute('download', 'synthetic-image.png');
        await preview.getByRole('button', {name: 'Close preview', exact: true}).click();
        await expect(preview).not.toBeVisible();
        await expect.poll(() => page.evaluate(() => window.__previewFixture.liveURLs.size)).toBe(0);
      } else {
        await expect(page.getByRole('link', {name: 'View supporting documents ↗', exact: true})).toHaveAttribute('href', `documents.html?application=${applicationId}&staff=1`);
      }
      expect(audit.requests.filter(url => /\/financing-data\.js(?:\?|$)/.test(url))).toEqual([]);
      await page.getByRole('button', {name: 'Sign out', exact: true}).click();
      await expect(page.getByRole('link', {name: 'Staff sign in ↗', exact: true})).toBeVisible();
      await expect(page.locator(screen.main)).not.toContainText('Synthetic legacy applicant');
      expect(await page.evaluate(() => window.__releaseGateFixture.calls.filter(call => call.method === 'signOut'))).toEqual([{method: 'signOut', options: {scope: 'local'}}]);
    });
  }
}

for (const screen of staffScreens) {
  for (const [reason, options] of [['signed out', {signedIn: false}], ['inactive membership', {active: false}], ['non-staff role', {role: 'customer'}]]) {
    test(`disabled ${screen.kind}: ${reason} still cannot see submitted applications`, async ({page}) => {
      await installLegacy(page, screen.kind, 'explicit false', options);
      await expect(page.getByRole('link', {name: 'Staff sign in ↗', exact: true})).toBeVisible();
      await expect(page.locator(screen.open)).toHaveCount(0);
      await expect(page.locator(screen.main)).not.toContainText('Synthetic legacy applicant');
      const calls = await page.evaluate(() => window.__releaseGateFixture.calls);
      expect(calls.filter(call => ['intake_submissions', 'loan_applications'].includes(call.table))).toEqual([]);
    });
  }
}
