// Local, synthetic-only design preview. This server never connects to Supabase,
// Notion or Drive; its auth/data stub is served only on this loopback preview.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const root=new URL('../',import.meta.url);
const fixture={asOf:'2026-11-15T08:30:00Z',today:'2026-11-15',month:'2026-11',errors:[],
  members:{total:128,month:9},loans:{active:18,groups:[4,3,7,4],needsInformation:{loan:1,intake:2}},commissions:{pending:2},
  fleet:{source:'MASTERLIST',sheet:'NOV · SYNTHETIC',sourceModifiedAt:'2026-11-15T08:00:00Z',stock:72,delivered:12,pending:5,ages:[22,18,17,13],missingDates:2}};
const stub=`export const configured=true;export const check=r=>{if(r.error)throw r.error;return r.data};export const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));export const db={rpc:async()=>({data:true}),functions:{invoke:async()=>({data:${JSON.stringify(fixture)}})},auth:{onAuthStateChange:f=>queueMicrotask(()=>f('INITIAL_SESSION',{user:{id:'synthetic'}})),signOut:async()=>({data:true})}};`;
const files=new Map([['/rental-navigation.mjs','application/javascript'],['/rental-navigation.css','text/css'],['/dashboard.css','text/css'],['/dashboard.js','application/javascript'],['/dashboard-view.mjs','application/javascript'],['/assets/e2-logo.png','image/png']]);
export async function startDashboardPreview({port=0}={}) {
const server=createServer(async(req,res)=>{
  const path=new URL(req.url,'http://127.0.0.1').pathname;
  res.setHeader('Cache-Control','no-store');
  try {
    if(path==='/e2-data.js'){res.setHeader('Content-Type','application/javascript');res.end(stub);return}
    if(path==='/e2-config.js'){res.setHeader('Content-Type','application/javascript');res.end('window.E2_CONFIG={};');return}
    if(path==='/'||path==='/dashboard.html'){
      res.setHeader('Content-Type','text/html; charset=utf-8');
      res.end((await readFile(new URL('dashboard.html',root),'utf8')).replace('SUPER ADMIN</span>','示例数据 · DEMO</span>').replace('会员、全车队库存、贷款和交车，一页查看。','设计预览 · 全部为示例数据，不连接正式系统。'));return;
    }
    if(!files.has(path)){res.writeHead(404);res.end('Preview only');return}
    res.setHeader('Content-Type',files.get(path));res.end(await readFile(new URL(path.slice(1),root)));
  }catch{res.writeHead(500);res.end('Preview unavailable')}
});
await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));
return {url:'http://127.0.0.1:'+server.address().port,close:()=>new Promise(resolve=>server.close(resolve))};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const preview=await startDashboardPreview({port:4202});console.log('Synthetic dashboard preview: '+preview.url+'/');
}
