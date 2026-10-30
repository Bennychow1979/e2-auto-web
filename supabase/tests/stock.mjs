import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, mkdtemp, access} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {renderStock} from '../../scripts/build-stock.mjs';
import {buildVehicleSite, publicRows, createSlugMap} from '../../scripts/build-vehicle-pages.mjs';
import {vehicleA, vehicleB, vehicleSold} from '../../tests/fixtures/vehicle-pages.mjs';

const now = Date.parse('2026-10-30T12:00:00Z');
const snapshot = vehicles => ({kind: 'public-complete', complete: true,
  expectedCount: vehicles.filter(v => v.publication === 'published').length,
  fetchedAt: new Date(now).toISOString(), vehicles});
const parse = text => {
  const lines = text.trim().split('\n').filter(l => !l.startsWith('#')).map(l => JSON.parse(l));
  return lines.map(value => Array.isArray(value) ? Object.fromEntries(lines[0].columns.map((key, i) => [key, value[i]])) : value);
};

test('freshness uses acquisition time with the existing 30-minute limit and one-minute future tolerance', () => {
  const input = snapshot([vehicleA]);
  assert.equal(publicRows(input, {now: now + 1800000}).length, 1);
  assert.throws(() => publicRows(input, {now: now + 1800001}), /fresh public snapshot/);
  assert.equal(publicRows({...input, fetchedAt: new Date(now + 60000).toISOString()}, {now}).length, 1);
  assert.throws(() => publicRows({...input, fetchedAt: new Date(now + 60001).toISOString()}, {now}));
  const text = renderStock(input.vehicles, {slugs: createSlugMap(input.vehicles), fetchedAt: input.fetchedAt,
    builtAt: new Date(now + 1800001).toISOString(), complete: true});
  assert.equal(parse(text)[0].snapshot_at, input.fetchedAt);
  assert(text.includes('Measure age from snapshot_at, never built_at'));
  assert(text.includes('complete means snapshot coverage, not freshness or successful deployment'));
});

test('compact stock contains every public unit once, with exact facts, statuses and canonical links', () => {
  const rows = publicRows(snapshot([vehicleA, {...vehicleB, stock_status: 'Reserved'}, vehicleSold,
    {...vehicleA, id: 'ffffffff-1111-4111-8111-111111111111', publication: 'draft'}]), {now});
  const slugs = createSlugMap(rows), options = {slugs, fetchedAt: new Date(now).toISOString(), builtAt: new Date(now).toISOString(), complete: true};
  const result = parse(renderStock(rows, options)), header = result.shift(), footer = result.pop();
  assert.equal(header.complete, true);
  assert.deepEqual(header.columns, ['year', 'make', 'model', 'variant', 'plate', 'status', 'price_myr', 'url']);
  assert.equal(header.snapshot_at, options.fetchedAt);
  assert.deepEqual(header.counts, {Available: 1, Reserved: 1, Sold: 1});
  assert.equal(header.vehicles, 3); assert.equal(footer.vehicles, 3);
  assert.equal(new Set(result.map(v => v.url)).size, 3);
  for (const car of rows) {
    const row = result.find(v => v.url === 'https://e2auto.my/cars/' + slugs[car.id] + '/');
    assert.deepEqual(row, {year: car.year, make: car.brand, model: car.model, variant: car.variant,
      plate: car.plate, status: car.stock_status, price_myr: car.price, url: row.url});
  }
  assert.equal(renderStock([...rows].reverse(), options), renderStock(rows, options));
  assert.equal(parse(renderStock(rows, {...options, complete: false}))[0].complete, false);
});

test('119 representative records fit the observed 20,000-character reader limit without dropping fields or records', () => {
  const rows = Array.from({length: 119}, (_, i) => ({...vehicleB,
    id: 'aaaaaaaa-1111-4111-8111-' + String(i).padStart(12, '0'), plate: 'TEST' + i}));
  const text = renderStock(rows, {slugs: createSlugMap(rows), fetchedAt: new Date(now).toISOString(), builtAt: new Date(now).toISOString(), complete: true});
  assert(text.length < 20000);
  const parsed = parse(text);
  assert.equal(parsed.length, 121);assert.equal(parsed[0].vehicles, 119);assert.equal(parsed.at(-1).vehicles, 119);
  assert(parsed.slice(1, -1).every(row => Object.keys(row).length === 8));
});

