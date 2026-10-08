// Tiny same-origin static server for offline browser tests. It never proxies a
// request to the production site or customer storage.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve, extname, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {browserFixture, documentDataMock, intakeDataMock, initializePreviewFixture} from './fixtures/preview-fixtures.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const port = Number(process.env.PLAYWRIGHT_PORT || 4173);
const mockData = process.env.E2_PREVIEW_TEST_FIXTURES === '1';
const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.pdf': 'application/pdf',
  '.wasm': 'application/wasm', '.bcmap': 'application/octet-stream',
};
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, `http://127.0.0.1:${port}`).pathname);
    const path = resolve(root, `.${pathname === '/' ? '/documents.html' : pathname}`);
    const relative = path.slice(root.length);
    if (!path.startsWith(root) || relative.split(sep).some(part => part.startsWith('.'))) {
      response.writeHead(403).end('Forbidden');
      return;
    }
    let content;
    if (mockData && pathname === '/document-data.js') {
      content = documentDataMock(false).replace('export const staffView = false;', "export const staffView = new URLSearchParams(location.search).get('staff') === '1';");
    } else if (mockData && pathname === '/intake-staff-data.js') {
      content = intakeDataMock();
    } else {
      content = await readFile(path);
      if (mockData && ['/documents.html', '/intake-workspace.html'].includes(pathname)) {
        content = content.toString().replace('<head>', `<head><script>(${initializePreviewFixture.toString()})(${JSON.stringify(browserFixture)});</script>`);
      }
    }
    response.writeHead(200, {'Content-Type': mime[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-store'});
    response.end(content);
  } catch {
    if (!response.headersSent) response.writeHead(404);
    response.end('Not found');
  }
});
server.listen(port, '127.0.0.1', () => process.stdout.write(`Preview tests: http://127.0.0.1:${port}\n`));
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close(() => process.exit(0)));
