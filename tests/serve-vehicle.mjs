// Loopback-only preview. All data adapters use synthetic SDK boundaries.
// CSP blocks external connections, scripts, image requests and form submissions.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildVehicleSite} from '../scripts/build-vehicle-pages.mjs';
import {vehicleA,vehicleB,vehicleSold,initializeVehicle,vehicleSDK,syntheticConfig,salesperson,photoSVG} from './fixtures/vehicle-pages.mjs';
const repo=fileURLToPath(new URL('../',import.meta.url));
const root=resolve(process.env.E2_VEHICLE_SITE||resolve(repo,'test-results/vehicle-site'));
const sample=process.env.E2_VEHICLE_SAMPLE?JSON.parse(await readFile(process.env.E2_VEHICLE_SAMPLE,'utf8')):{kind:'synthetic-test',fetchedAt:new Date().toISOString(),vehicles:[vehicleA,vehicleB,vehicleSold],publicImageOrigin:'https://synthetic-vehicle.supabase.co',publicPhotos:[vehicleA,vehicleB,vehicleSold].map(car=>({vehicleId:car.id,photoId:car.id,source:'drive'}))};
await buildVehicleSite(sample,root);
const port=Number(process.env.E2_VEHICLE_PORT||4196),mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.txt':'text/plain'};
const server=createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://127.0.0.1:'+port),pathname=decodeURIComponent(url.pathname),path=resolve(root,'.'+(pathname.endsWith('/')?pathname+'index.html':pathname));
  if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405).end('Read-only preview');return;}
  if(!path.startsWith(root+sep)||path.slice(root.length).split(sep).some(s=>s.startsWith('.'))){res.writeHead(403).end();return;}
  let content,type=mime[extname(path)]||'application/octet-stream';
  if(pathname==='/test-sdk.mjs')content=vehicleSDK;
  else if(pathname==='/e2-config.js')content=syntheticConfig;
  else if(/^\/test-photo-[123]\.svg$/.test(pathname))content=photoSVG(Number(pathname.match(/\d/)[0]));
  else if(pathname==='/test-contacts.json')content=JSON.stringify([salesperson]);
  else {
   content=await readFile(path);
   if(/\.(?:js|mjs)$/.test(pathname))content=content.toString().replaceAll('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.4/+esm','/test-sdk.mjs');
   if(extname(path)==='.html'){
    const init=`<script>if(!window.__vehicleFixture)(${initializeVehicle.toString()})(${JSON.stringify({vehicles:sample.vehicles}).replace(/</g,'\\u003c')});const realFetch=window.fetch.bind(window);window.fetch=(input,options)=>{const url=new URL(typeof input==='string'?input:input.url,location.href);if(url.hostname==='synthetic-vehicle.supabase.co'&&url.pathname==='/rest/v1/staff_profiles')return realFetch('/test-contacts.json');return realFetch(input,options)};</script>`;
    content=content.toString().replace('<head>','<head>'+init).replace('<body id="top">','<body id="top"><div style="padding:10px 20px;background:#fff0c9;font:14px Arial;color:#332900">LOCAL SEO TEST · saved public sample / synthetic SDK · placeholder photos · no account or inventory writes</div>');
   }
  }
  res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://synthetic-vehicle.supabase.co; connect-src 'self'; font-src 'self'; form-action 'none'; object-src 'none'; base-uri 'self'"});res.end(req.method==='HEAD'?undefined:content);
 }catch{res.writeHead(404).end('Not found in the local sample');}
});
server.listen(port,'127.0.0.1',()=>console.log('Vehicle test preview: http://127.0.0.1:'+port));
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>server.close(()=>process.exit(0)));
