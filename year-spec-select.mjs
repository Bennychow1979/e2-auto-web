const normal=value=>String(value??'').trim().toLowerCase();
export function choicesForYear(catalogue,{brand,model,year,engine},vehicles=[]) {
 const y=Number(year),valid=String(year).trim()!==''&&Number.isInteger(y)&&y>=1900&&y<=2100;
 if(!valid||!brand||!model)return {options:[],engines:[],verified:false,ready:false,noNamedSpec:false};
 const item=catalogue?.models?.find(r=>normal(r.brand)===normal(brand)&&normal(r.model)===normal(model));
 const row=item?.years?.find(r=>r.year===y);
 const sameYear=vehicles.filter(r=>normal(r.brand)===normal(brand)&&normal(r.model)===normal(model)&&Number(r.year)===y);
 const engines=Array.isArray(row?.engine_options)?row.engine_options:[...new Set(sameYear.map(r=>Number(r.engine_litres)).filter(n=>Number.isFinite(n)&&n>=0))];
 const engineReady=String(engine??'').trim()!==''&&Number.isFinite(Number(engine));
 const names=engineReady?row?.spec_by_engine?.[Number(engine).toFixed(1)]:[];
 const options=Array.isArray(row?.spec_options)?(names||[]).map(value=>({value,origin:'catalogue'})):engineReady?sameYear.filter(r=>Number(r.engine_litres)===Number(engine)&&r.variant).map(r=>({value:r.variant,origin:'inventory'})):[];
 return {options:[...new Map(options.map(r=>[r.value,r])).values()],engines,verified:Array.isArray(row?.spec_options),ready:true,engineReady,noNamedSpec:row?.no_named_spec===true||Array.isArray(names)&&!names.length,note:row?.spec_note||''};
}
export function setupYearSpecSelect({form,identity,inventory,current}) {
 const select=form.elements.namedItem('variant'),manual=form.elements.namedItem('variantManual');
 const engineSelect=form.elements.namedItem('engine_litres'),engineManual=form.elements.namedItem('engine_litresManual');
 const hint=document.createElement('small');hint.id='yearSpecHint';hint.style.cssText='line-height:1.6;font-size:13px';hint.setAttribute('aria-live','polite');select.parentElement.append(hint);select.setAttribute('aria-describedby',hint.id);
 let catalogue=null,loadFailed=false;
 const context=()=>({brand:identity('brand'),model:identity('model'),year:form.elements.namedItem('year').value,engine:identity('engine_litres')});
 function refresh({selected,engine,reset=false,preserveManual=false}={}) {
  let ctx=context(),result=choicesForYear(catalogue,ctx,inventory());const old=selected??identity('variant');
  const wasManual=select.value==='__manual__',manualValue=manual.value;
  const car=current();let saved=car&&normal(car.brand)===normal(ctx.brand)&&normal(car.model)===normal(ctx.model)&&Number(car.year)===Number(ctx.year)?car.variant:'';
  const oldEngine=engine??ctx.engine,savedEngine=car&&normal(car.brand)===normal(ctx.brand)&&normal(car.model)===normal(ctx.model)&&Number(car.year)===Number(ctx.year)&&car.engine_litres!=null?Number(car.engine_litres).toFixed(1):null;
  const engineWasManual=engineSelect.value==='__manual__',engineManualValue=engineManual.value;
  const engineValues=result.engines.map(v=>Number(v).toFixed(1));
  if(savedEngine!==null&&!engineValues.includes(savedEngine))engineValues.push(savedEngine);
  engineSelect.replaceChildren(new Option(result.ready?'Select engine size':'Select model and year first',''),...engineValues.map(v=>new Option(v+' L',v)),new Option('Other / enter manually','__manual__'));
  const normalizedEngine=String(oldEngine??'').trim()!==''?Number(oldEngine).toFixed(1):'';
  const keepEngineManual=preserveManual&&engineWasManual;
  engineSelect.value=keepEngineManual?'__manual__':engineValues.includes(normalizedEngine)?normalizedEngine:'';
  engineManual.value=keepEngineManual?engineManualValue:'';engineManual.hidden=!keepEngineManual;engineManual.disabled=!keepEngineManual;engineManual.required=keepEngineManual;
  if(reset&&normalizedEngine&&!engineValues.includes(normalizedEngine)){engineSelect.value='__manual__';engineManual.value=normalizedEngine;engineManual.hidden=false;engineManual.disabled=false;engineManual.required=true}
  engineSelect.disabled=!ctx.model;
  ctx=context();result=choicesForYear(catalogue,ctx,inventory());
  if(saved&&Number(ctx.engine)!==Number(car.engine_litres))saved='';
  select.replaceChildren(new Option('Not specified (optional)',''));
  for(const origin of ['catalogue','inventory']){
   const items=result.options.filter(r=>r.origin===origin);if(!items.length)continue;
   const group=document.createElement('optgroup');group.label=origin==='catalogue'?'Malaysia · '+ctx.year+' spec references':'Saved vehicles · '+ctx.year+' (verify spec)';
   for(const option of items)group.append(new Option(option.value,option.value));select.append(group);
  }
  const eligible=result.options.some(r=>r.value===old);
  if(saved&&!result.options.some(r=>r.value===saved)){
   const group=document.createElement('optgroup');group.label='This vehicle’s saved spec';group.append(new Option(saved,saved));select.append(group);
  }
  select.append(new Option('Other / enter manually','__manual__'));
  const keepManual=preserveManual&&wasManual;
  select.value=keepManual?'__manual__':eligible||old===saved?old:'';
  manual.value=keepManual?manualValue:'';manual.hidden=!keepManual;manual.disabled=!keepManual;manual.required=false;
  // An explicit stored value may have originated from a manual entry; preserve it on opening.
  if(reset&&old&&!eligible&&old!==saved){select.value='__manual__';manual.value=old;manual.hidden=false;manual.disabled=false;manual.required=false}
  select.disabled=!ctx.model;
  hint.textContent=!result.ready?'Choose Brand → Model → Year → Engine size. Spec is optional.':!result.engineReady?'Choose the engine size first, then the spec. Leave Spec blank if unsure.':result.verified&&!result.engines.includes(Number(ctx.engine))?'Specs for this year and engine size have not been verified. Leave Spec blank or enter the confirmed spec manually.':result.verified?
   (result.noNamedSpec?'No separate spec name is recorded for the regular model this year. Only verified special editions are listed. Leave Spec blank or enter a confirmed spec manually.':'Specs are listed for the selected year. Spec names exclude engine size and drivetrain.')+(result.note?' '+result.note:''):
   (result.options.length?'These specs come from saved vehicles of the same year and have not yet been verified against manufacturer sources.':'Specs for this model and year have not been verified. Leave Spec blank or enter it manually.')+(loadFailed?' Reference data is temporarily unavailable.':'');
 }
 form.elements.namedItem('year').addEventListener('input',()=>refresh());
 form.elements.namedItem('year').addEventListener('change',()=>refresh());
 engineSelect.addEventListener('change',()=>refresh({preserveManual:true}));
 engineManual.addEventListener('input',()=>refresh({preserveManual:true}));
 const ready=fetch(new URL('./verified-model-years.json?v=verified-spec-batch-2',import.meta.url)).then(r=>{if(!r.ok)throw Error('Catalogue unavailable');return r.json()}).then(data=>{catalogue=data;refresh({preserveManual:true})}).catch(()=>{loadFailed=true;refresh({preserveManual:true})});
 return {refresh,ready};
}
