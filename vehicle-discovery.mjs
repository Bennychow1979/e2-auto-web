// Shared by the publication build and live filters. Ranges are non-overlapping.
export const budgets = [
  {slug:'under-rm30000',label:'Under RM30,000',min:0,max:30000},
  {slug:'rm30000-50000',label:'RM30,000–50,000',min:30000,max:50000},
  {slug:'rm50000-80000',label:'RM50,000–80,000',min:50000,max:80000},
  {slug:'above-rm80000',label:'RM80,000 and above',min:80000,max:Infinity},
];
export function matchesBudget(price,value){
  if(!value)return true;
  const range=budgets.find(b=>b.slug===value),number=Number(price);
  return !!range&&price!=null&&price!==''&&Number.isFinite(number)&&number>=range.min&&number<range.max;
}
export const categorySlug = value => String(value||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
export const modelSlug = car => categorySlug(car.brand)+'-'+categorySlug(car.model);
export const categoryPath = (slug,lang='en') => '/'+(['ms','zh'].includes(lang)?lang+'/':'')+'used-cars/'+slug+'/';
export function categoryRegistry(rows,previous=[]){
  const entries=new Map();
  function add(item){
    if(!item||!['brand','model','budget'].includes(item.kind)||typeof item.slug!=='string'||!/^[-a-z0-9]{1,160}$/.test(item.slug)||typeof item.label!=='string'||item.label.length>200)throw Error('Invalid category registry');
    const clean={kind:item.kind,slug:item.slug,label:item.label};
    if(item.kind!=='budget'){
      if(typeof item.brand!=='string'||!categorySlug(item.brand))throw Error('Invalid category brand');
      clean.brand=item.brand;
      if(item.kind==='model'){if(typeof item.model!=='string'||!categorySlug(item.model))throw Error('Invalid category model');clean.model=item.model;}
      if(item.slug!==(item.kind==='brand'?categorySlug(item.brand):modelSlug(item)))throw Error('Category identity mismatch');
    }else if(!budgets.some(b=>b.slug===item.slug))throw Error('Unknown budget category');
    const existing=entries.get(item.slug);
    if(existing&&existing.kind!==item.kind)throw Error('Category route collision: '+item.slug);
    if(!existing)entries.set(item.slug,clean);
  }
  if(!Array.isArray(previous))throw Error('Invalid category history');
  previous.forEach(add);
  for(const row of rows){
    add({kind:'brand',slug:categorySlug(row.brand),label:row.brand,brand:row.brand});
    add({kind:'model',slug:modelSlug(row),label:row.brand+' '+row.model,brand:row.brand,model:row.model});
  }
  budgets.forEach(b=>add({kind:'budget',slug:b.slug,label:b.label}));
  return [...entries.values()].sort((a,b)=>a.slug.localeCompare(b.slug));
}
export function categoryMatches(car,category){
  if(car.publication!=='published'||car.stock_status!=='Available')return false;
  return category.kind==='budget'?matchesBudget(car.price,category.slug):category.kind==='brand'?categorySlug(car.brand)===category.slug:modelSlug(car)===category.slug;
}
export function relatedAvailable(car,rows,limit=6){
  return rows.filter(v=>v.id!==car.id&&v.publication==='published'&&v.stock_status==='Available').sort((a,b)=>{
    const score=v=>modelSlug(v)===modelSlug(car)?0:categorySlug(v.brand)===categorySlug(car.brand)?1:2;
    return score(a)-score(b)||Math.abs(Number(a.price)-Number(car.price))-Math.abs(Number(b.price)-Number(car.price))||a.id.localeCompare(b.id);
  }).slice(0,limit);
}
