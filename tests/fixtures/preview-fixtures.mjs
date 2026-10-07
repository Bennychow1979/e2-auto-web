// All files and identities in these tests are synthetic. No customer data or
// authenticated storage endpoints are used by the browser regression suite.
export const applicationId = '11111111-1111-4111-8111-111111111111';
export const customerId = '22222222-2222-4222-8222-222222222222';
export const staffId = '33333333-3333-4333-8333-333333333333';

// A deterministic, genuinely multi-page PDF with a different central color on
// each page. The PDF is assembled with correct offsets rather than relying on
// another PDF library or a checked-in binary customer document.
export function createTwoPagePDF() {
  const streams = [
    'q 0.85 0.12 0.12 rg 0 0 300 400 re f Q\n',
    'q 0.10 0.25 0.85 rg 0 0 300 400 re f Q\n',
  ];
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Resources << >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(streams[0])} >>\nstream\n${streams[0]}endstream`,
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Resources << >> /Contents 6 0 R >>',
    `<< /Length ${Buffer.byteLength(streams[1])} >>\nstream\n${streams[1]}endstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

export const pdfBytes = createTwoPagePDF();
export const pngBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/q9sAAAAASUVORK5CYII=', 'base64');
export const corruptPDFBytes = Buffer.from('%PDF-1.7\nThis deliberately broken test PDF has no objects or trailer.\n');
export const files = [
  {id: 'pdf-file', filename: 'synthetic-two-pages.pdf', mime_type: 'application/pdf', path: 'fixture/two-pages.pdf', category: 'ic_front', byte_size: pdfBytes.length},
  {id: 'image-file', filename: 'synthetic-image.png', mime_type: 'image/png', path: 'fixture/image.png', category: 'ic_back', byte_size: pngBytes.length},
  {id: 'corrupt-file', filename: 'synthetic-corrupt.pdf', mime_type: 'application/pdf', path: 'fixture/corrupt.pdf', category: 'driving_license', byte_size: corruptPDFBytes.length},
].map(file => ({...file, state: 'ready', removed_at: null, covered_months: []}));

export const application = {
  id: applicationId,
  customer_id: customerId,
  applicant_type: 'worker',
  status: 'Submitted to E2',
  revision: 1,
  submitted_at: '2026-01-01T00:00:00.000Z',
  vehicle_summary: {name: 'Synthetic test vehicle', plate: 'TEST ONLY'},
};

const readonly = `const forbidden = () => { throw Error('Mutations are forbidden in preview tests.'); };`;

export function documentDataMock(staffView = false) {
  return `
    export const staffView = ${staffView};
    export const check = result => { if (result.error) throw result.error; return result.data; };
    export const db = {auth: {onAuthStateChange(callback) { window.__previewFixture.auth = callback; }}};
    export const sessionUser = async () => ({id: ${JSON.stringify(staffView ? staffId : customerId)}});
    export const application = async () => ${JSON.stringify(application)};
    export const documentRows = async () => ${JSON.stringify(files)};
    export const storage = () => ({download: async path => {
      try { return {data: await window.__previewFixture.download(path), error: null}; }
      catch (error) { return {data: null, error}; }
    }});
    ${readonly}
    export const setType = forbidden, reserve = forbidden, finish = forbidden, remove = forbidden;
  `;
}

export function intakeDataMock() {
  const intakeApplication = {...application, status: 'Sent to Office', office_admin: staffId, salesperson: 'other-staff', details: {name: 'Synthetic test applicant', guarantor: 'Not requested'}};
  return `
    export const db = {auth: {onAuthStateChange(callback) { window.__previewFixture.auth = callback; }}};
    export const who = async () => ({id: ${JSON.stringify(staffId)}, role: 'office_admin'});
    export const list = async offset => offset ? [] : [${JSON.stringify(intakeApplication)}];
    export const detail = async () => ({app: ${JSON.stringify(intakeApplication)}, files: ${JSON.stringify(files)}, events: []});
    export const cars = async () => [], office = async () => [], links = async () => [];
    export const download = path => window.__previewFixture.download(path);
    export const signOut = async () => { window.__previewFixture.auth('SIGNED_OUT', null); };
    ${readonly}
    export const create = forbidden, revoke = forbidden, assignVehicle = forbidden, handoff = forbidden, progress = forbidden;
  `;
}

export const browserFixture = {
  bytes: {
    'fixture/two-pages.pdf': [...pdfBytes],
    'fixture/image.png': [...pngBytes],
    'fixture/corrupt.pdf': [...corruptPDFBytes],
  },
};

export function initializePreviewFixture({bytes}) {
    const createURL = URL.createObjectURL.bind(URL);
    const revokeURL = URL.revokeObjectURL.bind(URL);
    const state = {
      mode: 'ready', pending: [], downloads: [], settled: 0,
      liveURLs: new Set(), createdURLs: [], revokedURLs: [], auth: null,
    };
    URL.createObjectURL = blob => {
      const url = createURL(blob);
      state.liveURLs.add(url);
      state.createdURLs.push(url);
      return url;
    };
    URL.revokeObjectURL = url => {
      state.liveURLs.delete(url);
      state.revokedURLs.push(url);
      revokeURL(url);
    };
    state.download = async path => {
      state.downloads.push(path);
      try {
        if (state.mode === 'failed') throw Error('Storage download failed for this synthetic file.');
        if (state.mode === 'deferred') await new Promise(resolve => state.pending.push({path, resolve}));
        if (!bytes[path]) throw Error(`Unexpected storage path: ${path}`);
        return new Blob([new Uint8Array(bytes[path])], {type: path.endsWith('.png') ? 'image/png' : 'application/pdf'});
      } finally { state.settled++; }
    };
    state.release = index => {
      const entry = state.pending[index];
      if (entry) { entry.resolve(); entry.released = true; }
    };
    window.__previewFixture = state;
}
