// Synthetic browser-only financing state. No production account, institution,
// customer document, credential, or remote endpoint participates in this suite.
import {pdfBytes} from './preview-fixtures.mjs';

export const ids = {
  source: '11111111-1111-4111-8111-111111111111',
  case: '44444444-4444-4444-8444-444444444444',
  sales: '33333333-3333-4333-8333-333333333333',
  office: '55555555-5555-4555-8555-555555555555',
  other: '66666666-6666-4666-8666-666666666666',
  coordinator: 'abababab-abab-4bab-8bab-abababababab',
  super: '77777777-7777-4777-8777-777777777777',
  portal: '88888888-8888-4888-8888-888888888888',
  email: '99999999-9999-4999-8999-999999999999',
  file: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  statement: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
};
export const source = {
  id: ids.source, revision: 1, salesperson: ids.sales, applicant_type: 'worker', submitted_at: '2026-01-01T00:00:00.000Z',
  details: {name: 'Synthetic test applicant'},
  vehicle_summary: {name: 'Synthetic test vehicle', plate: 'TEST ONLY'},
};
export const files = [
  {id: ids.file, filename: 'synthetic-identity.pdf', category: 'ic_front'},
  {id: ids.statement, filename: 'synthetic-statement.pdf', category: 'bank_statement'},
].map(file => ({...file, mime_type: 'application/pdf', path: `fixture/${file.filename}`, state: 'ready', removed_at: null, covered_months: file.category === 'bank_statement' ? ['2025-10', '2025-11', '2025-12'] : [], byte_size: pdfBytes.length}));
export const staff = [
  {user_id: ids.coordinator, display_name: 'Synthetic Coordinator', role: 'office_admin', is_dispatcher: true, active: true},
  {user_id: ids.sales, display_name: 'Synthetic Salesman', role: 'sales'},
  {user_id: ids.office, display_name: 'Synthetic Submission Admin', role: 'office_admin'},
  {user_id: ids.other, display_name: 'Other Synthetic Admin', role: 'admin'},
  {user_id: ids.super, display_name: 'Synthetic Super Admin', role: 'super_admin'},
];
export const institutions = [
  {id: ids.portal, name: 'Synthetic Portal Bank', kind: 'bank', active: true, revision: 1, portal_url: 'https://portal.example.test/financing', email_to: null, required_documents: ['Identity document', 'Three months of statements']},
  {id: ids.email, name: 'Synthetic Email Credit', kind: 'credit_company', active: true, revision: 1, portal_url: null, email_to: 'financing@example.test', required_documents: ['Identity document']},
];
export function fixture({role = 'office_admin', userId, tracking = true, handed = true, assigned = true, dispatcher = true, caseOverrides = {}, sourceOverrides = {}, applications = [], defer = []} = {}) {
  const user = {id: userId || ({sales: ids.sales, office_admin: ids.office, admin: ids.other, super_admin: ids.super}[role]), role};
  user.is_dispatcher = user.id === ids.coordinator && dispatcher;
  return {
    ids, user, source: {...source,...sourceOverrides}, files, staff: staff.map(member => ({...member, ...(member.user_id === ids.coordinator ? {is_dispatcher: dispatcher} : {})})), institutions, applications, tracking, defer,
    bytes: [...pdfBytes],
    financeCase: {
      id: ids.case, case_name: 'Synthetic test applicant', revision: 1, content_revision: 1,
      salesperson: ids.sales, coordinator: handed ? ids.coordinator : null, office_admin: handed && assigned ? ids.office : null,
      review_state: handed ? 'complete' : 'pending', reviewed_content_revision: handed ? 1 : null,
      missing_items: [], review_note: '', handed_at: handed ? '2026-01-02T00:00:00.000Z' : null,
      selected_application_id: null, selection_evidence: null, ...caseOverrides,
    },
  };
}
export function application(channel = 'portal', status = 'draft', overrides = {}) {
  const institution = institutions.find(row => row.id === ids[channel]);
  const submitted = ['submitted', 'under_review', 'needs_information', 'approved', 'rejected', 'withdrawn'].includes(status);
  return {
    id: channel === 'portal' ? 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' : 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    case_id: ids.case, institution_id: institution.id, institution_revision: institution.revision, institution_name: institution.name, assignee: ids.office, channel, status, revision: 1,
    portal_url: institution.portal_url, email_to: institution.email_to,
    email_subject: channel === 'email' ? 'Synthetic financing review' : '',
    email_body: channel === 'email' ? 'Synthetic draft for browser testing only.' : '',
    attachment_ids: [ids.file], missing_documents: [], note: '',
    submitted_at: submitted ? '2026-01-03T00:00:00.000Z' : null,
    external_reference: submitted ? `SYNTHETIC-${channel.toUpperCase()}` : null,
    submission_evidence: submitted ? 'Synthetic external completion evidence.' : null,
    offer_amount: status === 'approved' ? 55000 : null,
    offer_rate: status === 'approved' ? 3.25 : null,
    offer_tenure_months: status === 'approved' ? 60 : null,
    ...overrides,
  };
}

