// Explicit local build entry point. It never fetches or deploys automatically.
import {readFile} from 'node:fs/promises';
import {buildVehicleSite} from './build-vehicle-pages.mjs';
const [input,output,mode]=process.argv.slice(2);
if(!input||!output||process.argv.length>5||(mode&&mode!=='--release'))throw Error('Usage: node scripts/build-car-pages.mjs <fresh-public-snapshot.json> <separate-output-folder> [--release]');
const result=await buildVehicleSite(JSON.parse(await readFile(input,'utf8')),output,{release:mode==='--release'});
console.log(JSON.stringify({vehicles:result.vehicles.length,pages:result.files.length,kind:result.kind,releaseArtifact:result.releaseArtifact,imageGatewayVerified:result.imageGatewayVerified,deployed:false}));
