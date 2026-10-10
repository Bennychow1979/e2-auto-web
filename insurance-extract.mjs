import {fileType,MAX_BYTES} from './document-fields.js';
import {extractPolicyText} from './insurance-core.mjs';
const assets=new URL('./vendor/pdfjs/',import.meta.url);
export const MAX_PAGES=20,MAX_TEXT=200000;
function checkImageDimensions(buffer,mime){
  const b=new Uint8Array(buffer);let width=0,height=0;
  if(mime==='image/png'){
    if(b.length<33||String.fromCharCode(...b.slice(12,16))!=='IHDR')throw Error('Invalid PNG header.');
    const view=new DataView(buffer);width=view.getUint32(16);height=view.getUint32(20);
  }else{
    let pos=2;
    while(pos<b.length){
      if(b[pos++]!==255)break;while(b[pos]===255)pos++;const marker=b[pos++];
      if(marker===0xda||marker===0xd9)break;
      if(marker===1||marker>=0xd0&&marker<=0xd8)continue;
      if(pos+2>b.length)break;const length=(b[pos]<<8)|b[pos+1];if(length<2||pos+length>b.length)break;
      if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)&&length>=8){height=(b[pos+3]<<8)|b[pos+4];width=(b[pos+5]<<8)|b[pos+6];break;}
      pos+=length;
    }
  }
  if(!width||!height)throw Error('Invalid image dimensions.');
  if(width*height>25000000)throw Error('Image exceeds the 25 megapixel analysis limit.');
}
export async function analyzePolicy(file,{signal,timeoutMs=20000}={}){
  if(!file?.size||file.size>MAX_BYTES)throw Error('Choose a PDF, JPG or PNG up to 10 MB.');
  const controller=new AbortController();let loading,bitmap,timer;
  const cancel=()=>controller.abort();signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();
  const check=()=>{if(controller.signal.aborted)throw new DOMException('Policy analysis cancelled.','AbortError');};
  let rejectAbort;
  const aborted=new Promise((_,reject)=>{rejectAbort=()=>reject(new DOMException('Policy analysis cancelled or timed out.','AbortError'));controller.signal.addEventListener('abort',rejectAbort,{once:true});});
  timer=setTimeout(cancel,timeoutMs);
  try{return await Promise.race([(async()=>{
    check();const mime=await fileType(file);check();
    const buffer=await file.arrayBuffer();check();
    const digest=await crypto.subtle.digest('SHA-256',buffer);check();
    const sha256=[...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
    if(mime!=='application/pdf'){
      checkImageDimensions(buffer,mime);
      bitmap=await createImageBitmap(file);if(controller.signal.aborted)bitmap.close();check();
      if(bitmap.width*bitmap.height>25000000)throw Error('Image exceeds the 25 megapixel analysis limit.');
      return {mime,sha256,extraction:extractPolicyText([],'manual_image')};
    }
    const pdfjs=await import('./vendor/pdfjs/pdf.mjs?v=6.4.299');check();
    pdfjs.GlobalWorkerOptions.workerSrc=new URL('pdf.worker.mjs?v=6.4.299',assets).href;
    loading=pdfjs.getDocument({data:new Uint8Array(buffer),isEvalSupported:false,enableXfa:false,
      cMapUrl:new URL('cmaps/',assets).href,cMapPacked:true,standardFontDataUrl:new URL('standard_fonts/',assets).href,
      iccUrl:new URL('iccs/',assets).href,wasmUrl:new URL('wasm/',assets).href});
    loading.onPassword=()=>{void loading.destroy();};
    const pdf=await loading.promise;check();
    if(pdf.numPages>MAX_PAGES)throw Error('Policy PDFs are limited to 20 pages.');
    const pages=[];let length=0;
    for(let n=1;n<=pdf.numPages;n++){
      check();const page=await pdf.getPage(n);check();const text=await page.getTextContent();check();
      const lines=[];
      for(const item of text.items){
        if(!item.str)continue;length+=item.str.length;if(length>MAX_TEXT)throw Error('PDF text exceeds the local analysis limit.');
        const y=Math.round(item.transform[5]/2)*2;let line=lines.find(row=>row.y===y);
        if(!line){line={y,items:[]};lines.push(line);}line.items.push({x:item.transform[4],text:item.str});
      }
      pages.push({page:n,lines:lines.sort((a,b)=>b.y-a.y).map(row=>row.items.sort((a,b)=>a.x-b.x).map(i=>i.text).join(' '))});page.cleanup();
    }
    return {mime,sha256,extraction:extractPolicyText(pages,length?'text_pdf':'manual_scanned_pdf')};
  })(),aborted]);}
  finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);controller.signal.removeEventListener('abort',rejectAbort);if(loading)void loading.destroy().catch(()=>{});bitmap?.close();}
}
