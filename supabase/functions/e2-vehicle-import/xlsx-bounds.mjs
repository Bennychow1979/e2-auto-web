const fail=()=>{throw Object.assign(new Error('MASTERLIST exceeds supported XLSX structure or worksheet limits.'),{importSafe:true})};
// Unused formatted rows are the usual cause; tell staff what to clear.
const tooManyCells=()=>{throw Object.assign(new Error('MASTERLIST current-month worksheet exceeds the 100,000 cell limits. Clear unused formatted rows below the data, then retry.'),{importSafe:true})};

// Admit a bounded, canonical single-disk ZIP before JSZip allocates its entries.
// Unsupported ZIP variants fail closed; this does not extract any source files.
export function admitZip(input) {
  const bytes=input instanceof Uint8Array?input:new Uint8Array(input);
  if(bytes.length<22||bytes.length>10*1024*1024)fail();
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const u16=n=>view.getUint16(n,true),u32=n=>view.getUint32(n,true);
  let end=-1;
  for(let n=bytes.length-22;n>=Math.max(0,bytes.length-65557);n--)
    if(u32(n)===0x06054b50&&n+22+u16(n+20)===bytes.length){end=n;break}
  if(end<0||u16(end+4)||u16(end+6))fail();
  const count=u16(end+10),size=u32(end+12),start=u32(end+16);
  if(count<1||count>2048||count!==u16(end+8)||size>1024*1024||start+size!==end)fail();
  const names=new Set(),ranges=[],decoder=new TextDecoder('utf-8',{fatal:true});let pos=start;
  for(let i=0;i<count;i++) {
    if(pos+46>end||u32(pos)!==0x02014b50)fail();
    const flags=u16(pos+8),method=u16(pos+10),compressed=u32(pos+20);
    const nl=u16(pos+28),el=u16(pos+30),cl=u16(pos+32),local=u32(pos+42);
    const next=pos+46+nl+el+cl;
    if(!nl||next>end||u16(pos+34)||(flags&1)||![0,8].includes(method)||compressed===0xffffffff||u32(pos+24)===0xffffffff)fail();
    const nameBytes=bytes.subarray(pos+46,pos+46+nl),name=decoder.decode(nameBytes);
    const parts=name.replace(/\/$/,'').split('/');
    if(!name||name.includes('\\')||name.includes('\0')||parts.some(p=>!p||p==='.'||p==='..'||p.includes(':'))||names.has(name))fail();
    // Unicode path extra fields must not rename/swap otherwise canonical entries.
    for(let extra=pos+46+nl;extra<pos+46+nl+el;) {
      if(extra+4>pos+46+nl+el)fail();
      const id=u16(extra),length=u16(extra+2),stop=extra+4+length;
      if(stop>pos+46+nl+el||id===1)fail();
      if(id===0x7075&&(length<5||bytes[extra+4]!==1||decoder.decode(bytes.subarray(extra+9,stop))!==name))fail();
      extra=stop;
    }
    names.add(name);
    if(local+30>start||u32(local)!==0x04034b50||u16(local+6)!==flags||u16(local+8)!==method||u16(local+26)!==nl)fail();
    const data=local+30+nl+u16(local+28);
    if(data+compressed>start||!nameBytes.every((b,j)=>bytes[local+30+j]===b))fail();
    ranges.push([local,data+compressed]);pos=next;
  }
  if(pos!==end)fail();
  ranges.sort((a,b)=>a[0]-b[0]);
  for(let i=1;i<ranges.length;i++)if(ranges[i][0]<ranges[i-1][1])fail();
  return names;
}

// XML bytes alone do not bound ExcelJS objects: one merge may expand millions
// of cells. Check coordinates/counts before handing the selected sheet to it.
export function admitSheet(xml,SaxesParser) {
  const parser=new SaxesParser({xmlns:false});let rows=0,cells=0,area=0,merges=0,cols=0,previousCol=0;
  const integer=(value,max)=>{if(!/^[1-9]\d*$/.test(value)||Number(value)>max)fail();return Number(value)};
  const address=value=>{
    const m=/^([A-Z]{1,3})([1-9]\d*)$/.exec(value||'');if(!m)fail();
    let col=0;for(const c of m[1])col=col*26+c.charCodeAt(0)-64;
    if(col>200)fail();return {col,row:integer(m[2],20000)};
  };
  const range=value=>{
    const parts=String(value||'').split(':');if(parts.length>2)fail();
    const a=address(parts[0]),b=address(parts[1]||parts[0]);
    if(b.row<a.row||b.col<a.col)fail();return (b.row-a.row+1)*(b.col-a.col+1);
  };
  parser.on('doctype',fail);
  parser.on('opentag',tag=>{
    const a=tag.attributes;
    if(tag.name==='row'){integer(a.r,20000);previousCol=0;if(++rows>20000)fail()}
    if(tag.name==='c'){
      if(a.r)previousCol=address(a.r).col;
      else {if(!previousCol||++previousCol>200)fail()}
      cells++;
    }
    // Column width/style/hidden ranges may legally reach XFD; they are not parsed
    // (see ignored nodes) and do not allocate cells, so only bound their count.
    if(tag.name==='col'){const min=integer(a.min,16384),max=integer(a.max,16384);if(max<min||++cols>200)fail()}
    if(tag.name==='mergeCell'){area+=range(a.ref);if(++merges>1000)fail()}
    if(tag.name==='hyperlink'||(tag.name==='f'&&a.ref))range(a.ref);
    if(cells+area>100000)tooManyCells();
  });
  parser.write(xml).close();
}
