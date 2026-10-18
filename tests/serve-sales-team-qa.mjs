// Local fault injection only. This entire directory is excluded from the release artifact.
// No staff fixtures, auth emulation, writes, or production mutations.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml'};
createServer(async(req,res)=>{
 try{
  if(req.method!=='GET')throw Error();
  const path=new URL(req.url,'http://localhost').pathname;
  const mode=/^\/__qa\/(empty|error|reduced|broken|visibility)\.html$/.exec(path)?.[1];
  if(mode){
   const html=await readFile(resolve(root,'sales-team.html'),'utf8');
   const setup=`<base href="/"><script>
     const qaMode=${JSON.stringify(mode)}, originalFetch=window.fetch;
     let signs=0; window.fetch=async function(input,options){
       const url=String(input);
       if(url.includes('/rest/v1/staff_profiles')){
         if(qaMode==='empty')return new Response('[]',{status:200});
         if(qaMode==='error')return new Response('{}',{status:503});
       }
       if(url.includes('/storage/v1/object/sign/')){signs++;document.querySelector('#qaCounter').textContent='QA portrait signing requests: '+signs;}
       return originalFetch(input,options);
     };
     if(qaMode==='reduced'){
       const nativeMatch=window.matchMedia.bind(window);
       window.matchMedia=q=>q==='(prefers-reduced-motion: reduce)'?{matches:true,addEventListener(){},removeEventListener(){}}:nativeMatch(q);
     }
     if(qaMode==='broken'){
       const descriptor=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,'src');
       Object.defineProperty(HTMLImageElement.prototype,'src',{...descriptor,set(value){descriptor.set.call(this,String(value).includes('/storage/v1/object/sign/')?'/__qa/broken.webp':value);}});
     }
     if(qaMode==='visibility'){
       let qaHidden=false;
       Object.defineProperty(document,'hidden',{get(){return qaHidden;},configurable:true});
       addEventListener('DOMContentLoaded',()=>{
         const control=document.createElement('button');control.id='qaVisibility';control.textContent='QA: hide page';
         control.onclick=()=>{qaHidden=!qaHidden;control.textContent=qaHidden?'QA: show page':'QA: hide page';document.dispatchEvent(new Event('visibilitychange'));};
         document.body.prepend(control);
       });
     }
   </script>`;
   res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}).end(html.replace('<head>','<head>'+setup).replace('<main class="salesTeam">','<p id="qaCounter" role="status">LOCAL QA · '+mode+' · no production writes</p><main class="salesTeam">'));return;
  }
  if(path==='/__qa/broken.webp'){res.writeHead(200,{'Content-Type':'image/webp'}).end('deliberately invalid image');return;}
  const file=resolve(root,'.'+path);
  if(!file.startsWith(root)||!mime[extname(file)]||path.includes('..')||/^\/(?:supabase|tests|scripts|node_modules|\.)/.test(path))throw Error();
  res.writeHead(200,{'Content-Type':mime[extname(file)]+'; charset=utf-8','Cache-Control':'no-store'}).end(await readFile(file));
 }catch{res.writeHead(404).end('Not found');}
}).listen(0,'127.0.0.1',function(){console.log('QA http://127.0.0.1:'+this.address().port+'/__qa/reduced.html');});
