// Read-only catalogue aid. It never writes inventory or public advertisement fields.
export function matchingYear(catalogue,brand,model,year) {
 if(!Number.isInteger(Number(year))||String(year).trim()==='')return null;
 const item=catalogue.models.find(r=>r.brand.toLowerCase()===brand.trim().toLowerCase()&&r.model.toLowerCase()===model.trim().toLowerCase());
 const entry=item?.years.find(r=>r.year===Number(year));
 return entry?{item,entry,ranges:item.ranges.filter(r=>r.start_year<=Number(year)&&r.verified_through_year>=Number(year))}:null;
}
export function setupYearReference({form,identity}) {
 const panel=document.createElement('details');panel.id='modelYearReference';panel.className='realMedia';panel.hidden=true;
 const summary=document.createElement('summary');summary.style.cssText='cursor:pointer;font-weight:600;line-height:1.6;padding:8px 0';
 const body=document.createElement('div');body.style.cssText='font-size:14px;line-height:1.65;overflow-wrap:anywhere';
 panel.append(summary,body);form.after(panel);
 let catalogue=null,lastKey='';
 function render(){
  if(!catalogue){panel.hidden=true;return}
  const match=matchingYear(catalogue,identity('brand'),identity('model'),form.elements.namedItem('year').value);
  panel.hidden=!match;
  if(!match){panel.open=false;lastKey='';return}
  const {item,entry,ranges}=match,key=item.brand+'|'+item.model+'|'+entry.year;
  if(key!==lastKey)panel.open=false;lastKey=key;
  summary.textContent=entry.year+' '+item.model+' · Verified year reference / 已核实年款';
  body.replaceChildren();
  const paragraph=(text,strong=false)=>{const p=document.createElement('p');p.textContent=text;if(strong)p.style.fontWeight='600';body.append(p)};
  paragraph('Malaysia official models · '+entry.generation,true);
  paragraph('年款参考；实车的制造年份、版本及配备需分别确认。此处不会自动修改车辆或广告。');
  const list=document.createElement('ul');
  for(const r of ranges){const li=document.createElement('li');li.textContent=r.generation+' · '+r.powertrain+' · '+r.start_year+'–'+(r.end_year??'Current');list.append(li)}
  body.append(list);paragraph(entry.note);
  const source=document.createElement('a');source.href='https://www.honda.com.my/aftersales/maintenance';source.target='_blank';source.rel='noopener noreferrer';source.textContent='Honda Malaysia · Official model-year directory ↗';body.append(source);
  paragraph('核查日期 '+catalogue.verified_on+' · Current 仅核实至 '+catalogue.verified_on+'。未包含完整年度装备清单。');
 }
 form.addEventListener('input',render);form.addEventListener('change',render);
 fetch(new URL('./verified-model-years.json?v=crv-1',import.meta.url)).then(r=>{if(!r.ok)throw Error('Catalogue unavailable');return r.json()}).then(data=>{catalogue=data;render()}).catch(()=>{panel.hidden=true});
 return {refresh:render};
}