test('quotes, line breaks, delimiters, Unicode and markup remain one data record; private fields are excluded', () => {
  const model = 'CITY "RS"\t|\r\n# fake header <script>& 雪\u2028test\u2029';
  const rows = publicRows(snapshot([{...vehicleA, model, variant: null,
    customer: 'PRIVATE-CUSTOMER', loan: 'PRIVATE-LOAN', description: 'PRIVATE-FREETEXT',
    vehicle_photos: [{signedUrl: 'PRIVATE-TICKET'}]}]), {now});
  const text = renderStock(rows, {slugs: createSlugMap(rows), fetchedAt: 'snapshot', builtAt: 'build'});
  assert.equal(parse(text).length, 3); assert.equal(parse(text)[1].model, model);
  assert.equal(parse(text)[1].variant, null);
  assert(!text.includes('<script>')); assert(!text.includes('PRIVATE-'));
  assert(!text.includes('\r')); assert(!text.includes('\t'));
  assert.throws(() => renderStock([{...vehicleA, publication: 'draft'}], {slugs: createSlugMap(rows)}));
  assert.throws(() => renderStock(rows, {slugs: {}}));
});

test('same build updates stock, pages and sitemap; rejected snapshots preserve prior stock byte-for-byte', async () => {
  const out = join(await mkdtemp(join(tmpdir(), 'e2-stock-')), 'site');
  const original = snapshot([vehicleA, vehicleB, vehicleSold]);
  const first = await buildVehicleSite(original, out, {now});
  const firstText = await readFile(join(out, 'stock.txt'), 'utf8');
  const changed = snapshot([{...vehicleA, model: 'CHANGED', price: 12345, stock_status: 'Reserved'},
    {...vehicleB, publication: 'draft'}, vehicleSold]);
  changed.fetchedAt = new Date(now + 60000).toISOString();
  const second = await buildVehicleSite(changed, out, {now: now + 60000, includeSold: false});
  const text = await readFile(join(out, 'stock.txt'), 'utf8'), parsed = parse(text);
  assert.notEqual(firstText, text); assert.equal(parsed[0].vehicles, 2);
  assert.equal(parsed[0].snapshot_at, changed.fetchedAt);
  assert.equal(parsed[0].built_at, second.builtAt);
  assert.equal(parsed[1].model, 'CHANGED'); assert.equal(parsed[1].price_myr, 12345);
  assert.equal(parsed[1].status, 'Reserved'); assert.equal(parsed[2].status, 'Sold');
  assert.equal(second.slugs[vehicleA.id], first.slugs[vehicleA.id]);
  for (const row of parsed.slice(1, -1)) {
    const html = await readFile(join(out, new URL(row.url).pathname, 'index.html'), 'utf8');
    assert(html.includes('rel="canonical" href="' + row.url + '"'));
  }
  const xml = await readFile(join(out, 'sitemap.xml'), 'utf8');
  assert(xml.includes(parsed[1].url)); assert(!xml.includes(first.slugs[vehicleB.id]));
  // Sold remains a public page and stock row even if explicitly excluded from sitemap.
  assert(!xml.includes(first.slugs[vehicleSold.id]));
  await assert.rejects(access(join(out, 'cars', first.slugs[vehicleB.id], 'index.html')));
  for (const bad of [snapshot([]), {...original, expectedCount: 4},
    {...original, fetchedAt: new Date(now - 1800001).toISOString()},
    {...original, fetchedAt: new Date(now + 60001).toISOString()},
    snapshot([{...vehicleA, price: null}])]) {
    await assert.rejects(buildVehicleSite(bad, out, {now}));
    assert.equal(await readFile(join(out, 'stock.txt'), 'utf8'), text);
  }
});
