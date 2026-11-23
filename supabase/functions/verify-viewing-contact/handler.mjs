import {timingSafeEqual} from 'node:crypto';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const digest = async value => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
export function normalizePhone(value) {
  const digits = value.replace(/[^0-9]/g, '');
  return digits.startsWith('0') ? '6' + digits : digits;
}
const respond = (status, body = {found:false}, extra = {}) => Response.json(body, {
  status, headers:{'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff', ...extra}
});

async function readBody(request) {
  if (Number(request.headers.get('content-length')) > 2048) throw Error('size');
  const reader = request.body?.getReader();
  if (!reader) throw Error('body');
  let size = 0, chunks = [];
  try {
    while (true) {
      const {value, done} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2048) { await reader.cancel(); throw Error('size'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(bytes));
}

// Explicitly reconstruct the public response: never spread a database row.
export function publicResult(result) {
  if (result?.found !== true) return {found:false};
  if (typeof result.match !== 'boolean' || typeof result.already_verified !== 'boolean'
    || (result.vehicle_label !== null && typeof result.vehicle_label !== 'string')
    || !/^\d{4}-\d{2}-\d{2}$/.test(result.preferred_date)
    || (!result.match && !/^\d{4}$/.test(result.form_last4))) throw Error('result');
  return {
    found:true, match:result.match, already_verified:result.already_verified,
    vehicle_label:result.vehicle_label, preferred_date:result.preferred_date,
    ...(!result.match ? {form_last4:result.form_last4} : {})
  };
}

export function createHandler({key = '', store}) {
  const expected = digest(key);
  return async request => {
    try {
      const provided = request.headers.get('x-e2-verify-key') || '';
      const equal = timingSafeEqual(await digest(provided), await expected);
      if (!equal || !key || !provided) return respond(401);
      // A global rolling window shared by all Edge isolates. Failed auth never queries data.
      if (!(await store.takeRateSlot())) return respond(429, {found:false}, {'Retry-After':'60'});
      if (request.headers.has('origin')) return respond(403);
      if (request.method !== 'POST') return respond(405, {found:false}, {Allow:'POST'});
      if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return respond(400);
      let input;
      try { input = await readBody(request); } catch { return respond(400); }
      if (!input || typeof input.ref !== 'string' || !uuid.test(input.ref)
        || typeof input.phone !== 'string' || input.phone.length > 128) return respond(400);
      const phone = normalizePhone(input.phone);
      if (!/^[1-9][0-9]{7,14}$/.test(phone)) return respond(400);
      return respond(200, publicResult(await store.verify(input.ref, phone)));
    } catch {
      // Do not log request bodies, credentials, database errors or customer data.
      return respond(503);
    }
  };
}
