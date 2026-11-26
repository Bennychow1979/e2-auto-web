import {readFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {dirname,resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {senderSettings,deliverWithClient,withGatewayClient} from './gateway-sender-core.mjs';

// The lightweight bundle is pinned to the installed, tested release. Fail closed
// on an OpenClaw upgrade; never silently import the full plugin/agent runtime.
const supportedVersion='2026.10.9';
const clientBundle='client-DZgDBpiJ.mjs';
try{
 let input='';
 for await(const chunk of process.stdin){input+=chunk;if(Buffer.byteLength(input)>8192)throw Error('Invalid input')}
 const request=JSON.parse(input);input='';
 const cfg=JSON.parse(await readFile(join(homedir(),process.argv.includes('--public')?'.config/e2-otp-service/worker.json':'.config/e2-otp-pilot/worker.json'),'utf8'));
 if(process.argv.includes('--public')&&cfg.mode!=='public')throw Error('Invalid mode');
 const claw=JSON.parse(await readFile(join(homedir(),'.openclaw/openclaw.json'),'utf8'));
 const settings=senderSettings(claw,cfg);
 const root=resolve(dirname(process.execPath),'../lib/node_modules/openclaw');
 const pkg=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
 if(pkg.version!==supportedVersion)throw Error('Unsupported gateway version');
 const {t:Client}=await import(pathToFileURL(join(root,'dist',clientBundle)).href);
 const result=await withGatewayClient(Client,settings,c=>deliverWithClient(c,request,cfg));
 process.stdout.write(JSON.stringify(result)+'\n');
}catch{
 // Never print exceptions from dependencies, config, sender or broker payloads.
 process.stderr.write('OTP gateway operation unavailable\n');process.exitCode=1;
}
