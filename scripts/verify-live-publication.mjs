import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
export async function verifyLivePublication(output,{request=fetch,attempts=12,sleep=ms=>new Promise(r=>setTimeout(r,ms))}={}){
 const paths=['vehicle-pages-manifest.json','stock.txt','sitemap.xml'];
 const expected=await Promise.all(paths.map(path=>readFile(join(output,path),'utf8')));
 const builtAt=JSON.parse(expected[0]).builtAt;
 for(let attempt=0;attempt<attempts;attempt++){
  try{
   const actual=await Promise.all(paths.map(async path=>{
    const r=await request('https://e2auto.my/'+path+'?release='+encodeURIComponent(builtAt)+'&attempt='+attempt,
     {credentials:'omit',cache:'no-store',redirect:'error',headers:{'Cache-Control':'no-cache'},signal:AbortSignal.timeout(15000)});
    if(!r.ok)throw Error('Publication not visible');return r.text();
   }));
   if(actual.every((text,i)=>text===expected[i]))return {published:true,builtAt};
  }catch{/* CDN propagation and transient errors do not acknowledge a deployment. */}
  if(attempt+1<attempts)await sleep(10000);
 }
 throw Error('Live publication does not match the complete staged artifact; inspect deployment and cache before claiming success.');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 if(process.argv.length!==3)throw Error('Usage: node scripts/verify-live-publication.mjs <artifact-directory>');
 console.log(JSON.stringify(await verifyLivePublication(process.argv[2])));
}
