import {writeFile} from 'node:fs/promises';
import {readPriorSlugs} from './fetch-vehicle-build-input.mjs';
const [output]=process.argv.slice(2);if(!output||process.argv.length!==3)throw Error('Specify a private recovery JSON path outside the public artifact.');
// Preserve mappings separately; restoring old site bytes must not silently rename future links.
const slugs=await readPriorSlugs();await writeFile(output,JSON.stringify(slugs,null,2)+'\n');
console.log(JSON.stringify({savedSlugs:Object.keys(slugs).length,publicWrites:false}));
