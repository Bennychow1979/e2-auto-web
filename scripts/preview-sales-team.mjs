// Read-only local preview. No deployment, proxy, fixtures or write endpoints.
import {createServer} from 'node:http';
import {readFile, stat} from 'node:fs/promises';
import {resolve, extname, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg','.svg':'image/svg+xml','.json':'application/json'};
const server = createServer(async (req, res) => {
  try {
    if (!['GET','HEAD'].includes(req.method)) {res.writeHead(405).end(); return;}
    let pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (pathname === '/') pathname = '/sales-team.html';
    if (pathname.endsWith('/')) pathname += 'index.html';
    const file = resolve(root, '.' + pathname), relative = file.slice(root.length);
    if (!file.startsWith(root) || relative.split(sep).some(p => p.startsWith('.')) || /^(?:scripts|tests|supabase|node_modules|data)(?:\/|$)/.test(pathname.slice(1)) || !types[extname(file)]) {res.writeHead(404).end(); return;}
    if (!(await stat(file)).isFile()) throw Error();
    res.writeHead(200, {'Content-Type':types[extname(file)],'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
    res.end(req.method === 'HEAD' ? undefined : await readFile(file));
  } catch {res.writeHead(404).end('Not found');}
});
server.listen(0, '127.0.0.1', () => console.log('Preview: http://127.0.0.1:' + server.address().port + '/sales-team.html'));
