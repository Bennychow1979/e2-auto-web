import {selectSheet} from './plan.mjs';
import {admitZip,admitSheet} from './xlsx-bounds.mjs';
const safe=message=>Object.assign(new Error(message),{importSafe:true});

// Keep ExcelJS's cell/date/formula semantics. Only trim unrelated ZIP parts;
// never rewrite the original Drive workbook or its cell XML.
export function createWorkbookLoader({ExcelJS,JSZip,SaxesParser}) {
  const limit=24*1024*1024;
  // 'cols' only carries widths/styles/hidden flags; import reads cell values only.
  const ignored=['cols','drawing','picture','tableParts','extLst','conditionalFormatting','dataValidations','sheetViews','pageMargins','pageSetup','headerFooter','printOptions','sheetProtection','autoFilter','rowBreaks','colBreaks'];
  const escape=value=>String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
  const element=(name,attributes)=>'<'+name+' '+Object.entries(attributes).map(([k,v])=>k+'="'+escape(v)+'"').join(' ')+'/>';
  function nodes(xml,name) {
    const result=[],parser=new SaxesParser({xmlns:false});
    parser.on('doctype',()=>{throw safe('MASTERLIST XML declarations are unsupported.')});
    parser.on('opentag',tag=>{if(tag.name===name)result.push(tag.attributes)});
    parser.write(xml).close();return result;
  }
  const load=async (bytes,when,measure=async(_stage,fn)=>fn())=>{
    const selected=await measure('xlsx_select',async()=>{
      const names=admitZip(bytes),zip=await JSZip.loadAsync(bytes),out=new JSZip();let total=0;
      // Reject Unicode/path aliases or duplicate names normalized by JSZip.
      const actual=Object.keys(zip.files);
      if(actual.length!==names.size||actual.some(name=>!names.has(name)))throw safe('MASTERLIST ZIP paths are unsupported.');
      async function read(name,max) {
        const file=zip.file(name);if(!file)throw safe('MASTERLIST workbook structure is incomplete.');
        // Public streaming API bounds expanded memory rather than trusting ZIP size.
        return new Promise((resolve,reject)=>{
          const chunks=[];let length=0,failed=false;
          const stream=file.internalStream('uint8array');
          stream.on('data',chunk=>{
            if(failed)return;
            length+=chunk.length;total+=chunk.length;
            if(length>max||total>limit){failed=true;stream.pause();reject(safe('MASTERLIST selected data exceeds the supported expanded size.'));return}
            chunks.push(chunk);
          }).on('error',reject).on('end',()=>{
            if(failed)return;const value=new Uint8Array(length);let offset=0;
            for(const chunk of chunks){value.set(chunk,offset);offset+=chunk.length}resolve(value);
          }).resume();
        });
      }
      const decode=value=>new TextDecoder().decode(value);
      const book=await read('xl/workbook.xml',256*1024),rels=await read('xl/_rels/workbook.xml.rels',256*1024);
      const sheets=nodes(decode(book),'sheet').map(s=>({...s,rId:s['r:id']}));
      let chosen;try{chosen=selectSheet({worksheets:sheets},when)}catch{throw safe('Exactly one current-month worksheet is required. No older month will be used.')}
      const matches=nodes(decode(rels),'Relationship').filter(r=>r.Id===chosen.rId);
      if(matches.length!==1||matches[0].TargetMode==='External')throw safe('MASTERLIST worksheet relationship is invalid.');
      const target=matches[0].Target.replace(/^\/xl\//,'');
      if(!/^worksheets\/sheet\d+\.xml$/.test(target))throw safe('MASTERLIST worksheet path is unsupported.');
      // Defined names can expand full-sheet ranges inside ExcelJS. Only retain
      // workbook properties (including date1904) and the selected sheet metadata;
      // import uses cell values and never evaluates formulas or named ranges.
      const {rId,...sheetAttributes}=chosen;
      const properties=nodes(decode(book),'workbookPr');
      if(properties.length>1)throw safe('MASTERLIST workbook properties are ambiguous.');
      out.file('xl/workbook.xml','<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'+properties.map(p=>element('workbookPr',p)).join('')+'<sheets>'+element('sheet',sheetAttributes)+'</sheets></workbook>');
      out.file('xl/_rels/workbook.xml.rels',rels);
      const sheet=await read('xl/'+target,12*1024*1024);
      admitSheet(decode(sheet),SaxesParser);
      out.file('xl/'+target,sheet);
      for(const [name,max] of [['xl/sharedStrings.xml',12*1024*1024],['xl/styles.xml',4*1024*1024]])
        if(zip.file(name))out.file(name,await read(name,max));
      // Preserve hyperlinks: ExcelJS exposes them as objects and sale cells must
      // still reject them. Comments/drawings/tables are not import source fields.
      const sheetRels='xl/worksheets/_rels/'+target.split('/').at(-1)+'.rels';
      if(zip.file(sheetRels)) {
        const links=nodes(decode(await read(sheetRels,512*1024)),'Relationship').filter(r=>r.Type?.endsWith('/hyperlink'));
        out.file(sheetRels,'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+links.map(r=>'<Relationship '+Object.entries(r).map(([k,v])=>k+'="'+escape(v)+'"').join(' ')+'/>').join('')+'</Relationships>');
      }
      return out.generateAsync({type:'uint8array',compression:'STORE'});
    });
    return measure('xlsx_parse',async()=>{
      const workbook=new ExcelJS.Workbook();
      try{await workbook.xlsx.load(selected,{ignoreNodes:ignored})}catch{throw safe('MASTERLIST could not be read as XLSX. No source cell content was saved.')}
      if(workbook.worksheets.some(s=>s.rowCount>20000||s.columnCount>200))throw safe('MASTERLIST is larger than the supported worksheet limits.');
      return workbook;
    });
  };
  return async (...args)=>{
    try{return await load(...args)}catch(error){
      if(error?.importSafe)throw error;
      throw safe('MASTERLIST could not be read safely as XLSX. No source cell content was saved.');
    }
  };
}

// One bounded, worker-local projection; no workbook bytes or private columns.
// Fresh Drive metadata is checked on every request and immediately before commit.
export function createRowCache({clock=Date.now,ttl=5*60*1000}={}) {
  let entry;
  return {
    async get(key,build) {
      if(entry?.key===key&&entry.until>clock())return {rows:await entry.promise,hit:true};
      const current={key,until:clock()+ttl,promise:Promise.resolve().then(build)};entry=current;
      try{return {rows:await current.promise,hit:false}}catch(error){if(entry===current)entry=undefined;throw error}
    }
  };
}
