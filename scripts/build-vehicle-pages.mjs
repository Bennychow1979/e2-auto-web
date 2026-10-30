import {readFile,writeFile,mkdir,readdir,cp,unlink,mkdtemp,rename,lstat} from 'node:fs/promises';
import {resolve,join,sep,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {LANGUAGES,languageTags,escapeHTML,t} from '../i18n.mjs';
import {localizedPage} from './build-languages.mjs';
import {vehicleMetadata,vehicleStructuredData,validVehicleId,canonicalVehicleURL} from '../vehicle-seo.mjs';
import {vehiclePath} from '../vehicle-routes.mjs';
import {vehicleCopy} from '../vehicle-page-copy.mjs';
import {descriptionFor} from '../vehicle-translations.mjs';
import {enquiryURL,withVehicleLink} from '../referral.js';
import {renderSitemap} from './build-sitemap.mjs';
import {renderStock} from './build-stock.mjs';
import {publicVehicleImageURL,probePublicImageGateway} from '../vehicle-public-image.mjs';
import {stockCopy,stockRequestHTML,stockRequestText} from '../vehicle-stock-display.mjs';
export const PUBLIC_FIELDS=['id','publication','brand','model','variant','year','plate','price','mileage','mileage_confirmed','engine_litres','transmission','fuel_type','body_type','stock_status','description','updated_at'];
const root=fileURLToPath(new URL('../',import.meta.url)),json=value=>JSON.stringify(value).replace(/</g,'\\u003c'),money=value=>'RM'+Number(value).toLocaleString('en-MY',{maximumFractionDigits:0});
export function publicRows(snapshot,{now=Date.now(),maxAge=30*60*1000}={}){
 if(!Array.isArray(snapshot?.vehicles)||!Number.isFinite(Date.parse(snapshot.fetchedAt))||now-Date.parse(snapshot.fetchedAt)>maxAge||Date.parse(snapshot.fetchedAt)>now+60000)throw Error('A complete, fresh public snapshot is required before building.');
 const seen=new Set();return snapshot.vehicles.filter(v=>v?.publication==='published').map(row=>{
  if(!validVehicleId(row.id)||seen.has(row.id.toLowerCase()))throw Error('Invalid or duplicate public vehicle ID.');seen.add(row.id.toLowerCase());
  if(!row.brand||!row.model||!Number.isInteger(row.year)||row.year<1900||row.year>2100||row.price==null||row.price===''||!Number.isFinite(Number(row.price))||Number(row.price)<0||!['Available','Reserved','Sold'].includes(row.stock_status))throw Error('Incomplete public vehicle facts.');
  const car=Object.fromEntries(PUBLIC_FIELDS.filter(k=>Object.hasOwn(row,k)).map(k=>[k,row[k]]));car.id=car.id.toLowerCase();
  for(const key of ['brand','model','variant','plate','transmission','fuel_type','body_type','description']){if(car[key]!=null&&typeof car[key]!=='string')throw Error('Invalid public text field.');}
  return car;
 });
}
export function createSlugMap(rows,previous={}){
 const slugs={...previous},used=new Set();
 for(const [id,slug] of Object.entries(slugs)){if(!validVehicleId(id)||!/^[-a-z0-9]{1,120}$/.test(slug)||slug.startsWith('-')||slug.endsWith('-')||used.has(slug))throw Error('Invalid or colliding saved slug mapping.');used.add(slug);}
 for(const car of [...rows].sort((a,b)=>a.id.localeCompare(b.id))){
  if(slugs[car.id])continue;
  const plate=String(car.plate||'').replace(/[^a-z0-9]/gi,'').slice(-4);
  const base=[car.year,car.brand,car.model,car.variant,plate||car.id.slice(0,8)].filter(Boolean).join('-').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,80).replace(/-$/,'')||'vehicle';
  let slug=base;if(used.has(slug))slug=base+'-'+car.id.replace(/-/g,'');
  if(used.has(slug))throw Error('Vehicle slug collision.');used.add(slug);slugs[car.id]=slug;
 }
 return slugs;
}
function routeScript(slugs){return '<script id="vehicleRoutes" type="application/json">'+json(slugs)+'</script>';}
async function assertNoLinks(directory){for(const entry of await readdir(directory,{withFileTypes:true})){if(entry.isSymbolicLink())throw Error('Generated output must not contain symbolic links.');if(entry.isDirectory())await assertNoLinks(join(directory,entry.name));}}
// Explicit small sample acquisition only. No staff session, photo metadata or URLs.
export async function fetchPublicSample(config,ids,request=fetch){
 if(!Array.isArray(ids)||ids.length<1||ids.length>10||ids.some(id=>!validVehicleId(id)))throw Error('Specify one to ten vehicle IDs.');
 if(!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(config?.supabaseUrl||'')||!/^sb_publishable_[A-Za-z0-9_-]+$/.test(config?.publishableKey||''))throw Error('Anonymous public inventory configuration required.');
 const vehicles=[];for(const id of ids){const url=new URL(config.supabaseUrl+'/rest/v1/vehicles');url.search=new URLSearchParams({select:PUBLIC_FIELDS.join(','),publication:'eq.published',id:'eq.'+id});const r=await request(url,{headers:{apikey:config.publishableKey},credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('Public inventory unavailable ('+r.status+'); keep the previous build.');const rows=await r.json();if(!Array.isArray(rows)||rows.some(row=>row.id.toLowerCase()!==id.toLowerCase()||row.publication!=='published'))throw Error('Unexpected public inventory result.');vehicles.push(...rows);}
 return {kind:'public-sample',fetchedAt:new Date().toISOString(),vehicles};
}
// Draft acquisition path for a future approved rebuild. Not called by the CLI.
// Two complete reads must agree; count changes, truncation and zero rows fail closed.
export async function fetchPublicInventory(config,request=fetch){
 if(!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(config?.supabaseUrl||'')||!/^sb_publishable_[A-Za-z0-9_-]+$/.test(config?.publishableKey||''))throw Error('Anonymous public inventory configuration required.');
 async function readComplete(){
  const vehicles=[];let expected;
  for(let offset=0;offset<20000;offset+=200){
   const url=new URL(config.supabaseUrl+'/rest/v1/vehicles');url.search=new URLSearchParams({select:PUBLIC_FIELDS.join(','),publication:'eq.published',order:'id.asc',limit:'200',offset:String(offset)});
   const response=await request(url,{headers:{apikey:config.publishableKey,Prefer:'count=exact'},credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(20000)});
   if(!response.ok)throw Error('Public inventory read failed; preserve the previous artifact.');
   const count=Number(/\/(\d+)$/.exec(response.headers.get('content-range')||'')?.[1]);
   if(!Number.isInteger(count)||count<1||count>20000||(expected!==undefined&&count!==expected))throw Error('Inventory count is empty, unavailable or changed.');expected=count;
   const rows=await response.json();if(!Array.isArray(rows)||rows.some(row=>row.publication!=='published')||rows.length!==Math.min(200,expected-offset))throw Error('Inventory response is incomplete.');vehicles.push(...rows);
   if(vehicles.length===expected){const envelope={kind:'public-complete',complete:true,expectedCount:expected,fetchedAt:new Date().toISOString(),vehicles};publicRows(envelope);return envelope;}
  }
  throw Error('Inventory pagination did not finish.');
 }
 const first=await readComplete(),second=await readComplete();
 if(JSON.stringify(first.vehicles)!==JSON.stringify(second.vehicles))throw Error('Inventory changed during snapshot acquisition; rebuild later.');return second;
}
function content(html,id,value){const re=new RegExp('(<(\\w+)\\b[^>]*\\bid="'+id+'"[^>]*>)[\\s\\S]*?(</\\2>)');if(!re.test(html))throw Error('Missing template field: '+id);return html.replace(re,(_,open,tag,close)=>open+value+close);}
function rootLinks(html,lang){const base='https://e2auto.my/'+(lang==='en'?'':lang+'/')+'car.html';return html.replace(/\b(href|src)="([^"#][^"]*)"/g,(whole,attr,value)=>{if(/^(?:[a-z]+:|\/)/i.test(value))return whole;const u=new URL(value,base);return attr+'="'+u.pathname+u.search+u.hash+'"';});}
export function renderVehiclePage(template,car,lang,fetchedAt,slugs=createSlugMap([car]),{imageOrigin,imageAvailable=false}={}){
 const meta=vehicleMetadata(car,{lang,staticPages:true,slugs});if(!meta)throw Error('Only published vehicles can produce a static page.');
 const imageURL=imageAvailable?publicVehicleImageURL(imageOrigin,car.id):null;
 let html=lang==='en'?template:localizedPage(template,'car.html',lang);html=rootLinks(html,lang).replace(/<script id="vehicleSearchPolicy">[\s\S]*?<\/script>/,'');
 html=html.replace('<html ',()=>'<html data-stock-status="'+car.stock_status+'" ');
 html=html.replace('<html ',`<html data-vehicle-pages="static-v1" data-vehicle-snapshot="${escapeHTML(fetchedAt)}" data-vehicle-id="${car.id}" `);
 if(imageURL)html=html.replace('<html ',()=>'<html data-public-image-origin="'+escapeHTML(imageOrigin)+'" ');
 html=html.replace(/<title>[^<]*<\/title>/,()=>'<title>'+escapeHTML(meta.title)+'</title>').replace(/(<meta name="description" content=")[^"]*"/,(_,prefix)=>prefix+escapeHTML(meta.description)+'"');
 const links=LANGUAGES.concat('x-default').map(l=>'<link id="seo-language-'+l+'" rel="alternate" hreflang="'+(languageTags[l]||l)+'" href="'+canonicalVehicleURL(car.id,l==='x-default'?'en':l,{staticPages:true,slugs})+'">').join('');
 const tags=routeScript(slugs)+'<link rel="canonical" href="'+meta.canonical+'">'+links+Object.entries({'og:title':meta.title,'og:description':meta.description,'og:url':meta.canonical,'og:type':'website',...(imageURL?{'og:image':imageURL}:{})}).map(([key,value])=>'<meta property="'+key+'" content="'+escapeHTML(value)+'">').join('')+'<script id="vehicleStructuredData" type="application/ld+json">'+json(vehicleStructuredData(car,{lang,slugs,imageURL}))+'</script>';
 html=html.replace('</head>',()=>tags+'<style>#inventoryNotice{max-width:1120px;margin:16px auto;padding:12px 20px;color:#625125;background:#f2ead7;font-size:14px;line-height:1.5}html[data-vehicle-snapshot]:not([data-inventory-verified]) #finance,html[data-vehicle-snapshot]:not([data-inventory-verified]) [href="#finance"]{display:none}[hidden]{display:none!important}</style></head>');
 const values={make:car.brand,model:car.model,heroLine:car.variant||'',heroEyebrow:[car.year,t(car.body_type,{},lang),t(car.stock_status,{},lang)].filter(Boolean).join(' · '),heroPrice:money(car.price),heroPlate:t('PLATE · {plate}',{plate:car.plate||''},lang),story:descriptionFor(car.description||'',lang)||t('See the actual vehicle. Ask the questions that matter to you.',{},lang),publicationNote:t(car.stock_status,{},lang),dockModel:car.brand+' '+car.model,dockPrice:money(car.price),photoCount:vehicleCopy('photosLoading',lang)};
 for(const [id,value] of Object.entries(values))html=content(html,id,escapeHTML(value));
 html=html.replace('<h1>',()=>'<h1><span class="srOnly" id="vehicleHeadingYear">'+car.year+' </span>').replace('</h1>',()=>'<span class="srOnly" id="vehicleHeadingVariant"> '+escapeHTML(car.variant||'')+'</span></h1>');
 html=html.replace('id="heroImage" alt=""',()=> 'id="heroImage" alt="'+escapeHTML([car.year,car.brand,car.model,car.variant].filter(Boolean).join(' ')+' — '+t('photo {count}',{count:1},lang))+'"');
 if(imageURL)html=html.replace('id="heroImage"',()=> 'id="heroImage" data-public-image="1" src="'+escapeHTML(imageURL)+'"');
 const facts=[['Car plate',car.plate],['Year',car.year],['Brand',car.brand],['Model',car.model],['Variant / SPEC',car.variant],['Engine size',car.engine_litres==null?null:Number(car.engine_litres).toFixed(1)+' L'],['Transmission',t(car.transmission,{},lang)],['Fuel type',t(car.fuel_type,{},lang)],['Mileage',car.mileage==null?t('Pending confirmation',{},lang):Number(car.mileage).toLocaleString('en-MY')+' km'+(car.mileage_confirmed?'':t(' · pending confirmation',{},lang))]];
 html=content(html,'specGrid',facts.filter(([,v])=>v!=null&&String(v).trim()).map(([label,value])=>'<div><dt>'+escapeHTML(t(label,{},lang))+'</dt><dd>'+escapeHTML(value)+'</dd></div>').join(''));
 html=html.replace('<main id="carMain" hidden>','<main id="carMain">').replace('<aside id="carDock" hidden','<aside id="carDock"').replace('id="carState"','id="carState" hidden').replace('id="openPhoto"','id="openPhoto" hidden');
 if(imageURL)html=html.replace('id="openPhoto" hidden','id="openPhoto"');
 html=html.replace(/<button\b([^>]*)>/g,(_,attrs)=>'<button'+attrs+' disabled data-requires-live>');
 html=html.replace('<main id="carMain">','<p id="inventoryNotice" role="status">'+escapeHTML(vehicleCopy('snapshot',lang,{date:fetchedAt}))+'</p><noscript><p class="wrap">'+escapeHTML(vehicleCopy('noJS',lang))+'</p></noscript><main id="carMain">');
 html=html.replace('<main id="carMain">',()=>'<main id="carMain">'+stockRequestHTML(car,lang,meta.canonical));
 const enquiry=enquiryURL(null,withVehicleLink(car.stock_status==='Sold'?stockRequestText(car,lang):t('Please confirm availability, price and vehicle details.',{},lang)+' '+[car.year,car.brand,car.model,car.variant].filter(Boolean).join(' '),meta.canonical));
 html=html.replace(/(<a\b[^>]*\bid="(?:enquire|tradeLink|loanLink|contactWhatsApp)"[^>]*)(>)/g,(_,tag,end)=>tag.replace(/\s+href="[^"]*"/g,'')+' href="'+escapeHTML(enquiry)+'"'+end);
 html=html.replace(/(<a\b[^>]*data-language="(en|ms|zh)"[^>]*>)/g,(_,tag,l)=>tag.replace(/href="[^"]*"/,'href="'+vehiclePath(car.id,l,slugs)+'"'));
 if(car.stock_status==='Sold'){
  html=content(html,'enquire',escapeHTML(stockCopy('action',lang)));
  html=html.replace(/(<span class="sampleLabel">)[^<]*<\/span>/,(_,open)=>open+escapeHTML(stockCopy('price',lang))+'</span>');
  html=html.replace('</head>','<style>html[data-stock-status="Sold"] [data-book],html[data-stock-status="Sold"] #finance,html[data-stock-status="Sold"] [href="#finance"]{display:none!important}</style></head>');
 }
 return html;
}
export async function buildVehicleSite(snapshot,output,{now=Date.now(),includeSold=true,release=false,imageRequest=fetch}={}){
 const rows=publicRows(snapshot,{now}),out=resolve(output),parent=dirname(out);
 if(out===resolve(root)||resolve(root).startsWith(out+sep))throw Error('Use a separate generated output folder.');
 if(!rows.length)throw Error('Empty public inventory requires separate review; existing output is unchanged.');
 if(snapshot.kind==='public-complete'&&(!snapshot.complete||snapshot.expectedCount!==rows.length))throw Error('Incomplete inventory snapshot.');
 const images=new Map((snapshot.publicPhotos||[]).map(row=>[row.vehicleId,row]));
 if(snapshot.publicPhotos!==undefined&&(!Array.isArray(snapshot.publicPhotos)||snapshot.publicPhotos.length!==images.size||images.size!==rows.length||rows.some(row=>!images.has(row.id))||[...images.values()].some(row=>row.photoId===null?row.source!==null:!validVehicleId(row.photoId)||!['drive','upload'].includes(row.source))))throw Error('Invalid or incomplete public photo coverage.');
 const imageCars=rows.filter(row=>images.get(row.id)?.photoId);
 if(imageCars.length)publicVehicleImageURL(snapshot.publicImageOrigin,imageCars[0].id);
 let gatewayVerified=false;
 if(release){
  if(snapshot.kind!=='public-complete'||images.size!==rows.length)throw Error('Release requires a complete public snapshot and photo coverage.');
  for(const car of imageCars){
   try{if(!await probePublicImageGateway(snapshot.publicImageOrigin,car.id,imageRequest))throw Error('Invalid image response');}
   catch(error){throw Error('Stable public image gateway is not active for vehicle '+car.id+'; no release artifact written.',{cause:error});}
  }
  gatewayVerified=true;
 }
 let previous={files:[],slugs:{}},exists=false;
 try{const stat=await lstat(out);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('Output must be a generated directory, never a link.');exists=true;previous=JSON.parse(await readFile(join(out,'vehicle-pages-manifest.json'),'utf8'));if(previous.version!==1)throw Error('Unsafe previous manifest.');}catch(error){if(error.code!=='ENOENT'||exists)throw error;}
 for(const file of previous.files||[])if(!/^(?:(?:ms|zh)\/)?cars\/(?:[0-9a-f-]{36}\.html|[a-z0-9]+(?:-[a-z0-9]+)*\/index\.html)$/.test(file)||!resolve(out,file).startsWith(out+sep))throw Error('Unsafe previous manifest path.');
 const seed=JSON.parse(await readFile(join(root,'data/car-slugs.json'),'utf8'));
 const registry={...seed};
 for(const saved of [snapshot.priorSlugs||{},previous.slugs||{}]){createSlugMap([],saved);for(const [id,slug] of Object.entries(saved)){if(registry[id]&&registry[id]!==slug)throw Error('Saved slug identity cannot change.');registry[id]=slug;}}
 const slugs=createSlugMap(rows,registry),publicSlugs=Object.fromEntries(rows.map(car=>[car.id,slugs[car.id]]));
 const stock=renderStock(rows,{slugs,fetchedAt:snapshot.fetchedAt,builtAt:new Date(now).toISOString(),complete:snapshot.kind==='public-complete'&&snapshot.complete===true&&snapshot.expectedCount===rows.length});
 const template=await readFile(join(root,'car.html'),'utf8'),pages=[];
 for(const car of rows)for(const lang of LANGUAGES)pages.push({file:vehiclePath(car.id,lang,slugs).slice(1)+'index.html',html:renderVehiclePage(template,car,lang,snapshot.fetchedAt,publicSlugs,{imageOrigin:snapshot.publicImageOrigin,imageAvailable:!!images.get(car.id)?.photoId})});
 const files=pages.map(p=>p.file),manifest={version:1,kind:snapshot.kind||'local-snapshot',fetchedAt:snapshot.fetchedAt,builtAt:new Date(now).toISOString(),includeSoldInSitemap:includeSold,slugs,files,imageVehicles:imageCars.length,imageGatewayVerified:gatewayVerified,imageGatewayVersion:gatewayVerified?'v2':null,imageGatewayCheck:gatewayVerified?'HEAD':null,releaseArtifact:release,vehicles:rows.map(v=>({id:v.id,updated_at:v.updated_at}))};
 // Construct and validate a separate artifact before replacing the previous one.
 // Only the explicit generated output can be renamed; backups are retained.
 await mkdir(parent,{recursive:true});const stage=await mkdtemp(join(parent,'.vehicle-build-'));
 if(dirname(stage)!==parent||!stage.startsWith(parent+sep))throw Error('Invalid staging path.');
 if(exists){await assertNoLinks(out);await cp(out,stage,{recursive:true});}
 for(const entry of await readdir(root,{withFileTypes:true})){if(entry.isFile()&&((/\.(?:html|css|js|mjs|txt)$/.test(entry.name)&&!entry.name.startsWith('.'))||['CNAME','.nojekyll'].includes(entry.name)))await cp(join(root,entry.name),join(stage,entry.name));}
 await cp(join(root,'assets'),join(stage,'assets'),{recursive:true});
 await cp(join(root,'privacy'),join(stage,'privacy'),{recursive:true});
 // Existing staff catalogue aid fetches this public asset at runtime.
 await cp(join(root,'verified-model-years.json'),join(stage,'verified-model-years.json'));
 try{await cp(join(root,'vendor'),join(stage,'vendor'),{recursive:true});}catch(error){if(error.code!=='ENOENT')throw error;}
 for(const lang of LANGUAGES)for(const file of ['index.html','showroom.html','car.html','booking.html','sales-team.html']){
  let html=await readFile(join(root,file),'utf8');if(lang!=='en')html=localizedPage(html,file,lang);html=html.replace('<html ','<html data-vehicle-pages="static-v1" ').replace('<head>',()=>'<head>'+routeScript(publicSlugs));
  const destination=join(stage,lang==='en'?'':lang,file);await mkdir(dirname(destination),{recursive:true});await writeFile(destination,html);
 }
 // The number plate page needs no vehicle routes; it only gets its language copies.
 for(const lang of LANGUAGES)if(lang!=='en')await writeFile(join(stage,lang,'plates.html'),localizedPage(await readFile(join(root,'plates.html'),'utf8'),'plates.html',lang));
 for(const page of pages){const file=join(stage,page.file);await mkdir(dirname(file),{recursive:true});await writeFile(file,page.html);}
 for(const file of previous.files||[])if(!files.includes(file))await unlink(join(stage,file)).catch(e=>{if(e.code!=='ENOENT')throw e;});
 await writeFile(join(stage,'sitemap.xml'),renderSitemap(rows,{staticPages:true,slugs,includeSold}));
 await writeFile(join(stage,'stock.txt'),stock);
 await mkdir(join(stage,'data'),{recursive:true});await writeFile(join(stage,'data/car-slugs.json'),JSON.stringify(slugs,null,2)+'\n');
 await writeFile(join(stage,'vehicle-pages-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
 for(const page of pages){const html=await readFile(join(stage,page.file),'utf8');if(!html.includes('id="vehicleStructuredData"')||!html.includes('id="heroPrice">RM'))throw Error('Incomplete staged vehicle page.');}
 const backup=stage+'-previous';if(dirname(backup)!==parent)throw Error('Invalid backup path.');
 if(exists)await rename(out,backup);
 try{await rename(stage,out);}catch(error){if(exists)await rename(backup,out);throw error;}
 return manifest;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const args=process.argv.slice(2);if(args.length!==2)throw Error('Usage: node scripts/build-vehicle-pages.mjs <fresh-snapshot.json> <separate-output-folder>. No deployment is performed.');const result=await buildVehicleSite(JSON.parse(await readFile(args[0],'utf8')),args[1]);console.log(JSON.stringify({vehicles:result.vehicles.length,pages:result.files.length,output:resolve(args[1])}));}