// Every financing-data.js export is replaced. Keeping executable browser state
// separate makes deferred loads, errors, and auth changes deterministic.
export function financingDataMock() {
  return `
    const state = () => window.__financeFixture;
    export const db = {auth: {onAuthStateChange(callback) { state().auth = callback; }}};
    export const who = () => state().who();
    export const load = (...args) => state().load(...args);
    export const start = (...args) => state().mutate('start', args);
    export const adoptLegacy = (...args) => state().mutate('adoptLegacy', args);
    export const review = (...args) => state().mutate('review', args);
    export const handoff = (...args) => state().mutate('handoff', args);
    export const assignAdmin = (...args) => state().mutate('assignAdmin', args);
    export const saveApplication = (...args) => state().mutate('saveApplication', args);
    export const reviewApplication = (...args) => state().mutate('reviewApplication', args);
    export const recordSubmission = (...args) => state().mutate('recordSubmission', args);
    export const outcome = (...args) => state().mutate('outcome', args);
    export const selectOffer = (...args) => state().mutate('selectOffer', args);
    export const saveInstitution = (...args) => state().mutate('saveInstitution', args);
    export const download = (...args) => state().download(...args);
    export const signOut = () => state().signOut();
  `;
}

export function initializeFinancingFixture(data) {
  const copy = value => structuredClone(value);
  const state = {
    ...copy(data), calls: [], pending: [], settled: {}, failures: {}, auth: null,
    liveURLs: new Set(), createdURLs: [], revokedURLs: [], openedWindows: [], popups: [], lenderNavigations: [], popupBlocked: false, sequence: 1,
  };
  // Intercept every lender-opening attempt; browser tests never navigate off-origin.
  window.open = (...args) => {
    state.openedWindows.push(args);
    if (state.popupBlocked) return null;
    const record = {args, opener: 'synthetic-opener', navigations: [], closed: false};
    state.popups.push(record);
    return {
      get opener() {return record.opener;},
      set opener(value) {record.opener = value;},
      location: {replace(url) {record.navigations.push(url); state.lenderNavigations.push(url);}},
      close() {record.closed = true;},
    };
  };
  const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
  URL.createObjectURL = blob => {
    const url = create(blob); state.createdURLs.push(url); state.liveURLs.add(url); return url;
  };
  URL.revokeObjectURL = url => {
    state.revokedURLs.push(url); state.liveURLs.delete(url); revoke(url);
  };
  state.wait = async method => {
    if (state.defer.includes(method)) await new Promise(resolve => state.pending.push({method, resolve, released: false}));
    if (state.failures[method]) throw Error(state.failures[method]);
  };
  state.release = method => {
    const entry = state.pending.find(item => item.method === method && !item.released);
    if (entry) {entry.released = true; entry.resolve();}
  };
  state.finish = method => {state.settled[method] = (state.settled[method] || 0) + 1;};
  state.who = async () => {
    state.calls.push({method: 'who', args: []});
    const user = copy(state.user);
    try {await state.wait('who'); return user;} finally {state.finish('who');}
  };
  state.load = async (...args) => {
    state.calls.push({method: 'load', args});
    const value = {source: copy(state.source), files: copy(state.files), workspace: state.tracking ? {
      case: copy(state.financeCase), applications: copy(state.applications), institutions: copy(state.institutions), staff: copy(state.staff), history: [],
    } : null};
    try {await state.wait('load'); return value;} finally {state.finish('load');}
  };
  state.download = async (...args) => {
    state.calls.push({method: 'download', args});
    try {
      await state.wait('download');
      if (!state.files.some(file => file.path === args[1])) throw Error('Unexpected synthetic file path.');
      return new Blob([new Uint8Array(state.bytes)], {type: 'application/pdf'});
    } finally {state.finish('download');}
  };
  state.signOut = async () => {
    state.calls.push({method: 'signOut', args: []}); state.auth('SIGNED_OUT', null);
  };
  state.mutate = async (method, args) => {
    state.calls.push({method, args: copy(args)});
    try {
      await state.wait(method);
      const c = state.financeCase;
      const a = state.applications.find(item => item.id === args[0]?.id);
      if (method === 'start') state.tracking = true;
      if (method === 'adoptLegacy') {state.tracking=true;Object.assign(c,{coordinator:state.user.id,office_admin:state.source.office_admin,handed_at:state.source.handed_at,review_state:'pending',reviewed_content_revision:null,revision:c.revision+1});}
      if (method === 'review') {
        const p = args[1]; Object.assign(c, p, {review_state: p.details_checked && p.documents_checked && !p.missing_items.length ? 'complete' : 'needs_information', reviewed_content_revision: c.content_revision, revision: c.revision + 1});
      }
      if (method === 'handoff') Object.assign(c, {coordinator: args[1], office_admin: null, handed_at: '2026-01-02T00:00:00.000Z', revision: c.revision + 1});
      if (method === 'assignAdmin') Object.assign(c, {office_admin: args[1], revision: c.revision + 1});
      if (method === 'saveApplication') {
        const [, existing, payload] = args, institution = state.institutions.find(row => row.id === payload.institution_id);
        if (!institution) throw Error('Choose a synthetic institution.');
        const values = {...copy(payload), portal_url: institution.portal_url, email_to: institution.email_to, institution_revision: institution.revision, institution_name: institution.name, status: 'draft', submitted_at: null, external_reference: null};
        if (existing) Object.assign(state.applications.find(row => row.id === existing.id), values, {revision: existing.revision + 1});
        else state.applications.push({id: `eeeeeeee-eeee-4eee-8eee-${String(state.sequence++).padStart(12, '0')}`, case_id: c.id, revision: 1, ...values});
      }
      if (method === 'reviewApplication') Object.assign(a, {status: 'ready', revision: a.revision + 1, review_note: args[1]});
      if (method === 'recordSubmission') Object.assign(a, {status: 'submitted', submitted_at: args[1].submitted_at, external_reference: args[1].external_reference, submission_evidence: args[1].evidence, revision: a.revision + 1});
      if (method === 'outcome') Object.assign(a, copy(args[1]), {status: args[1].next_status, revision: a.revision + 1});
      if (method === 'selectOffer') Object.assign(c, {selected_application_id: args[1].id, selection_evidence: args[2], revision: c.revision + 1});
      if (method === 'saveInstitution') throw Error('Institution mutation not part of this browser fixture.');
      return copy(method === 'start' || ['review', 'handoff', 'selectOffer'].includes(method) ? c : a || null);
    } finally {state.finish(method);}
  };
  window.__financeFixture = state;
}
