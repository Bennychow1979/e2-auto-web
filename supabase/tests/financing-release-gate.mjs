import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

// Execute only local modules and synthetic adapters. This suite must not import
// a Supabase SDK, open a real session, or contact a backend, even on failure.
const read = name => readFile(new URL(`../../${name}`, import.meta.url), 'utf8');
let imports = 0, assertions = 0;
const moduleFrom = source => import(`data:text/javascript;charset=utf-8,${encodeURIComponent(source + `\n// isolated test ${imports++}`)}`);
const checkEqual = (actual, expected, message) => { assert.deepEqual(actual, expected, message); assertions++; };
const originalGlobals = Object.fromEntries(['E2_CONFIG', 'window', 'location', '__releaseGateTest'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
try {
  const featureSource = await read('financing-feature.mjs');
  const feature = await moduleFrom(featureSource);
  for (const config of [undefined, null, {}, {financingCases: false}, {financingCases: 'true'}, {financingCases: 1}, {financingCases: {}}, {financingCases: true}]) {
    globalThis.E2_CONFIG = config;
    checkEqual(feature.financingEnabled(), config?.financingCases === true, `Only boolean true enables financing: ${JSON.stringify(config)}`);
  }
  const configContext = {window: {}};
  vm.runInNewContext(await read('e2-config.js'), configContext);
  checkEqual(configContext.window.E2_CONFIG.financingCases, false, 'Checked-in config must default financing off');

  // Verify the real routing predicate and SDK options rather than a parallel
  // reimplementation. Replacing its imports makes a remote SDK impossible.
  const clientCalls = [];
  globalThis.__releaseGateTest = {createClient: (...args) => {clientCalls.push(args); return {synthetic: true};}};
  globalThis.window = {E2_CONFIG: {supabaseUrl: 'https://synthetic-release-test.supabase.co', publishableKey: 'sb_publishable_synthetic'}};
  const dataSource = (await read('e2-data.js'))
    .replace(/import\s*\{\s*createClient\s*\}\s*from\s*['"]https:[^'"]+['"];?/, 'const {createClient}=globalThis.__releaseGateTest;')
    .replace(/import\s*\{\s*resolvePhotoURLs\s*\}\s*from\s*['"][^'"]+['"];?/, 'const resolvePhotoURLs=()=>{throw Error("Photos are outside this isolated auth test.")};');
  assert(!/\bimport\s*(?:\{|\*)/.test(dataSource), 'The SDK and helper imports must be replaced before evaluation'); assertions++;
  for (const [path, persistent] of [
    ['/financing-case.html?source=intake&id=synthetic', true],
    ['/financing-case.html?source=loan&id=synthetic', true],
    ['/portal.html', true], ['/intake-workspace.html', true], ['/loans.html', true],
    ['/documents.html?staff=1', true], ['/car.html?preview=1', true],
    ['/index.html', false], ['/showroom.html', false], ['/intake.html?invite=synthetic', false],
    ['/documents.html?application=synthetic', false], ['/car.html', false], ['/customer.html', false],
  ]) {
    globalThis.location = new URL(path, 'https://synthetic.example.test');
    await moduleFrom(dataSource);
    checkEqual(clientCalls.at(-1), ['https://synthetic-release-test.supabase.co', 'sb_publishable_synthetic', {
      auth: {persistSession: persistent, autoRefreshToken: persistent, detectSessionInUrl: persistent, storageKey: 'e2-staff-auth'},
    }], `Auth options must preserve staff/public isolation on ${path}`);
  }

  let membership = {role: 'sales', active: true}, signedIn = true;
  const calls = [];
  const source = {id: 'synthetic-intake', revision: 1, details: {name: 'Synthetic applicant'}, status: 'Received by Salesman'};
  const data = {staff_memberships: () => membership, intake_submissions: () => source, intake_files: () => [], intake_events: () => []};
  const db = {
    auth: {getUser: async () => ({data: {user: signedIn ? {id: 'synthetic-staff'} : null}})},
    from(table) {
      calls.push({table});
      if (!data[table]) throw Error(`No finance schema or unexpected table: ${table}`);
      const query = {select() {return query;}, eq() {return query;}, order() {return query;}, range() {return query;},
        single: async () => ({data: data[table]()}), then: (resolve, reject) => Promise.resolve({data: table === 'intake_submissions' ? [source] : data[table]()} ).then(resolve, reject)};
      return query;
    },
    rpc(name, args) {calls.push({rpc: name, args}); if (name !== 'e2_intake_progress') throw Error(`No finance schema or unexpected RPC: ${name}`); return Promise.resolve({data: true});},
    storage: {from(bucket) {assert.equal(bucket, 'intake-documents'); return {download: async path => ({data: new Blob([`synthetic:${path}`])})};}},
  };
  globalThis.__releaseGateTest = {db, check: r => {if (r.error) throw r.error; return r.data;}, getVehicles: async () => []};
  const featureURL = `data:text/javascript;charset=utf-8,${encodeURIComponent(featureSource)}`;
  const intakeSource = (await read('intake-staff-data.js'))
    .replace(/import\s*\{\s*db\s*,\s*check\s*,\s*getVehicles\s*\}\s*from\s*['"]\.\/e2-data\.js[^'"]*['"];?/, 'const {db,check,getVehicles}=globalThis.__releaseGateTest;')
    .replace(/(['"])\.\/financing-feature\.mjs[^'"]*\1/g, JSON.stringify(featureURL));
  assert(!intakeSource.includes("from './e2-data"), 'Real intake adapter must use the synthetic db'); assertions++;
  const intake = await moduleFrom(intakeSource);
  for (const config of [undefined, {}, {financingCases: false}, {financingCases: 'true'}]) {
    globalThis.E2_CONFIG = config; calls.length = 0;
    checkEqual(await intake.who(), {id: 'synthetic-staff', role: 'sales', is_dispatcher: false}, 'Existing staff identity must work without financing schema');
    checkEqual(calls, [{table: 'staff_memberships'}], 'Disabled rollout must not ask for coordinator capability');
    checkEqual(await intake.list(0), [source], 'Legacy intake list remains readable');
    checkEqual(await intake.detail(source.id), {app: source, files: [], events: []}, 'Legacy submitted detail remains readable');
    checkEqual(await (await intake.download('synthetic/file.pdf')).text(), 'synthetic:synthetic/file.pdf', 'Existing private download uses its existing bucket');
    await intake.progress(source, 'Needs information', 'Synthetic follow-up');
    checkEqual(calls.at(-1), {rpc: 'e2_intake_progress', args: {target: source.id, next_status: 'Needs information', message: 'Synthetic follow-up', expected_revision: 1}}, 'Legacy progress stays revision-bound');
  }
  globalThis.E2_CONFIG = {financingCases: false};
  for (const invalid of [{role: 'sales', active: false}, {role: 'customer', active: true}]) {
    membership = invalid;
    await assert.rejects(intake.who, /Staff intake access required/); assertions++;
  }
  signedIn = false;
  await assert.rejects(intake.who, /Staff sign in required/); assertions++;
  membership = {role: 'sales', active: true}; signedIn = true; globalThis.E2_CONFIG = {financingCases: true};
  await assert.rejects(intake.who, /No finance schema or unexpected RPC: e2_finance_is_dispatcher/); assertions++;
  console.log(`PASS financing release gate: ${assertions} synthetic assertions (exact flag, default config, staff/public auth isolation, legacy intake, access checks)`);
} finally {
  for (const [key, descriptor] of Object.entries(originalGlobals)) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
  }
}
