import {cp, mkdir, readFile, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root = new URL('../', import.meta.url);
const source = new URL('node_modules/pdfjs-dist/', root);
const target = new URL('vendor/pdfjs/', root);
await mkdir(target, {recursive: true});
for (const name of ['pdf.mjs', 'pdf.worker.mjs']) {
  await cp(new URL('legacy/build/' + name, source), new URL(name, target));
}
for (const name of ['cmaps', 'standard_fonts', 'iccs', 'wasm', 'LICENSE']) {
  await cp(new URL(name, source), new URL(name, target), {recursive: true});
}
const {version} = JSON.parse(await readFile(new URL('package.json', source), 'utf8'));
await writeFile(new URL('VERSION', target), version + '\n');
console.log(`Built local PDF.js ${version} assets in ${fileURLToPath(target)}`);
